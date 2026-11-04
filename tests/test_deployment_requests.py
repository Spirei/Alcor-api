import asyncio
import io
import urllib.error
from uuid import uuid4

from alcor_api import deployments
from alcor_api.config import ROOT
from pydantic import SecretStr

P = "/api/deployment"


def configure(app, monkeypatch):
    settings = app.state.settings
    settings.deployment_repository = "synthetic/alcor-api"
    settings.deployment_image = "ghcr.io/synthetic/alcor-api"
    settings.deployment_github_token = SecretStr("synthetic-github-token")
    settings.deployment_runner_token = SecretStr("synthetic-runner-token-" + "x" * 32)
    release = deployments.Release(
        version="0.1.99",
        image=settings.deployment_image + "@sha256:" + "a" * 64,
        revision="b" * 40,
        schema_hash=deployments.schema_hash(ROOT / "migrations"),
    )
    calls = []

    def github(settings, path, body=None):
        calls.append((path, body))
        if path == "/releases/latest":
            return {"body": release.model_dump_json(), "target_commitish": release.revision}
        if path.endswith("/dispatches"):
            return {}
        if path == "/commits/main":
            return {"sha": "c" * 40}
        if path.startswith("/releases?"):
            return []
        if "status=" in path:
            return {"workflow_runs": []}
        return {"workflow_runs": [{"status": "completed", "conclusion": "success", "head_sha": "b" * 40}]}

    monkeypatch.setattr(deployments, "github_json", github)
    from alcor_api import deployment_observations

    monkeypatch.setattr(deployment_observations, "github_json", github)
    return release, calls, {"authorization": "Bearer " + settings.deployment_runner_token.get_secret_value()}


async def test_admin_only_csrf_and_no_unconfigured_dispatch(client, admin):
    result = await client.get(P)
    assert result.status_code == 200 and not result.json()["configured"]
    assert result.json()["release"] is None and not result.json()["can_update"]
    assert (await client.post(P + "/builds", json={"request_id": str(uuid4())})).status_code == 409
    client.cookies.clear()
    assert (await client.get(P)).status_code == 401
    registered = await client.post(
        "/api/session/register", json={"username": "NormalUser", "password": "Synthetic9Pass"}
    )
    # Existing fixture admin already occupies first registration.
    assert registered.status_code == 201, registered.text
    assert (await client.get(P)).status_code == 403


async def test_request_uuid_concurrency_and_runner_ack_survive_github_failure(
    client, admin, app, monkeypatch
):
    release, _calls, headers = configure(app, monkeypatch)
    assert (await client.post(P + "/runner/claim")).status_code == 403
    assert (await client.post(P + "/runner/claim", headers=headers)).json() == {"request": None}
    before = await client.get(P)
    assert before.json()["can_update"]
    data = {"request_id": str(uuid4()), "release": release.model_dump()}
    responses = await asyncio.gather(*[client.post(P + "/requests", json=data) for _ in range(2)])
    assert all(r.status_code == 202 for r in responses), [r.text for r in responses]
    assert responses[0].json()["id"] == responses[1].json()["id"]
    other = await client.post(P + "/requests", json={**data, "request_id": str(uuid4())})
    assert other.status_code == 409
    claim = (await client.post(P + "/runner/claim", headers=headers)).json()["request"]
    assert claim["image"] == release.image
    assert (await client.post(P + "/runner/claim", headers=headers)).json()["request"] is None

    def offline(*args, **kwargs):
        raise OSError("synthetic network failure")

    monkeypatch.setattr(deployments, "github_json", offline)
    repeated = await client.post(P + "/requests", json=data)
    assert repeated.status_code == 202 and repeated.json()["status"] == "running"
    finish = {"id": claim["id"], "status": "succeeded"}
    assert (await client.post(P + "/runner/finish", headers=headers, json=finish)).status_code == 200
    assert (await client.post(P + "/runner/finish", headers=headers, json=finish)).status_code == 200
    assert (
        await client.post(P + "/runner/finish", headers=headers, json={**finish, "status": "failed"})
    ).status_code == 409
    receipt = await client.get(P + "/requests/" + data["request_id"])
    assert receipt.json()["status"] == "succeeded"
    with_secret = (await client.get(P)).text
    assert "synthetic-github-token" not in with_secret and "synthetic-runner-token" not in with_secret
    assert (await client.get(P)).json()["release_error"]


async def test_no_runner_schema_mismatch_stale_release_and_csrf(client, admin, app, monkeypatch):
    release, _calls, headers = configure(app, monkeypatch)
    data = {"request_id": str(uuid4()), "release": release.model_dump()}
    assert (await client.post(P + "/requests", json=data)).status_code == 409
    await client.post(P + "/runner/claim", headers=headers)
    client.headers["x-csrf-token"] = "wrong"
    assert (await client.post(P + "/requests", json=data)).status_code == 403
    login = await client.post("/api/session/login", json={"login": "AdminOne", "password": "Synthetic9Pass"})
    client.headers["x-csrf-token"] = login.json()["csrf"]
    bad = {**data, "release": {**data["release"], "version": "0.1.98"}}
    assert (await client.post(P + "/requests", json=bad)).status_code == 409
    release.schema_hash = "c" * 64
    data["release"] = release.model_dump()
    assert not (await client.get(P)).json()["schema_compatible"]
    assert (await client.post(P + "/requests", json=data)).status_code == 409


async def test_build_unknown_is_durable_and_never_redispatched(client, admin, app, monkeypatch):
    _release, calls, _headers = configure(app, monkeypatch)

    prior = deployments.github_json

    def uncertain(settings, path, body=None):
        if path.endswith("/dispatches"):
            calls.append((path, body))
            raise TimeoutError()
        return prior(settings, path, body)

    monkeypatch.setattr(deployments, "github_json", uncertain)
    data = {"request_id": str(uuid4())}
    first = await client.post(P + "/builds", json=data)
    assert first.status_code == 202 and first.json()["status"] == "unknown"
    again = await client.post(P + "/builds", json=data)
    assert again.json() == first.json() and sum(path.endswith("/dispatches") for path, _ in calls) == 1
    receipt = await client.get(P + "/builds/" + data["request_id"])
    assert receipt.json() == first.json()
    assert (await client.post(P + "/builds", json={"request_id": str(uuid4())})).status_code == 409


async def test_explicit_github_rejections_are_failed_not_unknown_and_do_not_block_retry(client, admin, app, monkeypatch):
    _release, calls, _headers = configure(app, monkeypatch)
    prior = deployments.github_json
    status = 403

    def provider(settings, path, body=None):
        if path.endswith("/dispatches"):
            calls.append((path, body))
            raise urllib.error.HTTPError("https://github.invalid/private", status, "private-token-value", {}, io.BytesIO(b"private-provider-body"))
        return prior(settings, path, body)

    monkeypatch.setattr(deployments, "github_json", provider)
    for status in (401, 403, 404, 422, 429):
        payload = {"request_id": str(uuid4())}
        first = await client.post(P + "/builds", json=payload)
        assert first.status_code == 202 and first.json()["status"] == "failed", first.text
        assert "GitHub" in first.json()["message"] and "private" not in first.text
        count = len(calls)
        replay = await client.post(P + "/builds", json=payload)
        assert replay.json()["status"] == "failed" and len(calls) == count
        assert (await client.get(P + "/builds/" + payload["request_id"])).json()["status"] == "failed"
    monkeypatch.setattr(deployments, "github_json", prior)
    assert (await client.post(P + "/builds", json={"request_id": str(uuid4())})).json()["status"] == "submitted"


async def test_github_server_error_keeps_uncertainty_and_prevents_redispatch(client, admin, app, monkeypatch):
    _release, calls, _headers = configure(app, monkeypatch)
    prior = deployments.github_json

    def provider(settings, path, body=None):
        if path.endswith("/dispatches"):
            calls.append((path, body))
            raise urllib.error.HTTPError("https://github.invalid", 503, "private", {}, io.BytesIO())
        return prior(settings, path, body)

    monkeypatch.setattr(deployments, "github_json", provider)
    payload = {"request_id": str(uuid4())}
    first = await client.post(P + "/builds", json=payload)
    assert first.json()["status"] == "unknown"
    assert (await client.post(P + "/builds", json=payload)).json() == first.json()
    assert sum(path.endswith("/dispatches") for path, _ in calls) == 1


async def test_revoked_admin_queued_update_cannot_execute(client, admin, app, monkeypatch):
    release, _calls, headers = configure(app, monkeypatch)
    await client.post(P + "/runner/claim", headers=headers)
    data = {"request_id": str(uuid4()), "release": release.model_dump()}
    assert (await client.post(P + "/requests", json=data)).status_code == 202
    async with app.state.db.connection() as conn:
        await conn.execute("UPDATE users SET active=false WHERE id=%s", (admin,))
    assert (await client.post(P + "/runner/claim", headers=headers)).json()["request"] is None
    async with app.state.db.connection() as conn:
        row = await (await conn.execute("SELECT status FROM deployment_requests")).fetchone()
    assert row["status"] == "cancelled"


async def test_discovery_rejects_other_image_repository(client, admin, app, monkeypatch):
    release, _calls, _headers = configure(app, monkeypatch)
    release.image = "ghcr.io/other/project@sha256:" + "a" * 64
    result = (await client.get(P)).json()
    assert result["release"] is None and result["release_error"] and not result["can_update"]
