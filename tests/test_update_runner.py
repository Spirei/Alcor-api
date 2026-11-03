import importlib.util
import json

import pytest
from alcor_api.config import ROOT


def module():
    spec = importlib.util.spec_from_file_location("update_runner", ROOT / "deploy/update-runner.py")
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


def runner(tmp_path):
    m = module()
    r = m.Runner.__new__(m.Runner)
    r.config = {"image": "ghcr.io/synthetic/alcor-api"}
    r.state = tmp_path
    r.pending = tmp_path / "pending.json"
    release = {
        "id": "00000000-0000-4000-8000-000000000001",
        "image": r.config["image"] + "@sha256:" + "a" * 64,
        "version": "0.1.99",
        "revision": "b" * 40,
        "schema_hash": "c" * 64,
    }
    return m, r, release


def test_interrupted_apply_only_checks_health_and_never_applies_again(tmp_path):
    m, r, release = runner(tmp_path)
    m.atomic_json(r.pending, {"release": release, "result": None})
    calls = []

    def api(path, body=None):
        calls.append((path, body))
        assert path == "finish"

    r.api = api
    r.healthy = lambda target: False
    r.command = lambda *args, **kwargs: pytest.fail("must never reapply an interrupted update")
    r.run()
    assert calls == [("finish", {"id": release["id"], "status": "unknown"})]
    assert not r.pending.exists()
    assert json.loads((tmp_path / ("receipt-" + release["id"] + ".json")).read_text())["result"] == "unknown"


def test_lost_ack_retries_only_same_receipt(tmp_path):
    m, r, release = runner(tmp_path)
    m.atomic_json(r.pending, {"release": release, "result": "succeeded"})
    r.api = lambda *args: (_ for _ in ()).throw(TimeoutError())
    with pytest.raises(TimeoutError):
        r.run()
    assert r.pending.exists()
    calls = []
    r.api = lambda path, body: calls.append((path, body))
    r.healthy = lambda *args: pytest.fail("finished operation must only repeat acknowledgement")
    r.run()
    assert calls == [("finish", {"id": release["id"], "status": "succeeded"})]


def test_fixed_image_and_permissions_cannot_be_bypassed(tmp_path):
    m, r, release = runner(tmp_path)
    for image in [
        "ghcr.io/other/alcor-api@sha256:" + "a" * 64,
        "ghcr.io/synthetic/alcor-api:latest",
        "ghcr.io/synthetic/alcor-api@sha256:" + "a" * 64 + ";whoami",
    ]:
        with pytest.raises(ValueError):
            r.validate_release({**release, "image": image})
    secret = tmp_path / "config.json"
    secret.write_text("{}")
    secret.chmod(0o644)
    with pytest.raises(ValueError):
        m.private_file(secret)
    secret.chmod(0o600)
    link = tmp_path / "link"
    link.symlink_to(secret)
    with pytest.raises(ValueError):
        m.private_file(link)
    assert m.private_file(secret) == secret


@pytest.mark.parametrize("single_env", [False, True])
def test_success_updates_only_app_and_verifies_exact_digest(tmp_path, single_env):
    _m, r, release = runner(tmp_path)
    r.env = tmp_path / (".env" if single_env else "release.env")
    private_settings = "# private settings\nALCOR_DATABASE_URL=synthetic-private-value\n" if single_env else ""
    r.env.write_text(private_settings + "ALCOR_APP_IMAGE=previous\n")
    r.env.chmod(0o600)
    r.compose = ["docker", "compose", "-f", "fixed-compose.yaml"]
    r.config["docker"] = "docker"
    labels = {
        "org.alcor.schema": release["schema_hash"],
        "org.opencontainers.image.version": release["version"],
        "org.opencontainers.image.revision": release["revision"],
    }
    commands = []

    def command(args, **kwargs):
        commands.append(args)
        if args[-2:] == ["--format", "json"]:
            return json.dumps({"services": {"app": {}}})
        if args[-3:] == ["ps", "-q", "app"]:
            return "container123\n"
        if args[:2] == ["docker", "inspect"]:
            return json.dumps(
                [
                    {
                        "Image": "old-image-id",
                        "Config": {
                            "Labels": {
                                "com.docker.compose.project": "alcor-api",
                                "org.alcor.schema": release["schema_hash"],
                            }
                        },
                    }
                ]
            )
        if args[:3] == ["docker", "image", "inspect"]:
            return json.dumps([{"Config": {"Labels": labels}}])
        return ""

    calls = []
    r.command = command
    r.api = lambda path, body=None: {"request": release} if path == "claim" else calls.append((path, body))
    r.healthy = lambda target: target == release
    r.run()
    up = [cmd for cmd in commands if "up" in cmd]
    assert up == [r.compose + ["up", "-d", "--no-deps", "--pull", "never", "app"]]
    assert ["docker", "pull", release["image"]] in commands
    assert (
        r.env.read_text()
        == private_settings + "ALCOR_APP_IMAGE=" + release["image"] + "\nALCOR_RELEASE_VERSION=" + release["version"] + "\n"
    )
    assert calls == [("finish", {"id": release["id"], "status": "succeeded"})]
    assert (
        json.loads((tmp_path / ("before-" + release["id"] + ".json")).read_text())["release_env"]
        == private_settings + "ALCOR_APP_IMAGE=previous\n"
    )


def test_duplicate_release_assignment_fails_before_overwriting_private_config():
    m = module()
    with pytest.raises(ValueError):
        m.update_release_env("ALCOR_APP_IMAGE=first\nexport ALCOR_APP_IMAGE=second\n", {"image": "new", "version": "0.1.42"})


def test_single_env_initialization_requires_no_separate_release_file(tmp_path):
    m = module()
    project = tmp_path / "project"
    state = tmp_path / "state"
    project.mkdir()
    state.mkdir(mode=0o700)
    env = project / ".env"
    env.write_text("ALCOR_APP_IMAGE=previous\nALCOR_RELEASE_VERSION=0.1.41\n")
    env.chmod(0o600)
    r = m.Runner({"project_directory": str(project), "state_directory": str(state),
        "origin": "http://127.0.0.1:8088", "token": "x" * 32,
        "image": "ghcr.io/synthetic/alcor-api", "docker": "/usr/bin/docker",
        "docker_config": str(tmp_path), "env_file": ".env"})
    assert r.env == env
    assert r.compose.count("--env-file") == 1
    assert not (state / "release.env").exists()
