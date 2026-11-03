import asyncio
import hashlib
import json
import sqlite3
import time
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import test_registry
from request_telemetry_tables import REQUEST_TELEMETRY_TABLES
from alcor_api.backups import tables_and_hashes

from alcor_api.cli import create_user
from alcor_api.connections import Vault
from alcor_api.native_identity import totp_code
from alcor_api.operational_request_import import merge_cell
from alcor_api.operational_source_data import read_document, read_logs
from alcor_api.operational_source_registry import load_operational_sources
from alcor_api.request_observability import rollup
from alcor_api.source_snapshot import SourceMismatch, canonical, sha
from fastapi import HTTPException
from psycopg.errors import CheckViolation
from test_account_admin import login


async def business_tables_and_hashes(conn):
    values = await tables_and_hashes(conn)
    # Recorder telemetry is committed independently of this import transaction.
    # Keep every source original, archived row, receipt and business table.
    telemetry = REQUEST_TELEMETRY_TABLES
    return {name: value for name, value in values.items() if name not in telemetry}


enrollment = test_registry.enrollment

SCHEMA = """
CREATE TABLE requests(
    id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, path TEXT NOT NULL,
    method TEXT NOT NULL, source TEXT NOT NULL, status INTEGER NOT NULL, duration REAL NOT NULL);
CREATE TABLE request_daily(
    day TEXT NOT NULL, path TEXT NOT NULL, method TEXT NOT NULL, source TEXT NOT NULL,
    status INTEGER NOT NULL, count INTEGER NOT NULL, total_ms REAL NOT NULL,
    PRIMARY KEY(day,path,method,source,status)) WITHOUT ROWID;
CREATE TABLE request_hours(
    hour INTEGER NOT NULL, day TEXT NOT NULL, path TEXT NOT NULL, method TEXT NOT NULL,
    source TEXT NOT NULL, status INTEGER NOT NULL, count INTEGER NOT NULL,
    PRIMARY KEY(hour,path,method,source,status)) WITHOUT ROWID;
"""


def write_registration(registration, config, dbpath):
    config["sources"][0]["logIdentity"] = [dbpath.stat().st_dev, dbpath.stat().st_ino]
    registration.write_text(json.dumps(config))


@pytest.fixture
async def history(settings, enrollment):
    registration, config, _, _ = enrollment
    root = enrollment[1]["sources"][0]
    from pathlib import Path

    base = Path(root["root"])
    (base / "docs").mkdir(mode=0o700)
    (base / "docs/api-spec.md").write_bytes("# Synthetic Web\n\n中文".encode())
    (base / "docs/api-spec-v2.md").write_bytes(b"# Synthetic App\n")
    (base / "data").mkdir(mode=0o700)
    dbpath = base / "data/request-logs.sqlite"
    conn = sqlite3.connect(dbpath)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()
    write_registration(registration, config, dbpath)
    return load_operational_sources(settings)["synthetic-ops"], registration, config, dbpath


async def enable_totp(settings, db, user_id):
    secret = "JBSWY3DPEHPK3PXP"
    cipher = Vault(settings.connection_secret_dir).encrypt(secret, "totp:" + user_id, settings.instance_id)
    async with db.connection() as conn:
        await conn.execute(
            "INSERT INTO identity_security(user_id,totp_enabled,totp_secret_ciphertext) VALUES(%s,true,%s)",
            (user_id, cipher),
        )
    return secret


async def proof(secret, db, user_id):
    async with db.connection() as conn:
        await conn.execute("UPDATE identity_security SET totp_last_step=-1 WHERE user_id=%s", (user_id,))
    return totp_code(secret, int(time.time()))


def payload(alias, request_id, secret_code, **extra):
    return {
        "sourceAlias": alias,
        "requestId": str(request_id),
        "password": "Synthetic9Pass",
        "code": secret_code,
        **extra,
    }


async def test_reader_keeps_partial_pages_and_rejects_unnormalized_paths(history):
    source, _, _, dbpath = history
    document = read_document(source, 1)
    assert document["sha256"] == hashlib.sha256("# Synthetic Web\n\n中文".encode()).hexdigest()
    assert document["captureComplete"] and not document["historicalVersionsKnown"]
    with sqlite3.connect(dbpath) as conn:
        at = int(datetime.now(UTC).timestamp() * 1000)
        conn.executemany(
            "INSERT INTO requests(at,path,method,source,status,duration) VALUES(?,'/api/records','GET','web',200,2)",
            [(at + i,) for i in range(1001)],
        )
    before = hashlib.sha256(dbpath.read_bytes()).hexdigest()
    first = read_logs(source, "requests", None)
    second = read_logs(source, "requests", first["cursorAfter"])
    third = read_logs(source, "requests", second["cursorAfter"])
    assert [len(page["rows"]) for page in (first, second, third)] == [500, 500, 1]
    assert third["exhausted"] and not third["captureComplete"] and not third["historicalCoverageKnown"]
    assert len({row["id"] for page in (first, second, third) for row in page["rows"]}) == 1001
    assert hashlib.sha256(dbpath.read_bytes()).hexdigest() == before
    with sqlite3.connect(dbpath) as conn:
        conn.execute("UPDATE requests SET path='/api/raw-secret-that-must-not-persist' WHERE id=1")
    with pytest.raises(SourceMismatch) as failure:
        read_logs(source, "requests", None)
    assert "raw-secret" not in str(failure.value)


async def test_detail_pages_apply_once_and_native_rollup_skips_them(client, admin, settings, db, history):
    source, registration, config, dbpath = history
    with sqlite3.connect(dbpath) as conn:
        at = int(datetime(2026, 11, 2, tzinfo=UTC).timestamp() * 1000)
        conn.executemany(
            "INSERT INTO requests(at,path,method,source,status,duration) VALUES(?,'/api/records','GET','web',200,2)",
            [(at + i,) for i in range(501)],
        )
    write_registration(registration, config, dbpath)
    secret = await enable_totp(settings, db, admin)
    granted = await client.post(
        "/api/operational-sources/request-history/permissions",
        json=payload(source.alias, uuid4(), await proof(secret, db, admin)),
    )
    assert granted.status_code == 200, granted.text
    assert granted.json()["historicalCoverageKnown"] is False
    first_id, second_id = uuid4(), uuid4()
    preview = await client.post(
        "/api/operational-sources/request-history/captures",
        json=payload(source.alias, first_id, await proof(secret, db, admin), kind="requests"),
    )
    assert preview.status_code == 200, preview.text
    page = preview.json()
    assert page["rowCount"] == 500 and page["applied"] is False
    assert page["pageExhausted"] is False and page["captureComplete"] is False
    assert page["historicalCoverageKnown"] is False
    assert page["rawSha256"] == sha(canonical(read_logs(source, "requests", None)["rows"]))
    async with db.connection() as conn:
        assert (
            await (
                await conn.execute(
                    "SELECT count(*) AS n FROM request_observations WHERE imported_source IS NOT NULL"
                )
            ).fetchone()
        )["n"] == 0
        assert (
            await (
                await conn.execute(
                    "SELECT cursor IS NULL AS untouched FROM operational_request_progress WHERE kind='requests'"
                )
            ).fetchone()
        )["untouched"]
    applied = await client.post(
        "/api/operational-sources/request-history/applications",
        json={
            "captureId": page["captureId"],
            "requestId": str(uuid4()),
            "password": "Synthetic9Pass",
            "code": await proof(secret, db, admin),
        },
    )
    assert applied.status_code == 200, applied.text
    receipt = applied.json()
    assert receipt["appliedRows"] == 500 and receipt["captureComplete"] is False
    assert receipt["historicalCoverageKnown"] is False and receipt["pageExhausted"] is False
    visible = await client.get("/api/request-logs")
    assert visible.status_code == 200, visible.text
    imported = visible.json()["data"]["legacyImport"]
    assert imported["detailRows"] == 500 and imported["historicalCoverageKnown"] is False
    assert imported["hourDurationKnown"] is False
    replay = await client.post(
        "/api/operational-sources/request-history/applications",
        json={
            "captureId": page["captureId"],
            "requestId": receipt["requestId"],
            "password": "Synthetic9Pass",
            "code": "000000",
        },
    )
    assert replay.status_code == 200 and replay.json() == receipt
    assert (
        await client.get("/api/operational-sources/request-history/receipts/" + receipt["requestId"])
    ).json() == receipt
    again = await client.post(
        "/api/operational-sources/request-history/applications",
        json={
            "captureId": page["captureId"],
            "requestId": str(uuid4()),
            "password": "Synthetic9Pass",
            "code": await proof(secret, db, admin),
        },
    )
    assert again.status_code == 409
    second = await client.post(
        "/api/operational-sources/request-history/captures",
        json=payload(source.alias, second_id, await proof(secret, db, admin), kind="requests"),
    )
    assert second.status_code == 200, second.text
    tail = second.json()
    assert (
        tail["rowCount"] == 1 and tail["pageExhausted"] is True and tail["historicalCoverageKnown"] is False
    )
    stored = await client.post(
        "/api/operational-sources/request-history/applications",
        json={
            "captureId": tail["captureId"],
            "requestId": str(uuid4()),
            "password": "Synthetic9Pass",
            "code": await proof(secret, db, admin),
        },
    )
    assert stored.status_code == 200, stored.text
    assert stored.json()["appliedRows"] == 1 and stored.json()["historicalCoverageKnown"] is False
    async with db.connection() as conn:
        imported = await (
            await conn.execute(
                "SELECT count(*) AS n, coalesce(sum(duration),0) AS total FROM request_observations WHERE imported_source IS NOT NULL"
            )
        ).fetchone()
        assert imported["n"] == 501 and imported["total"] == 1002
        await conn.execute(
            "INSERT INTO request_observations(path,method,source,status,duration) VALUES('/api/records','GET','web',200,9)"
        )
        await conn.execute(
            "UPDATE request_rollup_state SET revision=(SELECT max(id) FROM request_observations) WHERE singleton"
        )
    await rollup(db)
    async with db.connection() as conn:
        native = await (
            await conn.execute(
                "SELECT coalesce(sum(count),0) AS n, coalesce(sum(total_ms),0) AS total FROM request_rollups WHERE unit='day' AND path='/api/records'"
            )
        ).fetchone()
        assert native["n"] == 1 and native["total"] == 9
        state = await (
            await conn.execute("SELECT revision, aggregate_revision FROM request_rollup_state")
        ).fetchone()
        assert state["aggregate_revision"] == state["revision"]
        visible = await (
            await conn.execute(
                "SELECT count(*) AS n FROM request_observations WHERE imported_source IS NOT NULL AND path='/api/records'"
            )
        ).fetchone()
        assert visible["n"] == 501


async def test_hour_total_stays_unknown_and_cells_do_not_grow_twice(client, admin, settings, db, history):
    source, registration, config, dbpath = history
    hour = datetime(2026, 11, 2, 1, tzinfo=UTC)
    hour_ms = int(hour.timestamp() * 1000)
    day = (hour + timedelta(hours=8)).date().isoformat()
    with sqlite3.connect(dbpath) as conn:
        conn.execute(
            "INSERT INTO request_hours(hour,day,path,method,source,status,count) VALUES(?,?,?,?,?,?,?)",
            (hour_ms, day, "/api/records", "GET", "web", 200, 4),
        )
        conn.execute(
            "INSERT INTO request_daily(day,path,method,source,status,count,total_ms) VALUES(?,?,?,?,?,?,?)",
            (day, "/api/records", "GET", "web", 200, 3, 12.5),
        )
    write_registration(registration, config, dbpath)
    secret = await enable_totp(settings, db, admin)
    assert (
        await client.post(
            "/api/operational-sources/request-history/permissions",
            json=payload(source.alias, uuid4(), await proof(secret, db, admin)),
        )
    ).status_code == 200
    captured = await client.post(
        "/api/operational-sources/request-history/captures",
        json=payload(source.alias, uuid4(), await proof(secret, db, admin), kind="request_hours"),
    )
    assert captured.status_code == 200, captured.text
    applied = await client.post(
        "/api/operational-sources/request-history/applications",
        json={
            "captureId": captured.json()["captureId"],
            "requestId": str(uuid4()),
            "password": "Synthetic9Pass",
            "code": await proof(secret, db, admin),
        },
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["hourTotalMsKnown"] is False and applied.json()["appliedRows"] == 1
    async with db.connection() as conn:
        cell = await (
            await conn.execute(
                "SELECT count, total_ms, source_instance, capture_id FROM operational_request_log_cells"
            )
        ).fetchone()
        assert cell["count"] == 4 and cell["total_ms"] is None
        instance, capture_id = cell["source_instance"], cell["capture_id"]
        with pytest.raises(HTTPException) as blocked:
            await merge_cell(
                conn,
                instance,
                "hour",
                hour,
                {"path": "/api/records", "method": "GET", "source": "web", "status": 200, "count": 1},
                None,
                capture_id,
            )
        assert blocked.value.status_code == 409
        assert (
            await merge_cell(
                conn,
                instance,
                "hour",
                hour,
                {"path": "/api/records", "method": "GET", "source": "web", "status": 200, "count": 4},
                None,
                capture_id,
            )
            == 0
        )
        assert (
            await merge_cell(
                conn,
                instance,
                "hour",
                hour,
                {"path": "/api/records", "method": "GET", "source": "web", "status": 200, "count": 7},
                None,
                capture_id,
            )
            == 0
        )
        grown = await (
            await conn.execute("SELECT count, total_ms FROM operational_request_log_cells")
        ).fetchone()
        assert grown["count"] == 7 and grown["total_ms"] is None
        with pytest.raises(HTTPException):
            await merge_cell(
                conn,
                instance,
                "hour",
                hour,
                {"path": "/api/records", "method": "GET", "source": "web", "status": 200, "count": 8},
                5,
                uuid4(),
            )
    daily = await client.post(
        "/api/operational-sources/request-history/captures",
        json=payload(source.alias, uuid4(), await proof(secret, db, admin), kind="request_daily"),
    )
    stored = await client.post(
        "/api/operational-sources/request-history/applications",
        json={
            "captureId": daily.json()["captureId"],
            "requestId": str(uuid4()),
            "password": "Synthetic9Pass",
            "code": await proof(secret, db, admin),
        },
    )
    assert stored.status_code == 200, stored.text
    async with db.connection() as conn:
        row = await (
            await conn.execute("SELECT count, total_ms FROM operational_request_log_cells WHERE unit='day'")
        ).fetchone()
        assert row["count"] == 3 and row["total_ms"] == 12.5
        native = await (
            await conn.execute("SELECT count(*) AS n FROM request_rollups WHERE path='/api/records'")
        ).fetchone()
        assert native["n"] == 0
    visible = await client.get("/api/request-logs")
    assert visible.status_code == 200, visible.text
    imported = visible.json()["data"]["legacyImport"]
    assert imported["hourCells"] == 1 and imported["dailyCells"] == 1
    assert imported["historicalCoverageKnown"] is False and imported["hourDurationKnown"] is False


async def test_authorization_closure_inode_and_peer_receipt_stay_separate(
    client, admin, app, settings, db, history
):
    source, registration, config, dbpath = history
    secret = await enable_totp(settings, db, admin)
    missing = await client.post(
        "/api/operational-sources/request-history/permissions",
        json=payload(source.alias, uuid4(), "000000") | {"password": "Synthetic9Pass"},
    )
    async with db.connection() as conn:
        await conn.execute("DELETE FROM identity_security WHERE user_id=%s", (admin,))
    no_factor = await client.post(
        "/api/operational-sources/request-history/permissions",
        json=payload(source.alias, uuid4(), "000000"),
    )
    assert no_factor.status_code == 409
    secret = await enable_totp(settings, db, admin)
    config["sources"][0]["scopes"] = ["global-api-documents"]
    registration.write_text(json.dumps(config))
    denied = await client.post(
        "/api/operational-sources/request-history/permissions",
        json=payload(source.alias, uuid4(), await proof(secret, db, admin)),
    )
    assert denied.status_code == 403
    config["sources"][0]["scopes"] = ["global-api-documents", "global-request-history"]
    write_registration(registration, config, dbpath)
    user = await create_user(settings, "PlainUser", "Synthetic9Pass", role="user")
    member = await login(app, "PlainUser")
    try:
        assert (
            await member.post(
                "/api/operational-sources/request-history/permissions",
                json=payload(source.alias, uuid4(), "000000"),
            )
        ).status_code == 403
    finally:
        await member.aclose()
    assert user
    granted = await client.post(
        "/api/operational-sources/request-history/permissions",
        json=payload(source.alias, uuid4(), await proof(secret, db, admin)),
    )
    assert granted.status_code == 200, granted.text
    closed_id = uuid4()
    closed = await client.post(
        "/api/operational-sources/request-history/closures",
        json={
            "requestId": str(closed_id),
            "password": "Synthetic9Pass",
            "code": await proof(secret, db, admin),
        },
    )
    assert closed.status_code == 200, closed.text
    reused = await client.post(
        "/api/operational-sources/request-history/captures",
        json=payload(source.alias, closed_id, await proof(secret, db, admin), kind="requests"),
    )
    assert reused.status_code == 409
    # Keep the registered inode allocated: unlink+create may reuse it immediately
    # on Linux, which does not actually exercise a changed [device,inode] binding.
    original_identity = (dbpath.stat().st_dev, dbpath.stat().st_ino)
    dbpath.rename(dbpath.with_name("retained-original.sqlite"))
    replaced = sqlite3.connect(dbpath)
    replaced.executescript(SCHEMA)
    replaced.close()
    assert (dbpath.stat().st_dev, dbpath.stat().st_ino) != original_identity
    blocked = await client.post(
        "/api/operational-sources/request-history/captures",
        json=payload(source.alias, uuid4(), await proof(secret, db, admin), kind="requests"),
    )
    assert blocked.status_code == 409
    assert "request-logs" not in blocked.text and str(dbpath) not in blocked.text
    async with db.connection() as conn:
        assert (
            await (await conn.execute("SELECT count(*) AS n FROM operational_request_captures")).fetchone()
        )["n"] == 0
    peer = await create_user(settings, "PeerAdmin", "Synthetic9Pass", role="admin")
    other = await login(app, "PeerAdmin")
    try:
        assert (
            await other.get(
                "/api/operational-sources/request-history/receipts/" + granted.json()["requestId"]
            )
        ).status_code == 404
    finally:
        await other.aclose()
    assert peer
    assert missing.status_code == 403


def _apply(capture_id, request_id, code):
    return {
        "captureId": str(capture_id),
        "requestId": str(request_id),
        "password": "Synthetic9Pass",
        "code": code,
    }


async def test_concurrent_apply_rolls_back_and_archive_cannot_be_deleted(
    client, admin, app, settings, db, history, monkeypatch
):
    import alcor_api.operational_request_import as request_import

    assert settings.redis_url is None
    source, registration, config, dbpath = history
    with sqlite3.connect(dbpath) as conn:
        at = int(datetime(2026, 11, 2, tzinfo=UTC).timestamp() * 1000)
        conn.executemany(
            "INSERT INTO requests(at,path,method,source,status,duration) VALUES(?,'/api/records','GET','web',200,3)",
            [(at + i,) for i in range(3)],
        )
        conn.execute(
            """INSERT INTO request_daily(day,path,method,source,status,count,total_ms)
               VALUES('2026-11-02','/api/records','GET','web',200,3,9)"""
        )
    write_registration(registration, config, dbpath)
    secret = await enable_totp(settings, db, admin)
    peer_id = await create_user(settings, "ArchiveAdmin", "Synthetic9Pass", role="admin")
    other = await login(app, "ArchiveAdmin")
    peer_secret = await enable_totp(settings, db, peer_id)
    permissions = "/api/operational-sources/request-history/permissions"
    captures = "/api/operational-sources/request-history/captures"
    applications = "/api/operational-sources/request-history/applications"
    receipts = "/api/operational-sources/request-history/receipts/"
    try:
        granted = await client.post(
            permissions, json=payload(source.alias, uuid4(), await proof(secret, db, admin))
        )
        assert granted.status_code == 200, granted.text
        first = await client.post(
            captures, json=payload(source.alias, uuid4(), await proof(secret, db, admin), kind="requests")
        )
        second = await client.post(
            captures, json=payload(source.alias, uuid4(), await proof(secret, db, admin), kind="requests")
        )
        assert first.status_code == 200 and second.status_code == 200, first.text + second.text
        assert first.json()["captureId"] != second.json()["captureId"]
        assert first.json()["historicalCoverageKnown"] is False
        left_id, right_id = uuid4(), uuid4()
        left, right = await asyncio.gather(
            client.post(
                applications,
                json=_apply(first.json()["captureId"], left_id, await proof(secret, db, admin)),
            ),
            other.post(
                applications,
                json=_apply(first.json()["captureId"], right_id, await proof(peer_secret, db, peer_id)),
            ),
        )
        assert sorted(item.status_code for item in (left, right)) == [200, 409]
        winner = left if left.status_code == 200 else right
        loser = right if winner is left else left
        assert winner.json()["appliedRows"] == 3
        assert winner.json()["historicalCoverageKnown"] is False
        assert winner.json()["captureComplete"] is False
        assert loser.json()["error"]["message"] == "该捕获还不是下一次可应用的页"
        stale = await client.post(
            applications,
            json=_apply(second.json()["captureId"], uuid4(), await proof(secret, db, admin)),
        )
        assert stale.status_code == 409
        assert stale.json()["error"]["message"] == "该捕获还不是下一次可应用的页"
        async with db.connection() as conn:
            stored = await (
                await conn.execute("SELECT count(*) AS n FROM operational_request_log_rows")
            ).fetchone()
            progress = await (
                await conn.execute(
                    """SELECT kind, revision, cursor IS NULL AS open
                       FROM operational_request_progress ORDER BY kind"""
                )
            ).fetchall()
            written = await (
                await conn.execute(
                    "SELECT count(*) AS n FROM operational_request_operations WHERE request_id = ANY(%s)",
                    ([left_id, right_id],),
                )
            ).fetchone()
        assert stored["n"] == 3 and written["n"] == 1
        assert [(row["kind"], row["revision"], row["open"]) for row in progress] == [
            ("request_daily", 0, True),
            ("request_hours", 0, True),
            ("requests", 1, False),
        ]
        daily = await client.post(
            captures,
            json=payload(source.alias, uuid4(), await proof(secret, db, admin), kind="request_daily"),
        )
        assert daily.status_code == 200, daily.text
        async with db.connection() as conn:
            await conn.execute(
                """CREATE FUNCTION fail_request_audit() RETURNS trigger LANGUAGE plpgsql AS $$
                   BEGIN IF NEW.action='operational-request.applied' THEN
                     RAISE EXCEPTION 'synthetic rollback';
                   END IF; RETURN NEW; END $$"""
            )
            await conn.execute(
                """CREATE TRIGGER fail_request_audit BEFORE INSERT ON audit_events
                   FOR EACH ROW EXECUTE FUNCTION fail_request_audit()"""
            )
        lost_id = uuid4()
        failed = await client.post(
            applications, json=_apply(daily.json()["captureId"], lost_id, await proof(secret, db, admin))
        )
        assert failed.status_code == 503
        assert "synthetic" not in failed.text and str(dbpath) not in failed.text
        assert (await client.get(receipts + str(lost_id))).status_code == 404
        async with db.connection() as conn:
            rolled = await (
                await conn.execute(
                    """SELECT revision, cursor IS NULL AS open, applied_rows
                       FROM operational_request_progress WHERE kind='request_daily'"""
                )
            ).fetchone()
            cells = await (
                await conn.execute("SELECT count(*) AS n FROM operational_request_log_cells")
            ).fetchone()
            kept = await (
                await conn.execute("SELECT count(*) AS n FROM operational_request_log_rows")
            ).fetchone()
        assert rolled["revision"] == 0 and rolled["open"] and rolled["applied_rows"] == 0
        assert cells["n"] == 0 and kept["n"] == 3
        async with db.connection() as conn:
            await conn.execute("DROP TRIGGER fail_request_audit ON audit_events")
            await conn.execute("DROP FUNCTION fail_request_audit()")
        original = request_import.perform_apply

        async def lose_response(request, who, data):
            await original(request, who, data)
            raise ConnectionError("synthetic result lost after commit")

        monkeypatch.setattr(request_import, "perform_apply", lose_response)
        lost = await client.post(
            applications, json=_apply(daily.json()["captureId"], lost_id, await proof(secret, db, admin))
        )
        monkeypatch.undo()
        assert lost.status_code == 503
        assert "synthetic" not in lost.text
        recovered = await client.get(receipts + str(lost_id))
        assert recovered.status_code == 200, recovered.text
        receipt = recovered.json()
        assert receipt["state"] == "applied" and receipt["appliedRows"] == 1
        assert receipt["requestId"] == str(lost_id)
        assert receipt["historicalCoverageKnown"] is False and receipt["captureComplete"] is False
        replay = await client.post(applications, json=_apply(daily.json()["captureId"], lost_id, "000000"))
        assert replay.status_code == 200 and replay.json() == receipt
        visible = await client.get("/api/request-logs")
        imported = visible.json()["data"]["legacyImport"]
        assert imported["detailRows"] == 3 and imported["dailyCells"] == 1 and imported["hourCells"] == 0
        assert imported["historicalCoverageKnown"] is False and imported["hourDurationKnown"] is False
        await rollup(db)
        await rollup(db)
        async with db.connection() as conn, conn.transaction():
            before = await business_tables_and_hashes(conn)
        assert before["operational_request_log_rows"]["rows"] == 3
        assert before["operational_request_captures"]["rows"] == 3
        assert before["operational_request_log_cells"]["rows"] == 1
        with pytest.raises(CheckViolation, match="actual fills require append-only corrections"):
            async with db.connection() as conn, conn.transaction():
                await conn.execute("DELETE FROM operational_request_log_rows")
        with pytest.raises(CheckViolation, match="actual fills require append-only corrections"):
            async with db.connection() as conn, conn.transaction():
                await conn.execute("UPDATE operational_request_log_rows SET digest=digest")
        with pytest.raises(CheckViolation, match="actual fills require append-only corrections"):
            async with db.connection() as conn, conn.transaction():
                await conn.execute("DELETE FROM operational_request_captures")
        async with db.connection() as conn, conn.transaction():
            assert await business_tables_and_hashes(conn) == before
            native = await (
                await conn.execute("SELECT count(*) AS n FROM request_rollups WHERE path='/api/records'")
            ).fetchone()
            still = await (
                await conn.execute(
                    "SELECT count(*) AS n FROM request_observations WHERE imported_source IS NOT NULL"
                )
            ).fetchone()
        assert native["n"] == 0 and still["n"] == 3
    finally:
        await other.aclose()
