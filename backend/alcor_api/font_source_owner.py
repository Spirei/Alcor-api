"""Verify only source identity/schema and the allowlisted users.id, never credentials or finance."""

import asyncio
import sqlite3
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from .source_snapshot import PgSnapshot, SourceMismatch, SqliteSnapshot, schema_digest


async def verify_owner(definition, owner):
    definition.require_access(owner)
    if definition.kind == "sqlite":
        return await asyncio.to_thread(sqlite_owner, definition, owner)
    async with await psycopg.AsyncConnection.connect(
        definition.locator,
        autocommit=True,
        row_factory=dict_row,
        connect_timeout=5,
        options="-c statement_timeout=10000 -c lock_timeout=2000",
    ) as conn:

        async def query(*args):
            definition.require_access(owner)
            return await conn.execute(*args)

        await query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        try:
            row = await (
                await query(
                    "SELECT current_database() database,current_user role,current_setting('data_directory') directory,system_identifier::text,(SELECT oid::text FROM pg_database WHERE datname=current_database()) database_oid FROM pg_control_system()"
                )
            ).fetchone()
            dataset = {
                "kind": "postgres",
                "systemIdentifier": row["system_identifier"],
                "databaseOid": row["database_oid"],
            }
            if (
                row["database"] != definition.expected_database
                or row["role"] != definition.expected_role
                or Path(row["directory"]).resolve() != definition.expected_data_directory.resolve()
                or dataset != definition.expected_dataset_identity
            ):
                raise SourceMismatch("font_source_database_identity_unknown_or_changed")
            schema = await PgSnapshot().schema(conn, check=lambda: definition.require_access(owner))
            if schema_digest(schema) != definition.expected_schema_hash:
                raise SourceMismatch("source_schema_changed")
            if owner is not None:
                found = await (await query("SELECT id FROM users WHERE id=%s LIMIT 2", (owner,))).fetchall()
                if len(found) != 1:
                    raise SourceMismatch("font_source_owner_not_verified")
            definition.require_access(owner)
        finally:
            await conn.execute("ROLLBACK")


def sqlite_owner(definition, owner):
    path = Path(definition.locator)
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise SourceMismatch("source_file_identity_mismatch")
    before = path.stat()
    if (before.st_dev, before.st_ino) != definition.expected_file_identity:
        raise SourceMismatch("source_file_identity_mismatch")
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=5) as conn:

        def query(*args):
            definition.require_access(owner)
            return conn.execute(*args)

        query("PRAGMA query_only=ON")
        query("BEGIN")
        schema = SqliteSnapshot().schema(conn, check=lambda: definition.require_access(owner))
        if schema_digest(schema) != definition.expected_schema_hash:
            raise SourceMismatch("source_schema_changed")
        if (
            owner is not None
            and len(query("SELECT id FROM users WHERE id=? LIMIT 2", (owner,)).fetchall()) != 1
        ):
            raise SourceMismatch("font_source_owner_not_verified")
        after = path.stat()
        if (after.st_dev, after.st_ino) != definition.expected_file_identity:
            raise SourceMismatch("source_file_identity_mismatch")
        definition.require_access(owner)
