#!/usr/bin/env python3
"""Run on the NAS host, once per invocation. No shell, DB access, migration or retry of apply.
Private config and pending receipt survive container replacement. DSM Task Scheduler can invoke it.
"""

import argparse
import fcntl
import json
import os
import re
import stat
import subprocess
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def private_file(path):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.geteuid():
        raise ValueError("private file must be owned by runner user and mode 0600")
    return path


def atomic_json(path, value):
    temporary = path.with_suffix(".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as out:
        json.dump(value, out)
        out.flush()
        os.fsync(out.fileno())
    os.replace(temporary, path)


def update_release_env(previous, release):
    """Preserve private settings/comments; replace only the two managed assignments."""
    values = {"ALCOR_APP_IMAGE": release["image"], "ALCOR_RELEASE_VERSION": release["version"]}
    lines = previous.splitlines(keepends=True)
    for key, value in values.items():
        matches = [i for i, line in enumerate(lines) if re.match(r"^\s*(?:export\s+)?" + key + r"\s*=", line)]
        if len(matches) > 1:
            raise ValueError("duplicate managed release assignment")
        if matches:
            lines[matches[0]] = key + "=" + value + "\n"
        else:
            if lines and not lines[-1].endswith("\n"):
                lines[-1] += "\n"
            lines.append(key + "=" + value + "\n")
    return "".join(lines)


class Runner:
    def __init__(self, config):
        self.config = config
        self.directory = Path(config["project_directory"]).resolve(strict=True)
        self.state = Path(config["state_directory"]).resolve(strict=True)
        if self.state.stat().st_uid != os.geteuid() or self.state.stat().st_mode & 0o077:
            raise ValueError("runner state directory requires owner and mode 0700")
        origin = urlsplit(config["origin"])
        if (
            origin.scheme not in {"http", "https"}
            or not origin.netloc
            or origin.path
            or origin.query
            or origin.fragment
            or origin.username
        ):
            raise ValueError("exact origin required")
        if origin.scheme != "https" and origin.hostname not in {"127.0.0.1", "::1", "localhost"}:
            raise ValueError("HTTP only allowed on loopback")
        if len(config["token"]) < 32:
            raise ValueError("runner token too short")
        if not re.fullmatch(r"ghcr\.io/[a-z0-9._-]+/[a-z0-9._-]+", config["image"]):
            raise ValueError("fixed image repository required")
        if not Path(config["docker"]).is_absolute():
            raise ValueError("docker executable requires absolute path")
        self.pending = self.state / "pending.json"
        # Synology uses one .env; legacy installations retain their split files.
        name = config.get("env_file", "compose.env")
        if name not in {".env", "compose.env"}:
            raise ValueError("unsupported environment file")
        self.base_env = private_file(self.directory / name)
        self.env = self.base_env if name == ".env" else self.state / "release.env"
        private_file(self.env)
        # Do not inherit caller-controlled Docker/Compose variables.
        self.process_env = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": os.path.expanduser("~"),
            "DOCKER_CONFIG": config["docker_config"],
        }
        self.compose = [
            config["docker"],
            "compose",
            "--project-directory",
            str(self.directory),
            "--env-file",
            str(self.base_env),
            *(["--env-file", str(self.env)] if self.env != self.base_env else []),
            "-f",
            str(self.directory / "compose.yaml"),
        ]

    def command(self, args, timeout=30):
        result = subprocess.run(
            args,
            env=self.process_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            check=True,
            text=True,
        )
        return result.stdout

    def api(self, path, body=None):
        req = urllib.request.Request(
            self.config["origin"] + "/api/deployment/runner/" + path,
            data=json.dumps(body or {}).encode(),
            headers={"Authorization": "Bearer " + self.config["token"], "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.build_opener(NoRedirect).open(req, timeout=10) as response:
            return json.loads(response.read(65536))

    def validate_release(self, release):
        if str(UUID(release["id"])) != release["id"]:
            raise ValueError("invalid request identity")
        if not re.fullmatch(re.escape(self.config["image"]) + r"@sha256:[a-f0-9]{64}", release["image"]):
            raise ValueError("image target denied")
        if (
            not re.fullmatch(r"\d+\.\d+\.\d+", release["version"])
            or not re.fullmatch(r"[a-f0-9]{40}", release["revision"])
            or not re.fullmatch(r"[a-f0-9]{64}", release["schema_hash"])
        ):
            raise ValueError("release invalid")

    def healthy(self, release):
        ids = self.command(self.compose + ["ps", "-q", "app"]).split()
        if len(ids) != 1:
            return False
        info = json.loads(self.command([self.config["docker"], "inspect", ids[0]]))[0]
        image = json.loads(self.command([self.config["docker"], "image", "inspect", release["image"]]))[0]
        env = info["Config"].get("Env", [])
        return bool(
            info["Image"] == image["Id"]
            and info["Config"]["Image"] == release["image"]
            and info["State"].get("Health", {}).get("Status") == "healthy"
            and "ALCOR_RELEASE_VERSION=" + release["version"] in env
            and "ALCOR_DEPLOYMENT_RUNNING_IMAGE=" + release["image"] in env
        )

    def finish(self, pending):
        self.api("finish", {"id": pending["release"]["id"], "status": pending["result"]})
        # Keep a private receipt before removing pending; a lost acknowledgement only retries finish.
        atomic_json(self.state / ("receipt-" + pending["release"]["id"] + ".json"), pending)
        self.pending.unlink()

    def run(self):
        if self.pending.exists():
            pending = json.loads(private_file(self.pending).read_text())
            self.validate_release(pending["release"])
            if not pending.get("result"):
                pending["result"] = "succeeded" if self.healthy(pending["release"]) else "unknown"
                atomic_json(self.pending, pending)
            self.finish(pending)
            return
        release = self.api("claim")["request"]
        if not release:
            return
        pending = {"release": release, "result": None}
        atomic_json(self.pending, pending)
        applying = False
        try:
            self.validate_release(release)
            resolved = json.loads(self.command(self.compose + ["config", "--format", "json"]))
            if set(resolved["services"]) != {"app"}:
                raise ValueError("only fixed app service permitted")
            current_id = self.command(self.compose + ["ps", "-q", "app"]).split()
            if len(current_id) != 1:
                raise ValueError("initial deployment must be completed separately")
            current = json.loads(self.command([self.config["docker"], "inspect", current_id[0]]))[0]
            if current["Config"].get("Labels", {}).get("com.docker.compose.project") != "alcor-api":
                raise ValueError("wrong compose project")
            if current["Config"].get("Labels", {}).get("org.alcor.schema") != release["schema_hash"]:
                # Image labels, rather than caller-supplied env, prove migration-file identity.
                image_info = json.loads(
                    self.command([self.config["docker"], "image", "inspect", current["Image"]])
                )[0]
                if image_info["Config"].get("Labels", {}).get("org.alcor.schema") != release["schema_hash"]:
                    raise ValueError("schema change requires separate migration")
            self.command([self.config["docker"], "pull", release["image"]], timeout=600)
            image = json.loads(self.command([self.config["docker"], "image", "inspect", release["image"]]))[0]
            labels = image["Config"].get("Labels", {})
            if any(
                labels.get(key) != release[field]
                for key, field in [
                    ("org.opencontainers.image.version", "version"),
                    ("org.opencontainers.image.revision", "revision"),
                    ("org.alcor.schema", "schema_hash"),
                ]
            ):
                raise ValueError("image label mismatch")
            # Preserve previous fixed image/version for an operator-reviewed rollback.
            previous = private_file(self.env).read_text()
            atomic_json(self.state / ("before-" + release["id"] + ".json"), {"release_env": previous})
            text = update_release_env(previous, release)
            temporary = self.env.with_suffix(".tmp")
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "w") as out:
                out.write(text)
                out.flush()
                os.fsync(out.fileno())
            os.replace(temporary, self.env)
            applying = True
            self.command(self.compose + ["up", "-d", "--no-deps", "--pull", "never", "app"], timeout=120)
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline:
                if self.healthy(release):
                    pending["result"] = "succeeded"
                    break
                time.sleep(3)
            else:
                pending["result"] = "unknown"
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
            pending["result"] = "unknown" if applying else "failed"
        atomic_json(self.pending, pending)
        self.finish(pending)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    try:
        runner = Runner(json.loads(private_file(args.config).read_text()))
        fd = os.open(runner.state / "runner.lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return
            runner.run()
    except Exception as exc:  # noqa: BLE001 - keep all secret-bearing command details out of logs
        # Never print command output, credentials or complete configuration.
        print("Update runner stopped: " + type(exc).__name__)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
