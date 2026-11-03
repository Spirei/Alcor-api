from uuid import uuid4

import httpx
import psycopg
import pytest_asyncio
from psycopg import sql
from test_connections import P, request_data


@pytest_asyncio.fixture
async def inspection(client, admin, db, settings):
    role = "catalog_" + uuid4().hex
    async with db.connection() as conn:
        await conn.execute(sql.SQL("CREATE ROLE {} LOGIN").format(sql.Identifier(role)))
        await conn.execute("CREATE SCHEMA inventory")
        await conn.execute("CREATE SCHEMA private_only")
        await conn.execute(
            "CREATE TABLE inventory.records(id bigint PRIMARY KEY,symbol text,amount numeric(24,8),password text,metadata jsonb)"
        )
        await conn.execute(
            "INSERT INTO inventory.records SELECT i,'资产'||i,12345.12345678,'NeverReturnThisSecret',jsonb_build_object('apiKey','NeverReturnJsonSecret','symbol','TEST','amount',1234567890.12345678901234567890) FROM generate_series(1,30) i"
        )
        await conn.execute("ALTER TABLE inventory.records ENABLE ROW LEVEL SECURITY")
        await conn.execute("CREATE POLICY reader_rows ON inventory.records USING(id<=27)")
        await conn.execute("CREATE TABLE private_only.hidden(id bigint)")
        await conn.execute(
            "CREATE TABLE inventory.partial(id bigint PRIMARY KEY,label text,private_note text)"
        )
        await conn.execute("INSERT INTO inventory.partial VALUES(1,'Visible','NeverReturnPrivateColumn')")
        await conn.execute('CREATE TABLE inventory."quoted;drop table records;"(id bigint)')
        await conn.execute(
            "CREATE VIEW inventory.record_view WITH(security_invoker=true) AS SELECT * FROM inventory.records"
        )
        await conn.execute(sql.SQL("GRANT USAGE ON SCHEMA inventory TO {}").format(sql.Identifier(role)))
        await conn.execute(
            sql.SQL(
                'GRANT SELECT ON inventory.records,inventory.record_view,inventory."quoted;drop table records;" TO {}'
            ).format(sql.Identifier(role))
        )
        await conn.execute(
            sql.SQL("GRANT SELECT(id,label) ON inventory.partial TO {}").format(sql.Identifier(role))
        )
    try:
        response = await client.post(
            P + "postgresql/test", json=await request_data(client, settings, username=role)
        )
        assert response.status_code == 200 and response.json()["status"] == "passed", response.text
        token = response.json()["inspection_token"]
        assert token and "NeverReturn" not in token
        yield token, role
    finally:
        async with db.connection() as conn:
            await conn.execute(sql.SQL("DROP OWNED BY {}").format(sql.Identifier(role)))
            await conn.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(role)))


async def browse(client, token, view, **fields):
    return await client.post(P + "postgresql/inspect", json={"ticket": token, "view": view, **fields})


async def test_tested_role_catalog_structure_rows_and_rls_are_real_and_read_only(
    client, inspection, settings, db
):
    token, role = inspection
    databases = await browse(client, token, "databases")
    assert databases.status_code == 200 and databases.json()["account"] == role
    assert databases.json()["read_only"] == "on"
    schemas = await browse(client, token, "schemas")
    assert "inventory" in [item["name"] for item in schemas.json()["items"]]
    assert (
        next(item for item in schemas.json()["items"] if item["name"] == "inventory")["accessible_tables"]
        == 4
    )
    assert "private_only" not in [item["name"] for item in schemas.json()["items"]]
    tables = await browse(client, token, "tables", schema_name="inventory")
    assert {item["name"] for item in tables.json()["items"]} == {
        "records",
        "partial",
        "record_view",
        "quoted;drop table records;",
    }
    first = await browse(client, token, "rows", schema_name="inventory", table="records")
    assert first.status_code == 200, first.text
    data = first.json()
    assert len(data["rows"]) == 25 and data["has_more"]
    assert data["rows"][0]["amount"] == "12345.12345678"
    assert data["rows"][0]["password"] == "••••"
    assert "NeverReturn" not in first.text
    assert '"symbol": "TEST"' in data["rows"][0]["metadata"]
    assert "1234567890.12345678901234567890" in data["rows"][0]["metadata"]
    last = await browse(client, token, "rows", schema_name="inventory", table="records", offset=25)
    assert [row["id"] for row in last.json()["rows"]] == ["26", "27"] and not last.json()["has_more"]
    async with db.connection() as conn:
        assert (await (await conn.execute("SELECT count(*) AS n FROM inventory.records")).fetchone())[
            "n"
        ] == 30


async def test_column_permissions_quoted_names_and_view_structure(client, inspection):
    token, _ = inspection
    partial = await browse(client, token, "rows", schema_name="inventory", table="partial")
    assert partial.status_code == 200, partial.text
    assert partial.json()["rows"] == [{"id": "1", "label": "Visible", "private_note": "••••"}]
    quoted = await browse(client, token, "rows", schema_name="inventory", table="quoted;drop table records;")
    assert quoted.status_code == 200 and quoted.json()["rows"] == []
    view = await browse(client, token, "rows", schema_name="inventory", table="record_view")
    assert view.status_code == 200 and len(view.json()["rows"]) == 25, view.text
    assert "NeverReturn" not in view.text
    last_view = await browse(client, token, "rows", schema_name="inventory", table="record_view", offset=25)
    assert [row["id"] for row in last_view.json()["rows"]] == ["26", "27"]
    assert (
        await browse(client, token, "rows", schema_name="private_only", table="hidden")
    ).status_code == 404
    assert (
        await browse(client, token, "rows", schema_name="inventory", table="records;DROP TABLE users")
    ).status_code == 404


async def test_inspection_is_bound_to_owner_session_csrf_and_ticket_expiry(
    client, inspection, app, monkeypatch
):
    from alcor_api import postgres_inspector

    token, _ = inspection
    assert (await browse(client, token[:-4] + "xxxx", "databases")).status_code == 410
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers={"origin": "http://testserver"},
    ) as other:
        assert (await browse(other, token, "databases")).status_code == 401
        session = await other.post(
            "/api/session/login", json={"login": "AdminOne", "password": "Synthetic9Pass"}
        )
        other.headers["x-csrf-token"] = session.json()["csrf"]
        assert (await browse(other, token, "databases")).status_code == 410
    assert (
        await client.post(
            P + "postgresql/inspect",
            json={"ticket": token, "view": "databases"},
            headers={"x-csrf-token": "wrong"},
        )
    ).status_code == 403
    now = postgres_inspector.time.time()
    monkeypatch.setattr(postgres_inspector.time, "time", lambda: now + 601)
    assert (await browse(client, token, "databases")).status_code == 410


async def test_valid_admin_can_test_and_browse_after_fifteen_minutes_without_relogin(
    client, inspection, db, settings
):
    token, role = inspection
    async with db.connection() as conn:
        await conn.execute("UPDATE sessions SET created_at=clock_timestamp()-interval '16 minutes'")
    preview = await browse(client, token, "rows", schema_name="inventory", table="records")
    assert preview.status_code == 200 and preview.json()["rows"], preview.text
    tested = await client.post(
        P + "postgresql/test", json=await request_data(client, settings, username=role)
    )
    assert tested.status_code == 200 and tested.json()["status"] == "passed", tested.text


async def test_database_connect_permissions_and_explicit_database_selection(
    client, inspection, db, settings, app
):
    token, role = inspection
    visible, hidden = "alcor_visible_" + uuid4().hex, "alcor_hidden_" + uuid4().hex
    original = app.state.db.settings.database_url.get_secret_value()
    async with db.connection() as conn:
        await conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(visible)))
        await conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(hidden)))
        await conn.execute(
            sql.SQL("REVOKE CONNECT ON DATABASE {} FROM PUBLIC").format(sql.Identifier(hidden))
        )
    try:
        async with await psycopg.AsyncConnection.connect(
            settings.database_url.get_secret_value(), dbname=visible, autocommit=True
        ) as conn:
            await conn.execute("CREATE TABLE public.explicit_read(id bigint PRIMARY KEY,label text)")
            await conn.execute("INSERT INTO public.explicit_read VALUES(1,'Other isolated database')")
            await conn.execute(
                sql.SQL("GRANT SELECT ON public.explicit_read TO {}").format(sql.Identifier(role))
            )
        listing = await browse(client, token, "databases")
        names = {item["name"] for item in listing.json()["items"]}
        assert visible in names and hidden not in names
        rows = await browse(
            client, token, "rows", database=visible, schema_name="public", table="explicit_read"
        )
        assert rows.status_code == 200 and rows.json()["rows"][0]["label"] == "Other isolated database", (
            rows.text
        )
        assert (await browse(client, token, "schemas", database=hidden)).status_code == 422
        assert app.state.db.settings.database_url.get_secret_value() == original
    finally:
        async with db.connection() as conn:
            for name in [visible, hidden]:
                assert name.startswith(("alcor_visible_", "alcor_hidden_"))
                await conn.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
