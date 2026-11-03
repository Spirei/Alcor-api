"""Validate the selected release and private mounts, then exec the process supervisor. No DB access."""

import os
import sys

from alcor_api import __version__
from alcor_api.backups import BackupFailure, private_dir, private_read, tools
from alcor_api.config import Settings


def validate(settings, release):
    if release != __version__:
        raise BackupFailure("运行版本与发布清单不符")
    directories = [
        settings.connection_secret_dir,
        settings.file_root,
        settings.backup_dir,
        settings.backup_secret_dir,
    ]
    if any(p is None or not p.is_absolute() for p in directories):
        raise BackupFailure("私有持久目录未明确配置")
    if settings.asset_root is not None:
        if not settings.asset_root.is_absolute():
            raise BackupFailure("素材目录须使用绝对路径")
        directories.append(settings.asset_root)
    resolved = [p.resolve() for p in directories]
    if any(
        a == b or a.is_relative_to(b) or b.is_relative_to(a)
        for i, a in enumerate(resolved)
        for b in resolved[i + 1 :]
    ):
        raise BackupFailure("秘密、文件和备份目录须分开")
    for p in directories:
        private_dir(p)
    for root in [settings.connection_secret_dir, settings.backup_secret_dir]:
        for path in root.iterdir():
            if path.suffix in {".key", ".enc"}:
                private_read(path, 65536)
    tools(settings, "pg_dump")
    tools(settings, "pg_restore")
    return {"version": __version__, "private_storage": "verified", "database_accessed": False}


def main():
    os.umask(0o077)
    try:
        validate(Settings(), os.environ.get("ALCOR_RELEASE_VERSION", ""))
    except (BackupFailure, OSError, ValueError):
        print(
            "Startup refused: check the release version, private mount ownership/permissions and PostgreSQL client tools.",
            file=sys.stderr,
        )
        raise SystemExit(1)
    if len(sys.argv) < 2:
        raise SystemExit("Missing process supervisor command")
    os.execvp(sys.argv[1], sys.argv[1:])


if __name__ == "__main__":
    main()
