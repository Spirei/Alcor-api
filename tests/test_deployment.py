import importlib.util

import pytest
from alcor_api import __version__
from alcor_api.backups import BackupFailure
from alcor_api.config import ROOT, Settings
from alcor_api.connections import Vault
from pgserver.postgres_server import POSTGRES_BIN_PATH


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


def config(tmp_path):
    return Settings(
        database_url=None,
        redis_url=None,
        instance_id=None,
        environment="test",
        connection_targets=[],
        connection_secret_dir=tmp_path / "connections",
        backup_secret_dir=tmp_path / "backup-key",
        backup_dir=tmp_path / "backups",
        file_root=tmp_path / "files",
        pg_tools_dir=POSTGRES_BIN_PATH,
        restore_targets=[],
    )


def test_deployment_artifacts_are_explicit_and_match_release():
    check = module("deployment_check", ROOT / "tools/validate-deployment.py")
    result = check.validate(ROOT)
    assert result["passed"], result["issues"]
    assert not result["docker_executed"] and not result["production_accessed"]


def test_deployment_preflight_rejects_stale_api_contract(monkeypatch):
    import json
    from pathlib import Path

    read_text = Path.read_text
    contract = ROOT / "contracts/platform.openapi.json"

    def stale_contract(path, *args, **kwargs):
        content = read_text(path, *args, **kwargs)
        if path == contract:
            value = json.loads(content)
            value["info"]["version"] = "0.0.0"
            return json.dumps(value)
        return content

    monkeypatch.setattr(Path, "read_text", stale_contract)
    check = module("deployment_check_stale_contract", ROOT / "tools/validate-deployment.py")
    result = check.validate(ROOT)
    assert not result["passed"]
    assert any("OpenAPI version" in issue for issue in result["issues"])
    assert not result["docker_executed"] and not result["production_accessed"]


def test_private_storage_preflight_never_opens_a_database(tmp_path, monkeypatch):
    import psycopg

    def forbidden(*args, **kwargs):
        raise AssertionError("preflight connected to a database")

    monkeypatch.setattr(psycopg.AsyncConnection, "connect", forbidden)
    entry = module("alcor_entry", ROOT / "deploy/entrypoint.py")
    settings = config(tmp_path)
    result = entry.validate(settings, __version__)
    assert not result["database_accessed"]
    for path in [
        settings.connection_secret_dir,
        settings.backup_secret_dir,
        settings.backup_dir,
        settings.file_root,
    ]:
        assert path.stat().st_mode & 0o777 == 0o700
    original_key = Vault(settings.connection_secret_dir).key()
    encrypted = Vault(settings.connection_secret_dir).encrypt(
        "SyntheticOnly", "test", __import__("uuid").uuid4()
    )
    entry.validate(settings, __version__)
    assert Vault(settings.connection_secret_dir).key() == original_key and encrypted


def test_preflight_rejects_wrong_release_unsafe_modes_and_overlapping_paths(tmp_path):
    entry = module("alcor_entry_bad", ROOT / "deploy/entrypoint.py")
    settings = config(tmp_path)
    with pytest.raises(BackupFailure):
        entry.validate(settings, "0.0.0")
    settings.backup_dir.mkdir(mode=0o755)
    with pytest.raises(BackupFailure):
        entry.validate(settings, __version__)
    settings.backup_dir.chmod(0o700)
    settings.backup_secret_dir = settings.backup_dir / "key"
    with pytest.raises(BackupFailure):
        entry.validate(settings, __version__)


def test_preflight_does_not_follow_a_secret_directory_symlink(tmp_path):
    entry = module("alcor_entry_link", ROOT / "deploy/entrypoint.py")
    settings = config(tmp_path)
    other = tmp_path / "other"
    other.mkdir(mode=0o700)
    settings.connection_secret_dir.symlink_to(other, target_is_directory=True)
    with pytest.raises(BackupFailure):
        entry.validate(settings, __version__)


def test_optional_assets_preflight_checks_separation_and_private_permissions(tmp_path):
    entry=module('alcor_entry_assets',ROOT/'deploy/entrypoint.py')
    settings=config(tmp_path);settings.asset_root=tmp_path/'assets'
    assert entry.validate(settings,__version__)['private_storage']=='verified'
    assert settings.asset_root.stat().st_mode&0o777==0o700
    settings.asset_root=settings.file_root
    with pytest.raises(BackupFailure):entry.validate(settings,__version__)


def test_synology_template_uses_requested_folder_and_read_only_images():
    import yaml
    compose=yaml.safe_load((ROOT/'deploy/compose.synology.yaml').read_text())
    app=compose['services']['app']
    assert set(compose['services'])=={'app', 'alcor-api-updater'}
    assert app['environment']['ALCOR_FILE_ROOT']=='/var/lib/alcor/uploads'
    assert app['environment']['ALCOR_ASSET_ROOT']=='/var/lib/alcor/assets'
    mounts=app['volumes']
    assert len(mounts)==5 and all(m.startswith('${ALCOR_DATA_DIR}/') for m in mounts)
    assert '${ALCOR_DATA_DIR}/images:/var/lib/alcor/assets:ro' in mounts
