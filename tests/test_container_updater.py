import copy
import importlib.util
import json
import threading
import time
import urllib.error
import urllib.request

import pytest
from alcor_api.config import ROOT


def module():
    spec = importlib.util.spec_from_file_location("container_updater", ROOT / "deploy/container-updater.py")
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


class DockerFixture:
    def __init__(self, m, release):
        self.m, self.release = m, release
        self.calls = []
        labels = {label: release[key] for key, label in m.LABELS.items()}
        self.image_info = {
            "Id": "sha256:" + "d" * 64,
            "RepoDigests": [release["image"]],
            "Config": {
                "Labels": labels,
                "Env": [
                    "ALCOR_RELEASE_VERSION=" + release["version"],
                    "ALCOR_SOURCE_REVISION=" + release["revision"],
                ],
            },
        }
        self.current = {
            "Id": "1" * 64,
            "Name": "/alcor-api",
            "Image": "sha256:" + "e" * 64,
            "Config": {
                "Image": "ghcr.io/synthetic/alcor-api:latest",
                "Labels": {
                    "com.docker.compose.project": "alcor-api",
                    "com.docker.compose.service": "app",
                    m.SCOPE: "alcor-api",
                    **labels,
                },
                "Env": [
                    "ALCOR_DATABASE_URL=SyntheticPrivateDSN",
                    "ALCOR_RELEASE_VERSION=0.0.1",
                    "ALCOR_SOURCE_REVISION=" + "0" * 40,
                ],
                "Cmd": ["supervisord"],
                "Entrypoint": ["python", "/app/deploy/entrypoint.py"],
                "Healthcheck": {"Test": ["CMD", "python", "health.py"]},
            },
            "HostConfig": {
                "Binds": ["/synthetic/uploads:/var/lib/alcor/uploads"],
                "PortBindings": {"8080/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8088"}]},
                "RestartPolicy": {"Name": "unless-stopped"},
                "ReadonlyRootfs": True,
            },
            "NetworkSettings": {
                "Networks": {
                    "synthetic-control": {
                        "Aliases": ["app", "1" * 12],
                        "IPAddress": "synthetic-dynamic-address",
                        "EndpointID": "synthetic-ephemeral-id",
                    },
                    "synthetic-data": {"Aliases": ["app"]},
                }
            },
            "State": {"Running": True, "Health": {"Status": "healthy"}},
        }
        self.candidate_info = None

    def containers(self, labels):
        self.calls.append(("list", labels))
        if self.m.REQUEST in labels:
            return [{"Id": "2" * 64}] if self.candidate_info else []
        assert labels == {
            "com.docker.compose.project": "alcor-api",
            "com.docker.compose.service": "app",
            self.m.SCOPE: "alcor-api",
        }
        return [{"Id": self.current["Id"]}]

    def inspect(self, identity):
        self.calls.append(("inspect", identity))
        return self.current if identity == self.current["Id"] else self.candidate_info

    def image(self, reference):
        self.calls.append(("image", reference))
        if reference == self.current["Image"]:
            return {"Config": {"Labels": {self.m.LABELS["schema_hash"]: self.release["schema_hash"]}}}
        return self.image_info

    def request(self, method, path, body=None, **kwargs):
        self.calls.append((method, path, body))
        if path.startswith("/containers/create?"):
            self.candidate_info = {
                "Id": "2" * 64,
                "Image": body["Image"],
                "Config": copy.deepcopy(body),
                "Name": "/candidate",
                "State": {"Running": False},
            }
            return {"Id": "2" * 64}
        if path == "/containers/" + "2" * 64 + "/rename?name=alcor-api":
            self.candidate_info["Name"] = "/alcor-api"
        if path == "/containers/" + "2" * 64 + "/start":
            self.candidate_info["State"] = {"Running": True, "Health": {"Status": "healthy"}}


@pytest.fixture
def setup(tmp_path):
    m = module()
    release = {
        "id": "00000000-0000-4000-8000-000000000044",
        "version": "0.1.99",
        "image": "ghcr.io/synthetic/alcor-api@sha256:" + "a" * 64,
        "revision": "b" * 40,
        "schema_hash": "c" * 64,
    }
    tmp_path.chmod(0o700)
    docker = DockerFixture(m, release)
    updater = m.Updater(
        "http://127.0.0.1:8123", "SyntheticOnly" * 4, "ghcr.io/synthetic/alcor-api", tmp_path, docker
    )
    receipts = []
    updater.api = lambda path, body=None: {"request": release} if path == "claim" else receipts.append(body)
    return m, updater, docker, release, receipts


def test_latest_update_preserves_mounts_networks_and_private_settings_without_editing_env(setup):
    _m, updater, docker, release, receipts = setup
    updater.run()
    created = next(
        call[2] for call in docker.calls if call[0] == "POST" and call[1].startswith("/containers/create")
    )
    assert created["Image"] == docker.image_info["Id"]
    assert created["HostConfig"] == docker.current["HostConfig"]
    assert "ALCOR_DATABASE_URL=SyntheticPrivateDSN" in created["Env"]
    assert "ALCOR_RELEASE_VERSION=" + release["version"] in created["Env"]
    assert "ALCOR_SOURCE_REVISION=" + release["revision"] in created["Env"]
    assert set(created["NetworkingConfig"]["EndpointsConfig"]) == {"synthetic-control", "synthetic-data"}
    assert created["NetworkingConfig"]["EndpointsConfig"]["synthetic-control"] == {"Aliases": ["app"]}
    assert receipts == [{"id": release["id"], "status": "succeeded"}]
    mutations = [call for call in docker.calls if call[0] in {"POST", "DELETE"}]
    assert len([call for call in mutations if "/stop?" in call[1]]) == 1
    assert mutations[-1][1] == "/containers/" + "1" * 64 + "?v=false"
    assert not updater.pending.exists()
    assert (updater.state / ("before-" + release["id"] + ".json")).stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize(
    "fault", ["tag-moved", "version", "revision", "schema", "old-schema", "old-repository", "missing-env"]
)
def test_validation_failure_never_stops_or_creates_any_container(setup, fault):
    _m, updater, docker, _release, receipts = setup
    labels = docker.image_info["Config"]["Labels"]
    if fault == "tag-moved":
        docker.image_info["RepoDigests"] = ["ghcr.io/synthetic/alcor-api@sha256:" + "f" * 64]
    elif fault in {"version", "revision", "schema"}:
        labels[
            {
                "version": "org.opencontainers.image.version",
                "revision": "org.opencontainers.image.revision",
                "schema": "org.alcor.schema",
            }[fault]
        ] = "mismatch"
    elif fault == "old-schema":
        docker.current["Config"]["Labels"]["org.alcor.schema"] = "mismatch"
        original = docker.image
        docker.image = lambda ref: (
            {"Config": {"Labels": {"org.alcor.schema": "mismatch"}}}
            if ref == docker.current["Image"]
            else original(ref)
        )
    elif fault == "old-repository":
        docker.current["Config"]["Image"] = "ghcr.io/synthetic/fire-web:latest"
    elif fault == "missing-env":
        docker.image_info["Config"]["Env"] = []
    updater.run()
    assert receipts[-1]["status"] == "failed"
    assert not any(
        call[0] in {"POST", "DELETE"} and call[1].startswith("/containers/") for call in docker.calls
    )


def test_interrupted_apply_only_observes_the_original_request(setup):
    m, updater, docker, release, receipts = setup
    m.atomic(
        updater.pending,
        {
            "release": release,
            "phase": "applying",
            "result": None,
            "name": "/alcor-api",
            "image_id": "sha256:" + "d" * 64,
        },
    )
    updater.run()
    assert receipts[-1]["status"] == "unknown"
    assert all(call[0] in {"list", "inspect"} for call in docker.calls)


def test_next_update_accepts_prior_resolved_image_id_only_with_its_verified_repository(setup):
    m, updater, docker, release, _receipts = setup
    docker.current["Config"]["Image"] = docker.current["Image"]
    docker.current["Config"]["Labels"].update(
        {m.VERIFIED_ID: docker.current["Image"], m.VERIFIED_IMAGE: release["image"]}
    )
    docker.image = lambda ref: pytest.fail("a running image must remain identifiable after latest has moved")
    assert updater.target()["Id"] == docker.current["Id"]
    docker.current["Config"]["Labels"][m.VERIFIED_IMAGE] = "ghcr.io/synthetic/fire-web@sha256:" + "a" * 64
    with pytest.raises(ValueError):
        updater.target()


def test_lost_receipt_ack_retries_only_ack_and_never_reapplies(setup):
    m, updater, docker, release, receipts = setup
    m.atomic(updater.pending, {"release": release, "result": "succeeded", "phase": "applying"})
    updater.api = lambda *_: (_ for _ in ()).throw(TimeoutError())
    with pytest.raises(TimeoutError):
        updater.run()
    assert updater.pending.exists() and not docker.calls
    updater.api = lambda path, body: receipts.append(body)
    updater.run()
    assert receipts == [{"id": release["id"], "status": "succeeded"}] and not docker.calls


def test_internal_http_authentication_health_and_no_browser_supplied_commands(setup):
    m, updater, _docker, _release, _receipts = setup
    httpd = m.server(updater, ("127.0.0.1", 0))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    origin = "http://127.0.0.1:" + str(httpd.server_port)

    def request(path, token="", data=None):
        req = urllib.request.Request(origin + path, data=data, headers={"Authorization": "Bearer " + token})
        try:
            with urllib.request.urlopen(req, timeout=2) as response:
                return response.status
        except urllib.error.HTTPError as exc:
            return exc.code

    try:
        assert request("/health") == 503
        updater.last_contact = time.monotonic()
        assert request("/health") == 200
        assert request("/v1/update", data=b"{}") == 403 and not updater.wake.is_set()
        assert request("/v1/update", updater.token, b'{"command":"anything"}') == 400
        assert request("/v1/update?target=fire", updater.token, b"{}") == 404
        assert request("/v1/update", updater.token, b"{}") == 202 and updater.wake.is_set()
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=2)


def test_private_state_symlink_or_other_application_target_is_rejected(setup, tmp_path):
    m, updater, docker, release, _receipts = setup
    for ref in ["ghcr.io/synthetic/fire-web@sha256:" + "a" * 64, "ghcr.io/synthetic/alcor-api:latest"]:
        with pytest.raises(ValueError):
            updater.validate({**release, "image": ref})
    link = tmp_path / "link"
    link.symlink_to(tmp_path, target_is_directory=True)
    with pytest.raises(ValueError):
        m.Updater(updater.origin, updater.token, updater.image, link, docker)


def test_unix_docker_api_negotiates_version_and_pulls_with_private_registry_auth(setup, tmp_path):
    import base64
    import socketserver
    import tempfile
    from http.server import BaseHTTPRequestHandler
    from urllib.parse import unquote, urlsplit

    m, updater, fixture, _release, receipts = setup
    received = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def handle_request(self):
            path = self.path.removeprefix("/v1.47")
            received.append((self.command, self.path, self.headers.get("X-Registry-Auth")))
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            if path == "/version":
                result = {"ApiVersion": "1.47"}
            elif path.startswith("/images/create?"):
                result = {"status": "synthetic pull complete"}
            elif path.startswith("/images/"):
                result = fixture.image(unquote(urlsplit(path).path[len("/images/") : -len("/json")]))
            elif path.startswith("/containers/json?"):
                from urllib.parse import parse_qs

                filters = json.loads(parse_qs(urlsplit(path).query)["filters"][0])
                result = fixture.containers(dict(item.split("=", 1) for item in filters["label"]))
            elif path.endswith("/json"):
                result = fixture.inspect(path.split("/")[2])
            else:
                result = fixture.request(self.command, path, json.loads(body) if body else None)
            payload = json.dumps(result).encode() if result is not None else b""
            if path.startswith("/images/create?"):
                payload += b"\n"
            self.send_response(200)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        do_GET = handle_request
        do_POST = handle_request
        do_DELETE = handle_request

    with tempfile.TemporaryDirectory(prefix="alcor-socket-", dir="/tmp") as short:
        path = short + "/docker.sock"
        httpd = socketserver.UnixStreamServer(path, Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        auth = tmp_path / "registry.json"
        auth.write_text(
            json.dumps(
                {
                    "auths": {
                        "ghcr.io": {
                            "auth": base64.b64encode(b"SyntheticUser:SyntheticRegistryToken").decode()
                        }
                    }
                }
            )
        )
        auth.chmod(0o600)
        try:
            updater.docker = m.Docker(path, auth)
            updater.run()
            assert receipts[-1]["status"] == "succeeded"
            header = next(row[2] for row in received if "/images/create?" in row[1])
            parsed = json.loads(base64.urlsafe_b64decode(header))
            assert parsed == {
                "username": "SyntheticUser",
                "password": "SyntheticRegistryToken",
                "serveraddress": "ghcr.io",
            }
            assert all(row[1] == "/version" or row[1].startswith("/v1.47/") for row in received)
            assert all(
                "%3A" not in row[1] and "%2F" not in row[1]
                for row in received
                if row[0] == "GET" and "/images/" in row[1]
            )
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=2)


def test_interrupted_healthy_replacement_removes_only_verified_stopped_previous(setup):
    m, updater, docker, release, receipts = setup
    updater.healthy = lambda pending: True
    docker.current["Name"] = "/alcor-api-previous-" + release["id"][:8]
    docker.current["State"] = {"Running": False}
    m.atomic(updater.pending, {"release": release, "result": None, "phase": "applying",
        "name": "/alcor-api", "old_id": docker.current["Id"], "new_id": "2" * 64})
    updater.run()
    assert receipts[-1]["status"] == "succeeded"
    assert any(call[0] == "DELETE" and call[1] == "/containers/" + "1" * 64 + "?v=false" for call in docker.calls)


def test_recovery_never_deletes_running_previous_container(setup):
    m, updater, docker, release, receipts = setup
    updater.healthy = lambda pending: True
    m.atomic(updater.pending, {"release": release, "result": None, "phase": "applying",
        "name": "/alcor-api", "old_id": docker.current["Id"], "new_id": "2" * 64})
    updater.run()
    assert receipts[-1]["status"] == "unknown"
    assert not any(call[0] == "DELETE" for call in docker.calls)
