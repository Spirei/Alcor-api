"""Opt-in disposable CI daemon test. Never runs on a developer/NAS daemon by default."""

import json
import os
import subprocess
import time
from uuid import uuid4

import pytest
from test_container_updater import module

pytestmark = pytest.mark.skipif(
    os.environ.get("ALCOR_TEST_DOCKER") != "1", reason="requires an explicitly isolated CI Docker daemon"
)


def test_real_docker_replacement_preserves_data_and_confirms_actual_image(tmp_path):
    assert os.environ.get("GITHUB_ACTIONS") == "true", "only the disposable CI runner is authorized"

    def docker(*args):
        return subprocess.check_output(["docker", *args], text=True, stderr=subprocess.DEVNULL).strip()

    assert not docker("ps", "-aq"), "Docker smoke test requires a fresh daemon without existing containers"
    assert not docker("images", "-q", "ghcr.io/synthetic/alcor-api"), "synthetic image name must be unused"
    identity = uuid4().hex
    name, network = "alcor-api-qa-" + identity[:10], "alcor-api-qa-net-" + identity[:10]
    repo = "ghcr.io/synthetic/alcor-api"
    context = tmp_path / "context"
    context.mkdir()
    (context / "Dockerfile").write_text(
        '''FROM alcor-api-updater:ci
ARG VERSION
ARG REVISION
ENV ALCOR_RELEASE_VERSION=$VERSION ALCOR_SOURCE_REVISION=$REVISION
LABEL org.opencontainers.image.version=$VERSION org.opencontainers.image.revision=$REVISION org.alcor.schema="'''
        + "c" * 64
        + """"
ENTRYPOINT ["python", "-m", "http.server", "8080"]
HEALTHCHECK --interval=1s --timeout=2s --start-period=1s CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080', timeout=1).read()"]
"""
    )
    data = tmp_path / "data"
    data.mkdir()
    (data / "retained.txt").write_text("Synthetic retained data")
    state = tmp_path / "state"
    state.mkdir(mode=0o700)
    old_image = new_image = None
    owned_images = set()
    volume = name + "-state"
    docker("network", "create", "--internal", network)
    docker("volume", "create", "--label", "com.alcor.qa=" + identity, volume)
    try:
        docker(
            "run",
            "--rm",
            "--label",
            "com.alcor.qa=" + identity,
            "--mount",
            "type=volume,src=" + volume + ",dst=/state",
            "--entrypoint",
            "python",
            "alcor-api-updater:ci",
            "-c",
            "import os; assert os.stat('/state').st_mode & 0o777 == 0o700",
        )
        docker(
            "build",
            "--pull=false",
            "--build-arg",
            "VERSION=0.1.1",
            "--build-arg",
            "REVISION=" + "a" * 40,
            "-t",
            repo + ":latest",
            str(context),
        )
        old_image = docker("image", "inspect", "-f", "{{.Id}}", repo + ":latest")
        owned_images.add(old_image)
        docker(
            "run",
            "-d",
            "--name",
            name,
            "--network",
            network,
            "--network-alias",
            "app",
            "--label",
            "com.alcor.qa=" + identity,
            "--label",
            "com.alcor.update.scope=alcor-api",
            "--label",
            "com.docker.compose.project=alcor-api",
            "--label",
            "com.docker.compose.service=app",
            "--mount",
            "type=bind,src=" + str(data) + ",dst=/retained",
            "-p",
            "127.0.0.1::8080",
            repo + ":latest",
        )
        deadline = time.monotonic() + 45
        while docker("inspect", "-f", "{{.State.Health.Status}}", name) != "healthy":
            assert time.monotonic() < deadline
            time.sleep(0.5)
        before = json.loads(docker("inspect", name))[0]
        docker(
            "build",
            "--pull=false",
            "--build-arg",
            "VERSION=0.1.2",
            "--build-arg",
            "REVISION=" + "b" * 40,
            "-t",
            repo + ":latest",
            str(context),
        )
        new_image = docker("image", "inspect", "-f", "{{.Id}}", repo + ":latest")
        owned_images.add(new_image)
        m = module()
        engine = m.Docker(auth=str(tmp_path / "no-registry-credentials"))
        original_request, original_image = engine.request, engine.image
        release = {
            "id": str(uuid4()),
            "image": repo + "@sha256:" + "f" * 64,
            "version": "0.1.2",
            "revision": "b" * 40,
            "schema_hash": "c" * 64,
        }
        diagnostics = []

        def request(method, path, body=None, **kwargs):
            if path.startswith("/images/create?"):
                return None  # Registry transport is synthetic; all container operations use real Docker.
            try:
                result = original_request(method, path, body, **kwargs)
                diagnostics.append((method, path, "ok"))
                return result
            except Exception as exc:
                if method == "GET":
                    connection = m.UnixConnection(engine.path)
                    try:
                        connection.request(method, engine.version + path)
                        response = connection.getresponse()
                        # Only disposable synthetic fixtures exist on this explicitly empty CI daemon.
                        diagnostics.append(
                            (method, path, type(exc).__name__, response.status, response.read(2048).decode())
                        )
                    finally:
                        connection.close()
                else:
                    diagnostics.append((method, path, type(exc).__name__))
                raise

        def image(reference):
            result = original_image(reference)
            if reference in {repo + ":latest", new_image}:
                result["RepoDigests"] = [release["image"]]
            diagnostics.append(
                {
                    "image": reference,
                    "labels": result.get("Config", {}).get("Labels"),
                    "identity": [
                        v
                        for v in result.get("Config", {}).get("Env", [])
                        if v.startswith(("ALCOR_RELEASE_VERSION=", "ALCOR_SOURCE_REVISION="))
                    ],
                }
            )
            return result

        engine.request, engine.image = request, image
        updater = m.Updater("http://127.0.0.1:8123", "SyntheticDockerToken" * 3, repo, state, engine)
        receipts = []
        updater.api = lambda path, body=None: (
            {"request": release} if path == "claim" else receipts.append(body)
        )
        updater.run()
        assert receipts == [{"id": release["id"], "status": "succeeded"}], diagnostics
        after = json.loads(docker("inspect", name))[0]
        assert after["Config"]["Image"] == new_image and after["Image"] != before["Image"]
        assert after["State"]["Health"]["Status"] == "healthy"
        assert (
            updater.target()["Id"] == after["Id"]
        )  # The next release can identify this resolved-ID container.
        assert after["HostConfig"]["Binds"] == before["HostConfig"]["Binds"]
        assert after["HostConfig"]["PortBindings"] == before["HostConfig"]["PortBindings"]
        assert (data / "retained.txt").read_text() == "Synthetic retained data"
        # Move latest again: the old registry entry may disappear while its container still runs.
        docker(
            "build",
            "--pull=false",
            "--build-arg",
            "VERSION=0.1.3",
            "--build-arg",
            "REVISION=" + "c" * 40,
            "-t",
            repo + ":latest",
            str(context),
        )
        new_image = docker("image", "inspect", "-f", "{{.Id}}", repo + ":latest")
        owned_images.add(new_image)
        release.update(
            id=str(uuid4()), image=repo + "@sha256:" + "e" * 64, version="0.1.3", revision="c" * 40
        )
        updater.run()
        assert len(receipts) == 2 and all(row["status"] == "succeeded" for row in receipts), diagnostics
        final = json.loads(docker("inspect", name))[0]
        assert final["Config"]["Image"] == new_image and final["State"]["Health"]["Status"] == "healthy"
        assert (data / "retained.txt").read_text() == "Synthetic retained data"
    finally:
        owned = docker("ps", "-aq", "--filter", "label=com.alcor.qa=" + identity).split()
        for container in owned:
            assert docker("inspect", "-f", '{{index .Config.Labels "com.alcor.qa"}}', container) == identity
            docker("rm", "-f", container)
        docker("network", "rm", network)
        assert docker("volume", "inspect", "-f", '{{index .Labels "com.alcor.qa"}}', volume) == identity
        docker("volume", "rm", volume)
        if new_image or old_image:
            docker("image", "rm", "-f", repo + ":latest")
        for image_id in owned_images:
            subprocess.run(["docker", "image", "rm", image_id], capture_output=True, check=False)
