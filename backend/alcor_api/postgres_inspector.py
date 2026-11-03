"""Bounded, read-only catalog and row inspection for the exact tested PostgreSQL role."""

import asyncio
import json
import re
import secrets
import time
from decimal import Decimal
from typing import Annotated, Literal

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg import sql
from psycopg.rows import dict_row
from pydantic import Field, field_validator

from .connection_models import PostgresConfig
from .connections import canonical
from .models import InputModel
from .security import Identity, administrator, lock_mutation_identity

router = APIRouter(prefix="/api/connections/postgresql", tags=["database-inspection"])
Admin = Annotated[Identity, Depends(administrator)]
PROTECTED = {
    "identity_challenges",
    "identity_source_profiles",
    "restore_quarantine",
    "connection_receipts",
    "account_actions",
}
PREVIEW_TYPES = {
    "int2",
    "int4",
    "int8",
    "float4",
    "float8",
    "numeric",
    "bool",
    "text",
    "varchar",
    "bpchar",
    "name",
    "uuid",
    "date",
    "timestamp",
    "timestamptz",
    "time",
    "timetz",
    "interval",
    "json",
    "jsonb",
}
SENSITIVE = re.compile(
    r"(?:^|_)(?:api_key|access_key|encryption_key|password|passwd|pwd|secret|token|credentials?|ciphertext|private_key|backup_codes?|backup_key|cookie|code_hash|authorization)(?:_|$)",
    re.IGNORECASE,
)


def sensitive(name):
    return bool(SENSITIVE.search(re.sub(r"([a-z])([A-Z])", r"\1_\2", name)))


def issue_ticket(service, who, config, password, address):
    return service.vault.encrypt(
        canonical(
            {
                "owner": who.id,
                "binding": who.token_hash,
                "expires": int(time.time()) + 600,
                "config": config.model_dump(),
                "password": password,
                "address": address,
            }
        ),
        "postgresql-inspection",
        service.base.instance_id,
    )


def ticket_value(service, who, ticket):
    try:
        value = json.loads(service.vault.decrypt(ticket, "postgresql-inspection", service.base.instance_id))
        if (
            value["owner"] != who.id
            or not secrets.compare_digest(value["binding"], who.token_hash)
            or value["expires"] <= time.time()
        ):
            raise ValueError()
        return value
    except (HTTPException, ValueError, TypeError, KeyError):
        raise HTTPException(410, "浏览凭据已过期或不属于当前会话，请重新测试连接") from None


class InspectionInput(InputModel):
    ticket: str = Field(min_length=32, max_length=16384)
    view: Literal["databases", "schemas", "tables", "rows"]
    database: str = Field(default="", max_length=128)
    schema_name: str = Field(default="", max_length=128)
    table: str = Field(default="", max_length=128)
    after: str = Field(default="", max_length=128)
    offset: int = Field(default=0, ge=0, le=10000)

    @field_validator("database", "schema_name", "table", "after")
    @classmethod
    def names(cls, value):
        if any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("Invalid object name")
        value.encode("utf-8")
        return value


def clean_json(value, depth=0):
    if depth > 6:
        return "…"
    if isinstance(value, dict):
        return {k: "••••" if sensitive(k) else clean_json(v, depth + 1) for k, v in list(value.items())[:30]}
    if isinstance(value, list):
        return [clean_json(v, depth + 1) for v in value[:30]]
    if isinstance(value, str):
        return value[:512] + ("…" if len(value) > 512 else "")
    return value


def json_text(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return (
            "{"
            + ", ".join(json.dumps(k, ensure_ascii=False) + ": " + json_text(v) for k, v in value.items())
            + "}"
        )
    if isinstance(value, list):
        return "[" + ", ".join(json_text(v) for v in value) + "]"
    return json.dumps(value, ensure_ascii=False)


async def inspect_data(conn, data):
    context = await (
        await conn.execute(
            "SELECT current_database() AS database,current_user AS account,current_setting('transaction_read_only') AS read_only"
        )
    ).fetchone()
    if context["read_only"] != "on":
        raise HTTPException(503, "只读连接未建立")
    if data.view == "databases":
        rows = await (
            await conn.execute(
                'SELECT datname AS name FROM pg_database WHERE datallowconn AND NOT datistemplate AND has_database_privilege(oid,\'CONNECT\') AND datname COLLATE "C">%s COLLATE "C" ORDER BY datname COLLATE "C" LIMIT 101',
                (data.after,),
            )
        ).fetchall()
        return context | {"items": rows[:100], "next": rows[99]["name"] if len(rows) > 100 else None}
    if data.view == "schemas":
        rows = await (
            await conn.execute(
                """SELECT n.nspname AS name,(SELECT count(*) FROM pg_class c WHERE c.relnamespace=n.oid
                AND c.relkind IN ('r','p','v','m') AND has_any_column_privilege(c.oid,'SELECT')) AS accessible_tables
                FROM pg_namespace n WHERE left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema'
                AND has_schema_privilege(n.oid,'USAGE') AND n.nspname COLLATE "C">%s COLLATE "C"
                ORDER BY n.nspname COLLATE "C" LIMIT 101""",
                (data.after,),
            )
        ).fetchall()
        return context | {"items": rows[:100], "next": rows[99]["name"] if len(rows) > 100 else None}
    if not data.schema_name or data.schema_name.startswith("pg_") or data.schema_name == "information_schema":
        raise HTTPException(422, "请选择可访问的业务Schema")
    if data.view == "tables":
        rows = await (
            await conn.execute(
                """SELECT c.relname AS name,c.relkind AS kind,
            CASE WHEN c.reltuples<0 THEN NULL ELSE c.reltuples::bigint END AS estimated_rows
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname=%s AND has_schema_privilege(n.oid,'USAGE') AND c.relkind IN ('r','p','v','m')
            AND has_any_column_privilege(c.oid,'SELECT') AND c.relname COLLATE "C">%s COLLATE "C"
            ORDER BY c.relname COLLATE "C" LIMIT 101""",
                (data.schema_name, data.after),
            )
        ).fetchall()
        return context | {"items": rows[:100], "next": rows[99]["name"] if len(rows) > 100 else None}
    relation = await (
        await conn.execute(
            """SELECT c.oid,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=%s AND c.relname=%s AND c.relkind IN ('r','p','v','m')
        AND has_schema_privilege(n.oid,'USAGE') AND has_any_column_privilege(c.oid,'SELECT')""",
            (data.schema_name, data.table),
        )
    ).fetchone()
    if not relation:
        raise HTTPException(404, "该账号无法读取此表")
    columns = await (
        await conn.execute(
            """SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
        t.typname AS native_type,n.nspname AS type_schema,NOT a.attnotnull AS nullable,
        has_column_privilege(a.attrelid,a.attnum,'SELECT') AS readable,
        EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=a.attrelid AND i.indisprimary AND a.attnum=ANY(i.indkey)) AS primary_key
        FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace n ON n.oid=t.typnamespace
        WHERE a.attrelid=%s AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum LIMIT 201""",
            (relation["oid"],),
        )
    ).fetchall()
    for column in columns:
        column["redacted"] = sensitive(column["name"]) or not column["readable"]
        column["previewable"] = (
            column["type_schema"] == "pg_catalog" and column["native_type"] in PREVIEW_TYPES
        )
    note = ""
    if data.table in PROTECTED:
        note = "此表包含认证或连接凭据，仅显示结构"
    if note:
        return context | {
            "columns": columns[:200],
            "rows": [],
            "has_more": False,
            "offset": data.offset,
            "note": note,
        }
    target = sql.SQL("{}.{}").format(sql.Identifier(data.schema_name), sql.Identifier(data.table))
    readable = next((column["name"] for column in columns if column["readable"]), None)
    if not readable:
        raise HTTPException(422, "没有可读取的列")
    # SELECT acquires an access-share lock without requiring table-wide privileges.
    await conn.execute(sql.SQL("SELECT {} FROM {} LIMIT 0").format(sql.Identifier(readable), target))
    current = await (
        await conn.execute("SELECT to_regclass(%s)::oid AS oid", (target.as_string(conn),))
    ).fetchone()
    if current["oid"] != relation["oid"]:
        raise HTTPException(409, "数据表结构已改变，请重新选择")
    expressions = []
    displayed = columns[:40]
    for column in displayed:
        value = (
            sql.SQL("NULL::text")
            if column["redacted"] or not column["previewable"]
            else sql.SQL("left({}::text,2049)").format(sql.Identifier(column["name"]))
        )
        expressions.append(sql.SQL("{} AS {}").format(value, sql.Identifier(column["name"])))
    if not expressions:
        raise HTTPException(422, "此表没有可预览的列")
    primary = [
        sql.Identifier("inspected", c["name"])
        for c in columns
        if c["primary_key"] and c["readable"] and c["previewable"]
    ]
    if primary:
        order = sql.SQL(",").join(primary)
    elif relation["relkind"] == "v":
        sort_column = next(
            (
                c["name"]
                for c in columns
                if c["readable"] and c["previewable"] and c["native_type"] not in {"json", "jsonb"}
            ),
            None,
        )
        order = sql.Identifier("inspected", sort_column) if sort_column else sql.SQL("(SELECT NULL)")
    else:
        order = sql.SQL("inspected.tableoid,inspected.ctid")
    rows = await (
        await conn.execute(
            sql.SQL("SELECT {} FROM {} AS inspected ORDER BY {} LIMIT 26 OFFSET %s").format(
                sql.SQL(",").join(expressions), target, order
            ),
            (data.offset,),
        )
    ).fetchall()
    for row in rows:
        for column in displayed:
            name = column["name"]
            if column["redacted"]:
                row[name] = "••••"
            elif not column["previewable"]:
                row[name] = "[未预览]"
            elif row[name] is not None:
                raw = row[name]
                if column["native_type"] in {"json", "jsonb"}:
                    try:
                        raw = json_text(clean_json(json.loads(raw, parse_float=Decimal)))
                    except ValueError:
                        raw = "[内容过长，未预览]"
                row[name] = raw[:512] + ("…" if len(raw) > 512 else "")
    return context | {
        "columns": columns[:200],
        "displayed_columns": [c["name"] for c in displayed],
        "rows": rows[:25],
        "has_more": len(rows) > 25 and data.offset < 10000,
        "offset": data.offset,
        "note": "",
    }


@router.post("/inspect")
async def inspect_postgres(data: InspectionInput, request: Request, who: Admin):
    db = request.app.state.db
    if not await request.app.state.rate_limit(db, "postgres-inspect:" + who.id, 120):
        raise HTTPException(429, "浏览请求过于频繁，请稍后再试")
    service = request.app.state.connections
    async with db.connection() as auth, auth.transaction():
        await lock_mutation_identity(auth, who)
        value = ticket_value(service, who, data.ticket)
        config = PostgresConfig(**value["config"])
        params = {
            "host": config.host,
            "port": config.port,
            "user": config.username,
            "password": value["password"],
            "dbname": data.database or config.database,
            "sslmode": config.ssl_mode,
            "connect_timeout": config.connect_timeout,
        }
        if not config.host.startswith("/"):
            params["hostaddr"] = value["address"]
        try:
            async with (
                asyncio.timeout(6),
                await psycopg.AsyncConnection.connect(
                    **params,
                    autocommit=True,
                    row_factory=dict_row,
                    options="-c default_transaction_read_only=on -c statement_timeout=2000 -c lock_timeout=1000 -c search_path=pg_catalog",
                ) as conn,
                conn.transaction(),
            ):
                result = await inspect_data(conn, data)
        except (psycopg.Error, TimeoutError):
            raise HTTPException(422, "读取失败，请核对数据库账号权限或重新测试连接") from None
        await conn_audit(auth, who, data)
        return result


async def conn_audit(conn, who, data):
    await conn.execute(
        "INSERT INTO audit_events(actor_id,action,target_id) VALUES(%s,'connection.inspected',%s)",
        (who.id, data.view + ":" + data.database + ":" + data.schema_name + ":" + data.table),
    )
