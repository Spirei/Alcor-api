import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from uuid import uuid4

import psycopg
import pytest
from alcor_api import __version__
from alcor_api.config import Settings
from test_deployment_requests import P, configure


async def test_web_click_wakes_updater_only_after_queue_commit_and_same_uuid_is_not_resent(
    client, admin, app, monkeypatch
):
    release, _calls, headers = configure(app, monkeypatch)
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            with psycopg.connect(app.state.settings.database_url.get_secret_value()) as conn:
                rows = conn.execute("SELECT status FROM deployment_requests").fetchall()
            seen.append((self.path, self.headers.get("Authorization"), rows))
            self.send_response(202)
            self.send_header("Content-Length", "0")
            self.end_headers()

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    app.state.settings.deployment_updater_url = "http://127.0.0.1:" + str(server.server_port)
    try:
        await client.post(P + "/runner/claim", headers=headers)
        data = {"request_id": str(uuid4()), "release": release.model_dump()}
        first = await client.post(P + "/requests", json=data)
        assert first.status_code == 202 and first.json()["status"] == "queued"
        assert seen == [("/v1/update", headers["authorization"], [("queued",)])]
        assert (await client.post(P + "/requests", json=data)).json()["id"] == first.json()["id"]
        assert len(seen) == 1
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


async def test_image_baked_identity_recognizes_latest_running_without_a_pinned_env(
    client, admin, app, monkeypatch
):
    release, _calls, headers = configure(app, monkeypatch)
    app.state.settings.deployment_running_image = ""
    release.version = __version__
    await client.post(P + "/runner/claim", headers=headers)
    assert not (await client.get(P)).json()["matches_release"]  # Same version alone is insufficient.
    app.state.settings.source_revision = release.revision
    status = (await client.get(P)).json()
    assert status["matches_release"] and not status["can_update"]
    assert status["running_revision"] == release.revision
    assert (
        await client.post(P + "/requests", json={"request_id": str(uuid4()), "release": release.model_dump()})
    ).status_code == 409
    app.state.settings.deployment_running_image = release.image
    app.state.settings.source_revision = "a" * 40
    assert not (await client.get(P)).json()["matches_release"]  # A stale .env digest cannot override image identity.


@pytest.mark.parametrize(
    "url",
    [
        "http://untrusted.example",
        "http://alcor-api-updater:8081/other",
        "http://user@alcor-api-updater:8081",
        "http://alcor-api-updater:8081?target=fire",
    ],
)
def test_updater_wake_target_cannot_be_an_external_service_or_browser_command(url):
    with pytest.raises(ValueError):
        Settings(deployment_updater_url=url)
