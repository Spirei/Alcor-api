"""Stale sessions remain signed in; sensitive deployment writes verify in place."""

import time
from uuid import uuid4

import httpx
from alcor_api.connections import Vault
from alcor_api.native_identity import totp_code
from alcor_api.security import COOKIE
from pydantic import SecretStr
from test_deployment_config import P, save
from test_deployment_requests import configure


async def age(db):
    async with db.connection() as conn:
        await conn.execute("UPDATE sessions SET created_at=clock_timestamp()-interval '16 minutes'")


async def test_config_verification_keeps_cookie_expiry_and_original_save_receipt(client, admin, db):
    await age(db)
    cookie = client.cookies[COOKIE]
    async with db.connection() as conn:
        before = await (await conn.execute("SELECT created_at,expires_at FROM sessions")).fetchone()
    request_id = str(uuid4())
    rejected = await save(client, request_id=request_id)
    assert rejected.status_code == 403
    assert rejected.headers["x-alcor-reauthentication"] == "required"
    assert "重新登录" not in rejected.text
    assert (await client.get("/api/session")).status_code == 200
    assert (await client.get(P + "/config")).status_code == 200
    async with db.connection() as conn:
        assert (await (await conn.execute("SELECT count(*) AS n FROM deployment_configuration")).fetchone())[
            "n"
        ] == 0
    wrong = await client.post(P + "/reauthenticate", json={"password": "IncorrectSynthetic43"})
    assert wrong.status_code == 403 and "x-alcor-reauthentication" not in wrong.headers
    verified = await client.post(P + "/reauthenticate", json={"password": "Synthetic9Pass"})
    assert verified.status_code == 204 and client.cookies[COOKIE] == cookie
    accepted = await save(client, request_id=request_id)
    assert accepted.status_code == 200 and accepted.json()["hasToken"]
    assert (await save(client, request_id=request_id)).json() == accepted.json()
    assert (await client.get(P + "/config/receipts/" + request_id)).json() == accepted.json()
    assert "SyntheticGithubCredential9" not in accepted.text
    async with db.connection() as conn:
        assert await (await conn.execute("SELECT created_at,expires_at FROM sessions")).fetchone() == before
        assert (await (await conn.execute("SELECT count(*) AS n FROM deployment_config_actions")).fetchone())[
            "n"
        ] == 1


async def test_deployment_verification_requires_totp_and_rejects_replay(client, admin, db, settings):
    secret = "JBSWY3DPEHPK3PXP"
    cipher = Vault(settings.connection_secret_dir).encrypt(secret, "totp:" + admin, settings.instance_id)
    async with db.connection() as conn:
        await conn.execute(
            "INSERT INTO identity_security(user_id,totp_enabled,totp_secret_ciphertext) VALUES(%s,true,%s)",
            (admin, cipher),
        )
    await age(db)
    assert (await client.post(P + "/reauthenticate", json={"password": "Synthetic9Pass"})).status_code == 403
    data = {"password": "Synthetic9Pass", "code": totp_code(secret, int(time.time()))}
    assert (await client.post(P + "/reauthenticate", json=data)).status_code == 204
    assert (await client.post(P + "/reauthenticate", json=data)).status_code == 403
    assert (await save(client)).status_code == 200


async def test_verification_scopes_session_expiry_csrf_and_role_are_not_bypassed(client, admin, db, app):
    await age(db)
    assert (
        await client.post("/api/connections/reauthenticate", json={"password": "Synthetic9Pass"})
    ).status_code == 204
    assert (await save(client)).headers["x-alcor-reauthentication"] == "required"
    assert (
        await client.post(
            P + "/reauthenticate", json={"password": "Synthetic9Pass"}, headers={"x-csrf-token": "invalid"}
        )
    ).status_code == 403
    assert (await client.post(P + "/reauthenticate", json={"password": "Synthetic9Pass"})).status_code == 204
    async with db.connection() as conn:
        await conn.execute("DELETE FROM identity_challenges WHERE purpose='connection-reauth'")
    from test_connections import request_data

    data = await request_data(client, app.state.settings)
    assert (await client.put("/api/connections/postgresql", json=data)).headers[
        "x-alcor-reauthentication"
    ] == "required"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers={"origin": "http://testserver"},
    ) as other:
        login = await other.post(
            "/api/session/login", json={"login": "AdminOne", "password": "Synthetic9Pass"}
        )
        other.headers["x-csrf-token"] = login.json()["csrf"]
        await age(db)
        assert (await save(other)).headers["x-alcor-reauthentication"] == "required"
    async with db.connection() as conn:
        await conn.execute(
            "UPDATE identity_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE purpose='deployment-reauth'"
        )
    assert (await save(client)).headers["x-alcor-reauthentication"] == "required"
    assert (await client.post(P + "/reauthenticate", json={"password": "Synthetic9Pass"})).status_code == 204
    async with db.connection() as conn:
        await conn.execute("UPDATE users SET role='user' WHERE id=%s", (admin,))
    denied = await save(client)
    assert denied.status_code == 403 and "x-alcor-reauthentication" not in denied.headers
    assert (await client.post(P + "/reauthenticate", json={"password": "Synthetic9Pass"})).status_code == 403


async def test_stale_oauth_opens_local_verification_before_creating_external_state(client, admin, app, db):
    app.state.settings.public_origin = "https://testserver"
    app.state.settings.deployment_github_client_id = "SyntheticClient"
    app.state.settings.deployment_github_client_secret = SecretStr("SyntheticClientSecret")
    client.base_url = "https://testserver"
    client.headers["origin"] = "https://testserver"
    await age(db)
    response = await client.get(P + "/github/start")
    assert response.status_code == 303 and response.headers["location"] == "/deploy-status?verify=github"
    async with db.connection() as conn:
        assert (await (await conn.execute("SELECT count(*) AS n FROM deployment_oauth_states")).fetchone())[
            "n"
        ] == 0
    assert (await client.post(P + "/reauthenticate", json={"password": "Synthetic9Pass"})).status_code == 204
    response = await client.get(P + "/github/start")
    assert response.status_code == 303 and response.headers["location"].startswith(
        "https://github.com/login/oauth/authorize?"
    )
    assert "Secure" in response.headers["set-cookie"]


async def test_verified_deployment_actions_keep_original_uuid_and_do_not_redispatch(
    client, admin, app, db, monkeypatch
):
    release, calls, headers = configure(app, monkeypatch)
    await client.post(P + "/runner/claim", headers=headers)
    await age(db)
    build_id = str(uuid4())
    update_id = str(uuid4())
    update = {"request_id": update_id, "release": release.model_dump()}
    assert (await client.post(P + "/builds", json={"request_id": build_id})).headers[
        "x-alcor-reauthentication"
    ] == "required"
    assert (await client.post(P + "/requests", json=update)).headers["x-alcor-reauthentication"] == "required"
    assert not any(path.endswith("/dispatches") for path, _ in calls)
    assert (await client.post(P + "/reauthenticate", json={"password": "Synthetic9Pass"})).status_code == 204
    assert (await client.post(P + "/builds", json={"request_id": build_id})).status_code == 202
    assert (await client.post(P + "/builds", json={"request_id": build_id})).status_code == 202
    assert sum(path.endswith("/dispatches") for path, _ in calls) == 1
    first = await client.post(P + "/requests", json=update)
    assert first.status_code == 202, first.text
    assert (await client.post(P + "/requests", json=update)).json()["id"] == first.json()["id"]
