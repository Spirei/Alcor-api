import sqlite3

import pytest
from alcor_api.source_snapshot import SourceDefinition, SqliteSnapshot, schema_digest
from legacy_source.synthetic_legacy import OWNER, seed_sqlite
from source_window_fixture import active_window


@pytest.fixture
def old_pg(tmp_path):
    path = tmp_path / "only-synthetic-legacy.sqlite"
    seed_sqlite(path)
    with sqlite3.connect(path) as conn:
        schema = schema_digest(SqliteSnapshot().schema(conn))
    info = path.stat()
    return SourceDefinition(
        "synthetic-old-sqlite",
        "frozen-sqlite-instance",
        "sqlite",
        (OWNER,),
        "UTC",
        schema,
        str(path),
        expected_file_identity=(info.st_dev, info.st_ino),
        migration_window=active_window(),
    )
