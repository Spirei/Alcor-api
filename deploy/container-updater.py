"""Private HTTP-triggered updater. Only a durable, approved AlcorApi request can replace app."""

import base64
import copy
import fcntl
import http.client
import json
import os
import re
import secrets
import signal
import socket
import stat
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import quote, urlencode, urlsplit
from uuid import UUID

SCOPE = "com.alcor.update.scope"
REQUEST = "com.alcor.update.request"
VERIFIED_IMAGE = "com.alcor.update.image"
VERIFIED_ID = "com.alcor.update.image-id"
LABELS = {
    "version": "org.opencontainers.image.version",
    "revision": "org.opencontainers.image.revision",
    "schema_hash": "org.alcor.schema",
}


def private(path, directory=False):
    path = Path(path)
    info = path.lstat()
    if (
        not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
        or info.st_uid != os.geteuid()
        or info.st_mode & 0o077
    ):
        raise ValueError("private updater state requires its owner and private permissions")
    return path


def atomic(path, value):
    temporary = path.with_suffix(".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as out:
        json.dump(value, out)
        out.flush()
        os.fsync(out.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path, timeout=30):
        super().__init__("localhost", timeout=timeout)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.path)


class DockerError(OSError):
    def __init__(self, status):
        self.status = status
        super().__init__("Docker API HTTP " + str(status))


class Docker:
    def __init__(self, path="/var/run/docker.sock", auth="/config/config.json"):
        self.path, self.auth = path, Path(auth)
        version = self.request("GET", "/version", versioned=False)["ApiVersion"]
        if not re.fullmatch(r"1\.[0-9]{2,3}", version):
            raise ValueError("unsupported Docker API")
        self.version = "/v" + version

    def request(self, method, path, body=None, *, versioned=True, pull=False):
        conn = UnixConnection(self.path, timeout=600 if pull else 65)
        headers = {"Content-Type": "application/json"}
        if pull and self.auth.is_file():
            raw = self.auth.read_bytes()
            if len(raw) > 1048576:
                raise ValueError("registry configuration budget")
            auth = json.loads(raw).get("auths", {}).get("ghcr.io", {})
            if auth:
                auth = dict(auth)
                if auth.get("auth"):
                    username, password = (
                        base64.b64decode(auth.pop("auth"), validate=True).decode().split(":", 1)
                    )
                    auth.update(username=username, password=password)
                auth["serveraddress"] = "ghcr.io"
                headers["X-Registry-Auth"] = base64.urlsafe_b64encode(json.dumps(auth).encode()).decode()
        try:
            conn.request(
                method,
                (self.version if versioned else "") + path,
                body=json.dumps(body).encode() if body is not None else None,
                headers=headers,
            )
            response = conn.getresponse()
            if response.status >= 300:
                raise DockerError(response.status)
            if pull:
                budget = 32 * 1024 * 1024
                while line := response.readline(65537):
                    budget -= len(line)
                    if budget < 0 or len(line) > 65536 or json.loads(line).get("error"):
                        raise OSError("image pull failed")
                return None
            raw = response.read(4 * 1024 * 1024 + 1)
            if len(raw) > 4 * 1024 * 1024:
                raise ValueError("Docker response budget")
            return json.loads(raw) if raw else None
        finally:
            conn.close()

    def image(self, reference):
        # Match Docker's SDK: image separators must survive routing before reference lookup.
        return self.request("GET", "/images/" + quote(reference, safe="/:") + "/json")

    def inspect(self, container):
        if not re.fullmatch(r"[a-f0-9]{12,64}", container):
            raise ValueError("invalid container identity")
        return self.request("GET", "/containers/" + container + "/json")

    def containers(self, labels):
        filters = json.dumps({"label": [k + "=" + v for k, v in labels.items()]})
        return self.request("GET", "/containers/json?" + urlencode({"all": "1", "filters": filters}))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Updater:
    def __init__(self, origin, token, image, state, docker=None):
        url = urlsplit(origin)
        if (
            url.scheme not in {"http", "https"}
            or not url.netloc
            or url.path
            or url.query
            or url.fragment
            or url.username
            or len(token) < 32
        ):
            raise ValueError("invalid updater configuration")
        if url.scheme == "http" and url.hostname not in {"app", "localhost", "127.0.0.1", "::1"}:
            raise ValueError("HTTP is restricted to the app control network or loopback")
        if not re.fullmatch(r"ghcr\.io/[a-z0-9._-]+/[a-z0-9._-]+", image):
            raise ValueError("fixed image repository required")
        self.origin, self.token, self.image = origin, token, image
        self.state = private(state, directory=True)
        self.pending = self.state / "pending.json"
        self.docker = docker or Docker()
        self.last_contact = 0.0
        self.wake = threading.Event()
        self.stopping = threading.Event()

    def api(self, path, body=None):
        req = urllib.request.Request(
            self.origin + "/api/deployment/runner/" + path,
            data=json.dumps(body or {}).encode(),
            method="POST",
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"},
        )
        with urllib.request.build_opener(NoRedirect).open(req, timeout=10) as response:
            raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError("API response budget")
        result = json.loads(raw)
        self.last_contact = time.monotonic()
        return result

    def validate(self, release):
        if (
            str(UUID(release["id"])) != release["id"]
            or not re.fullmatch(re.escape(self.image) + r"@sha256:[a-f0-9]{64}", release["image"])
            or not re.fullmatch(r"\d+\.\d+\.\d+", release["version"])
            or not re.fullmatch(r"[a-f0-9]{40}", release["revision"])
            or not re.fullmatch(r"[a-f0-9]{64}", release["schema_hash"])
        ):
            raise ValueError("invalid approved release")

    def target(self):
        rows = self.docker.containers(
            {
                "com.docker.compose.project": "alcor-api",
                "com.docker.compose.service": "app",
                SCOPE: "alcor-api",
            }
        )
        if len(rows) != 1:
            raise ValueError("exactly one AlcorApi app is required")
        current = self.docker.inspect(rows[0]["Id"])
        ref = current["Config"]["Image"]
        allowed = ref == self.image + ":latest" or re.fullmatch(
            re.escape(self.image) + r"@sha256:[a-f0-9]{64}", ref
        )
        if not allowed and re.fullmatch(r"sha256:[a-f0-9]{64}", ref):
            # latest may already have moved. The running container retains its verified selection.
            labels = current["Config"].get("Labels", {})
            allowed = labels.get(VERIFIED_ID) == ref and re.fullmatch(
                re.escape(self.image) + r"@sha256:[a-f0-9]{64}", labels.get(VERIFIED_IMAGE, "")
            )
        if not allowed:
            raise ValueError("current container image is outside the configured repository")
        if not current["State"].get("Running") or current["HostConfig"].get("AutoRemove"):
            raise ValueError("initial healthy deployment is required")
        if current["State"].get("Health", {}).get("Status") != "healthy":
            raise ValueError("current app is not healthy")
        return current

    def candidate(self, current, image, release):
        config = copy.deepcopy(current["Config"])
        # Inspection-only metadata is not a container-create option.
        for key in ["Container", "ContainerConfig", "Image", "OnBuild"]:
            config.pop(key, None)
        config["Image"] = image[
            "Id"
        ]  # Resolve latest once; a later tag move cannot change the selected bytes.
        env = {item.split("=", 1)[0]: item.split("=", 1)[1] for item in config.get("Env", [])}
        target_env = {item.split("=", 1)[0]: item.split("=", 1)[1] for item in image["Config"].get("Env", [])}
        for name in ["ALCOR_RELEASE_VERSION", "ALCOR_SOURCE_REVISION"]:
            if name not in target_env:
                raise ValueError("release identity is missing from image environment")
            env[name] = target_env[name]
        if (
            env["ALCOR_RELEASE_VERSION"] != release["version"]
            or env["ALCOR_SOURCE_REVISION"] != release["revision"]
        ):
            raise ValueError("image environment does not match release labels")
        env["ALCOR_DEPLOYMENT_RUNNING_IMAGE"] = release["image"]
        config["Env"] = [k + "=" + v for k, v in env.items()]
        config["Labels"][REQUEST] = release["id"]
        config["Labels"][VERIFIED_IMAGE] = release["image"]
        config["Labels"][VERIFIED_ID] = image["Id"]
        config["Labels"]["com.docker.compose.image"] = image["Id"]
        config["HostConfig"] = copy.deepcopy(current["HostConfig"])
        networks = {}
        for name, endpoint in current["NetworkSettings"]["Networks"].items():
            aliases = [
                a for a in (endpoint.get("Aliases") or []) if a not in {current["Id"], current["Id"][:12]}
            ]
            networks[name] = {"Aliases": aliases}
            for key in ["IPAMConfig", "DriverOpts", "Links"]:
                if endpoint.get(key):
                    networks[name][key] = endpoint[key]
        config["NetworkingConfig"] = {"EndpointsConfig": networks}
        return config

    def healthy(self, pending):
        rows = self.docker.containers({REQUEST: pending["release"]["id"], SCOPE: "alcor-api"})
        if len(rows) != 1:
            return False
        info = self.docker.inspect(rows[0]["Id"])
        labels = info["Config"].get("Labels", {})
        env = info["Config"].get("Env", [])
        release = pending["release"]
        return bool(
            info["Image"] == pending.get("image_id")
            and info["Config"]["Image"] == pending["selected_image"]
            and info["Name"] == pending.get("name")
            and info["State"].get("Health", {}).get("Status") == "healthy"
            and info["State"].get("Running")
            and all(labels.get(label) == release[key] for key, label in LABELS.items())
            and "ALCOR_RELEASE_VERSION=" + release["version"] in env
            and "ALCOR_SOURCE_REVISION=" + release["revision"] in env
            and "ALCOR_DEPLOYMENT_RUNNING_IMAGE=" + release["image"] in env
        )

    def finish(self, pending):
        self.api("finish", {"id": pending["release"]["id"], "status": pending["result"]})
        atomic(self.state / ("receipt-" + pending["release"]["id"] + ".json"), pending)
        self.pending.unlink()

    def run(self):
        if self.pending.exists():
            pending = json.loads(private(self.pending).read_text())
            self.validate(pending["release"])
            if not pending.get("result"):
                pending["result"] = "unknown"
                if self.healthy(pending):
                    old_id = pending.get("old_id")
                    if old_id and old_id != pending.get("new_id"):
                        try:
                            old = self.docker.inspect(old_id)
                        except DockerError as exc:
                            if exc.status != 404:
                                raise
                            old = None
                        expected = pending["name"].rstrip("/") + "-previous-" + pending["release"]["id"][:8]
                        if old is None:
                            pending["result"] = "succeeded"
                        elif (old["Id"] == old_id and old["Name"] == expected
                            and not old["State"].get("Running")):
                            self.docker.request("DELETE", "/containers/" + old_id + "?v=false")
                            pending["result"] = "succeeded"
                    else:
                        pending["result"] = "succeeded"
                atomic(self.pending, pending)
            self.finish(pending)
            return
        release = self.api("claim")["request"]
        if not release:
            return
        pending = {"release": release, "result": None, "phase": "claimed"}
        atomic(self.pending, pending)
        try:
            self.validate(release)
            current = self.target()
            # Image tags can move and leave the old image without an inspectable repository entry.
            # Docker retains the original image labels in the running container's Config.
            if current["Config"].get("Labels", {}).get(LABELS["schema_hash"]) != release["schema_hash"]:
                raise ValueError("database structure change requires a separate migration")
            self.docker.request(
                "POST", "/images/create?" + urlencode({"fromImage": self.image, "tag": "latest"}), pull=True
            )
            image = self.docker.image(self.image + ":latest")
            if release["image"] not in image.get("RepoDigests", []) or any(
                image["Config"].get("Labels", {}).get(label) != release[key] for key, label in LABELS.items()
            ):
                raise ValueError("latest no longer matches the approved release")
            config = self.candidate(current, image, release)
            # Container labels must describe the new image, not the old inspected Config.
            config["Labels"].update({label: release[key] for key, label in LABELS.items()})
            pending.update(
                image_id=image["Id"],
                selected_image=image["Id"],
                name=current["Name"],
                old_id=current["Id"],
                phase="creating",
            )
            atomic(self.state / ("before-" + release["id"] + ".json"), current)
            atomic(self.pending, pending)
            candidate_name = current["Name"].lstrip("/") + "-candidate-" + release["id"][:8]
            created = self.docker.request(
                "POST", "/containers/create?" + urlencode({"name": candidate_name}), config
            )
            new_id = created["Id"]
            # Validate the returned Docker identity before any stop, rename or start.
            created_info = self.docker.inspect(new_id)
            if (
                created_info["Config"]["Image"] != image["Id"]
                or created_info["Config"].get("Labels", {}).get(REQUEST) != release["id"]
            ):
                raise ValueError("created container does not match the approved request")
            pending.update(new_id=new_id, image_id=created_info["Image"], phase="applying")
            atomic(self.pending, pending)
            self.docker.request("POST", "/containers/" + current["Id"] + "/stop?t=45")
            previous_name = current["Name"].lstrip("/") + "-previous-" + release["id"][:8]
            self.docker.request(
                "POST", "/containers/" + current["Id"] + "/rename?" + urlencode({"name": previous_name})
            )
            self.docker.request(
                "POST",
                "/containers/" + new_id + "/rename?" + urlencode({"name": current["Name"].lstrip("/")}),
            )
            self.docker.request("POST", "/containers/" + new_id + "/start")
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline:
                if self.healthy(pending):
                    pending["result"] = "succeeded"
                    break
                time.sleep(3)
            else:
                pending["result"] = "unknown"
            if pending["result"] == "succeeded":
                # Never remove a volume or old image. Keep the private snapshot for reviewed recovery.
                pending.update(result=None, phase="cleanup")
                atomic(self.pending, pending)
                self.docker.request("DELETE", "/containers/" + current["Id"] + "?v=false")
                pending["result"] = "succeeded"
        except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException):
            if pending["phase"] == "cleanup":
                atomic(self.pending, pending)
                return
            if not pending["result"]:
                pending["result"] = "failed" if pending["phase"] == "claimed" else "unknown"
        atomic(self.pending, pending)
        self.finish(pending)

    def loop(self):
        while not self.stopping.is_set():
            self.wake.clear()
            try:
                self.run()
            except Exception as exc:  # noqa: BLE001 - never log secret-bearing bodies or credentials
                print("Updater waiting: " + type(exc).__name__, flush=True)
            self.wake.wait(30)


def server(updater, address=("0.0.0.0", 8081)):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def respond(self, status):
            self.send_response(status)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            self.respond(
                200 if self.path == "/health" and time.monotonic() - updater.last_contact < 90 else 503
            )

        def do_POST(self):
            if self.path != "/v1/update":
                return self.respond(404)
            if not secrets.compare_digest(self.headers.get("Authorization", ""), "Bearer " + updater.token):
                return self.respond(403)
            # HTTP only wakes the worker; command, repository and target come from trusted config/PG.
            if self.headers.get("Transfer-Encoding") or self.headers.get("Content-Length", "0") not in {
                "0",
                "2",
            }:
                return self.respond(400)
            if self.headers.get("Content-Length") == "2" and self.rfile.read(2) != b"{}":
                return self.respond(400)
            updater.wake.set()
            self.respond(202)

    return HTTPServer(address, Handler)


def main():
    os.umask(0o077)
    updater = Updater(
        os.environ.get("ALCOR_UPDATER_ORIGIN", "http://app:8080"),
        os.environ["ALCOR_UPDATER_TOKEN"],
        os.environ["ALCOR_UPDATER_APP_IMAGE"],
        os.environ.get("ALCOR_UPDATER_STATE", "/state"),
    )
    fd = os.open(updater.state / "updater.lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        worker = threading.Thread(target=updater.loop, daemon=True)
        httpd = server(updater)

        def stop(*_):
            updater.stopping.set()
            updater.wake.set()
            threading.Thread(target=httpd.shutdown, daemon=True).start()

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        worker.start()
        httpd.serve_forever(poll_interval=0.5)
        worker.join(timeout=5)
        httpd.server_close()


if __name__ == "__main__":
    main()
