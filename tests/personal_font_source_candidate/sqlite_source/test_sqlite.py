import json
import sqlite3
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from personal_font_source_candidate.test_source_fonts import P, capture, consent, permission, preview


async def test_real_read_only_sqlite_owner_claim_and_cutoff_without_copying_credentials(
    client, admin, old_pg, source_file, app, settings
):
    p, _ = await permission(client, admin, old_pg, source_file)
    before = __import__("pathlib").Path(old_pg.locator).read_bytes()
    p = await consent(client, p)
    assert __import__("pathlib").Path(old_pg.locator).read_bytes() == before
    cap, command = await capture(client, p)
    doc = json.loads(settings.legacy_source_registry_path.read_bytes())
    doc["sources"][0]["migrationWindow"] = {
        "notBefore": (datetime.now(UTC) - timedelta(hours=2)).isoformat(),
        "expiresAt": (datetime.now(UTC) - timedelta(hours=1)).isoformat(),
        "state": "active",
    }
    settings.legacy_source_registry_path.write_text(json.dumps(doc))
    source_file[0].rename(source_file[0].with_name("offline-root"))
    __import__("pathlib").Path(old_pg.locator).rename(
        __import__("pathlib").Path(old_pg.locator).with_suffix(".offline")
    )
    result = await client.post(P + "/operations", json=await preview(client, cap))
    assert result.status_code == 200, result.text
    assert (await client.get(result.json()["font"]["originalPath"])).content == source_file[2]
    assert (await client.get(P + "/operations/" + command["requestId"])).json()["capture"] == cap
    assert b"MUST-NOT-EXPORT" not in json.dumps((await client.get(P + "/permissions")).json()).encode()
    async with app.state.db.connection() as conn:
        assert (
            await (
                await conn.execute(
                    "SELECT count(*) n FROM legacy_source_owner_claims WHERE owner_id=%s", (admin,)
                )
            ).fetchone()
        )["n"] == 1
        assert (await (await conn.execute("SELECT count(*) n FROM legacy_source_heads")).fetchone())["n"] == 0


async def test_absent_old_owner_blocks_double_attestation_without_claim_or_font_bytes(
    client, admin, old_pg, source_file, app
):
    p, _ = await permission(client, admin, old_pg, source_file)
    with sqlite3.connect(old_pg.locator) as conn:
        conn.execute("DELETE FROM users")
    response = await client.post(
        P + "/permissions/" + p["id"] + "/consent",
        json={
            "requestId": str(uuid4()),
            "revision": p["revision"],
            "approve": True,
            "acknowledgeUnverifiedUploader": True,
            "name": "Explicit Name",
            "password": "Synthetic9Pass",
            "code": "",
        },
    )
    assert response.status_code == 409, response.text
    async with app.state.db.connection() as conn:
        for table in ("legacy_source_owner_claims", "resource_media_objects", "personal_fonts"):
            assert (await (await conn.execute("SELECT count(*) n FROM " + table)).fetchone())["n"] == 0
