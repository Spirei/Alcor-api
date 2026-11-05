"""Independent release discovery and durable, fixed-target host update requests."""

import asyncio
import hashlib
import json
import secrets
import urllib.request
import urllib.error
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from . import __version__
from .models import InputModel
from .security import Identity, administrator, lock_mutation_identity

router = APIRouter(prefix="/api/deployment", tags=["deployment"])
Admin = Annotated[Identity, Depends(administrator)]


class Release(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    image: str = Field(pattern=r"^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$")
    revision: str = Field(pattern=r"^[a-f0-9]{40}$")
    schema_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class UpdateInput(InputModel):
    request_id: UUID
    release: Release


class FinishInput(InputModel):
    id: UUID
    status: Literal["succeeded", "failed", "unknown"]


def schema_hash(directory):
    h = hashlib.sha256()
    for path in sorted(directory.glob("*.sql")):
        h.update(path.name.encode() + b"\0" + path.read_bytes() + b"\0")
    return h.hexdigest()


def configured(settings):
    return bool(settings.deployment_repository and settings.deployment_image)


def already_running(settings, release):
    if not release:
        return False
    if settings.source_revision:
        return (release.revision == settings.source_revision and release.version == __version__
                and release.schema_hash == schema_hash(settings.migration_dir))
    return release.image == settings.deployment_running_image


def wake_updater(settings):
    """Best-effort wake after commit; the durable queue survives a lost HTTP notification."""
    if not settings.deployment_updater_url or not settings.deployment_runner_token:
        return

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    req = urllib.request.Request(settings.deployment_updater_url + "/v1/update", data=b"{}", method="POST",
                                 headers={"Authorization": "Bearer " + settings.deployment_runner_token.get_secret_value(),
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=1) as response:
            response.read(1024)
    except (OSError, ValueError):
        pass


def github_json(settings, path, body=None):
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "AlcorApi-release",
        "Cache-Control": "no-cache",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if settings.deployment_github_token:
        headers["Content-Type"] = "application/json"
        headers["Authorization"] = "Bearer " + settings.deployment_github_token.get_secret_value()
    request = urllib.request.Request(
        "https://api.github.com/repos/" + settings.deployment_repository + path,
        headers=headers,
        data=json.dumps(body).encode() if body is not None else None,
        method="POST" if body is not None else "GET",
    )

    # Never forward repository credentials to a redirected host.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    with urllib.request.build_opener(NoRedirect).open(request, timeout=15 if body is not None else 4) as response:
        if response.status == 204:
            return {}
        data = response.read(1048577)
    if len(data) > 1048576:
        raise ValueError("response budget")
    return json.loads(data)


async def discover(settings):
    if not configured(settings):
        raise HTTPException(409, "尚未配置独立发布仓库")
    try:
        raw = await asyncio.to_thread(github_json, settings, "/releases/latest")
        if raw.get("draft") or raw.get("prerelease"):
            raise ValueError("not a published release")
        release = Release.model_validate_json(raw["body"])
        if release.image.split("@")[0] != settings.deployment_image:
            raise ValueError("wrong image target")
        if raw.get("target_commitish") != release.revision:
            raise ValueError("wrong revision")
        return release
    except (OSError, ValueError, KeyError, TypeError):
        raise HTTPException(503, "未取得有效发布记录，请检查仓库权限、发布结果与网络") from None


@router.get("")
async def status(request: Request, who: Admin):
    from .deployment_config import effective

    settings, db = await effective(request), request.app.state.db
    from .deployment_observations import observation, package_page

    release, release_error = None, None
    observed = {
        "package_url": package_page(settings),
        "source": None,
        "check": None,
        "jobs": None,
        "jobs_error": None,
        "source_error": None,
        "build": None,
        "build_error": None,
    }
    if configured(settings):

        async def latest():
            nonlocal release, release_error
            try:
                release = await discover(settings)
            except HTTPException as exc:
                release_error = exc.detail

        async def observations():
            nonlocal observed
            observed = await observation(settings)

        await asyncio.gather(latest(), observations())
    async with db.connection() as conn:
        rows = await (
            await conn.execute(
                "SELECT id,request_id,image,version,status,created_at,claimed_at,finished_at FROM deployment_requests ORDER BY created_at DESC LIMIT 20"
            )
        ).fetchall()
        builds = await (
            await conn.execute(
                "SELECT request_id,status,created_at FROM deployment_builds WHERE repository=%s AND owner_id=%s ORDER BY created_at DESC LIMIT 10",
                (settings.deployment_repository, who.id),
            )
        ).fetchall()
        runner = await (
            await conn.execute(
                "SELECT observed_at,observed_at>clock_timestamp()-interval '3 minutes' AS online FROM deployment_runner WHERE singleton"
            )
        ).fetchone()
    compatible = bool(release and release.schema_hash == schema_hash(settings.migration_dir))
    return {
        "configured": configured(settings),
        "repository": settings.deployment_repository,
        "configuration_revision": settings.deployment_config_revision,
        "running_version": __version__,
        "running_image": settings.deployment_running_image or None,
        "running_revision": settings.source_revision or None,
        "matches_release": already_running(settings, release),
        "release": release,
        "release_error": release_error,
        **observed,
        "checked_at": datetime.now(UTC),
        "has_token": bool(settings.deployment_github_token),
        "build_requests": builds,
        "can_build": bool(configured(settings) and settings.deployment_github_token),
        "schema_compatible": compatible,
        "runner": runner,
        "receipts": rows,
        "can_update": bool(
            release
            and compatible
            and runner
            and runner["online"]
            and settings.deployment_runner_token
            and not already_running(settings, release)
            and not any(r["status"] in {"queued", "running"} for r in rows)
        ),
    }


@router.post("/requests", status_code=202)
async def submit(data: UpdateInput, request: Request, who: Admin):
    from .deployment_config import effective, guard_generation

    settings, db = await effective(request), request.app.state.db
    # An accepted UUID remains queryable even when GitHub is unavailable or the process restarted.
    async with db.connection() as conn:
        old = await (
            await conn.execute(
                "SELECT * FROM deployment_requests WHERE owner_id=%s AND request_id=%s",
                (who.id, data.request_id),
            )
        ).fetchone()
    if old:
        if any(old[k] != getattr(data.release, k) for k in ("image", "version", "revision", "schema_hash")):
            raise HTTPException(409, "此请求编号已用于不同版本")
        return public_receipt(old)
    release = await discover(settings)
    if release != data.release:
        raise HTTPException(409, "发布版本已变化，请重新检查")
    if release.schema_hash != schema_hash(settings.migration_dir):
        raise HTTPException(409, "此版本需要单独执行数据库迁移")
    if already_running(settings, release):
        raise HTTPException(409, "此镜像已在运行")
    if not settings.deployment_runner_token:
        raise HTTPException(409, "尚未配置群晖更新执行器")
    async with db.connection() as conn, conn.transaction():
        await lock_mutation_identity(conn, who, require_admin=True)
        await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended('alcor.deployment',0))")
        await guard_generation(conn, settings)
        old = await (
            await conn.execute(
                "SELECT * FROM deployment_requests WHERE owner_id=%s AND request_id=%s",
                (who.id, data.request_id),
            )
        ).fetchone()
        if old:
            if any(old[k] != getattr(release, k) for k in ("image", "version", "revision", "schema_hash")):
                raise HTTPException(409, "此请求编号已用于不同版本")
            return public_receipt(old)
        online = await (
            await conn.execute(
                "SELECT 1 FROM deployment_runner WHERE singleton AND observed_at>clock_timestamp()-interval '3 minutes'"
            )
        ).fetchone()
        if not online:
            raise HTTPException(409, "群晖更新执行器未连接")
        active = await (
            await conn.execute("SELECT 1 FROM deployment_requests WHERE status IN ('queued','running')")
        ).fetchone()
        if active:
            raise HTTPException(409, "已有更新请求，请先核对回执")
        row = await (
            await conn.execute(
                "INSERT INTO deployment_requests (id,owner_id,request_id,image,version,revision,schema_hash,status) VALUES (%s,%s,%s,%s,%s,%s,%s,'queued') RETURNING *",
                (
                    uuid4(),
                    who.id,
                    data.request_id,
                    release.image,
                    release.version,
                    release.revision,
                    release.schema_hash,
                ),
            )
        ).fetchone()
        await conn.execute(
            "INSERT INTO audit_events (actor_id,action,target_id,request_id) VALUES (%s,'deployment.requested',%s,%s)",
            (who.id, str(row["id"]), data.request_id),
        )
    await asyncio.to_thread(wake_updater, settings)
    return public_receipt(row)


def public_receipt(row):
    return {
        k: row[k]
        for k in ("id", "request_id", "image", "version", "status", "created_at", "claimed_at", "finished_at")
    }


@router.get("/requests/{request_id}")
async def receipt(request_id: UUID, request: Request, who: Admin):
    async with request.app.state.db.connection() as conn:
        row = await (
            await conn.execute(
                "SELECT * FROM deployment_requests WHERE owner_id=%s AND request_id=%s", (who.id, request_id)
            )
        ).fetchone()
    if not row:
        raise HTTPException(404, "未查到此更新请求")
    return public_receipt(row)


def runner_auth(request):
    token = request.app.state.settings.deployment_runner_token
    if not token or not secrets.compare_digest(
        request.headers.get("authorization", ""), "Bearer " + token.get_secret_value()
    ):
        raise HTTPException(403, "执行器认证失败")


@router.post("/runner/claim", include_in_schema=False)
async def claim(request: Request):
    runner_auth(request)
    async with request.app.state.db.connection() as conn, conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended('alcor.deployment',0))")
        await conn.execute(
            "INSERT INTO deployment_runner (singleton) VALUES (true) ON CONFLICT(singleton) DO UPDATE SET observed_at=clock_timestamp()"
        )
        row = await (
            await conn.execute(
                "SELECT d.* FROM deployment_requests d JOIN users u ON u.id=d.owner_id WHERE d.status='queued' FOR UPDATE OF d"
            )
        ).fetchone()
        if not row:
            return {"request": None}
        # Revoked administrators cannot leave a queued privilege behind.
        owner = await (
            await conn.execute("SELECT active,role FROM users WHERE id=%s FOR SHARE", (row["owner_id"],))
        ).fetchone()
        if not owner["active"] or owner["role"] != "admin":
            await conn.execute(
                "UPDATE deployment_requests SET status='cancelled',finished_at=clock_timestamp() WHERE id=%s",
                (row["id"],),
            )
            return {"request": None}
        await conn.execute(
            "UPDATE deployment_requests SET status='running',claimed_at=clock_timestamp() WHERE id=%s",
            (row["id"],),
        )
        return {"request": {k: row[k] for k in ("id", "image", "version", "revision", "schema_hash")}}


@router.post("/runner/finish", include_in_schema=False)
async def finish(data: FinishInput, request: Request):
    runner_auth(request)
    async with request.app.state.db.connection() as conn, conn.transaction():
        row = await (
            await conn.execute("SELECT * FROM deployment_requests WHERE id=%s FOR UPDATE", (data.id,))
        ).fetchone()
        if not row:
            raise HTTPException(404, "更新请求不存在")
        if row["status"] == data.status:
            return {"status": data.status}
        if row["status"] != "running":
            raise HTTPException(409, "更新回执状态冲突")
        await conn.execute(
            "UPDATE deployment_requests SET status=%s,finished_at=clock_timestamp() WHERE id=%s",
            (data.status, data.id),
        )
        await conn.execute(
            "INSERT INTO audit_events (actor_id,action,target_id,request_id) VALUES (%s,%s,%s,%s)",
            (row["owner_id"], "deployment." + data.status, str(data.id), row["request_id"]),
        )
    return {"status": data.status}


class BuildInput(InputModel):
    request_id: UUID


@router.post("/builds", status_code=202)
async def build_source(data: BuildInput, request: Request, who: Admin):
    from .deployment_config import effective, guard_generation

    settings, db = await effective(request), request.app.state.db
    if not configured(settings) or not settings.deployment_github_token:
        raise HTTPException(409, "尚未配置发布权限")
    async with db.connection() as conn, conn.transaction():
        await lock_mutation_identity(conn, who, require_admin=True)
        await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended('alcor.build',0))")
        await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended('alcor.deployment',0))")
        await guard_generation(conn, settings)
        old = await (
            await conn.execute(
                "SELECT request_id,status,created_at FROM deployment_builds WHERE owner_id=%s AND request_id=%s",
                (who.id, data.request_id),
            )
        ).fetchone()
        if old:
            return old
        active = await (
            await conn.execute(
                "SELECT 1 FROM deployment_builds WHERE repository=%s AND status<>'failed' AND created_at>clock_timestamp()-interval '5 minutes'",
                (settings.deployment_repository,),
            )
        ).fetchone()
        if active:
            raise HTTPException(409, "刚刚已有构建请求，请核对 GitHub 构建状态")
        from .deployment_publication import preflight

        await asyncio.to_thread(preflight, settings, github_json, Release)
        await conn.execute(
            "INSERT INTO deployment_builds (owner_id,request_id,status,repository) VALUES (%s,%s,'dispatching',%s)",
            (who.id, data.request_id, settings.deployment_repository),
        )
        await conn.execute(
            "INSERT INTO audit_events (actor_id,action,request_id) VALUES (%s,'deployment.build_requested',%s)",
            (who.id, data.request_id),
        )
    # Commit acceptance first. A crash or a lost HTTP response must never cause redispatch.
    state = "submitted"
    message = None
    try:
        await asyncio.to_thread(
            github_json,
            settings,
            "/actions/workflows/docker-publish.yml/dispatches",
            {"ref": "main", "inputs": {"request_id": str(data.request_id)}},
        )
    except urllib.error.HTTPError as exc:
        # An explicit rejection is different from losing the dispatch response.
        # Never surface provider bodies: they may contain credentials or private context.
        if 400 <= exc.code < 500 and exc.code != 408:
            state = "failed"
            message = {
                401: "GitHub 授权已失效，请重新配置发布 Token",
                403: "GitHub 拒绝构建，请核对发布 Token 的 Actions 读写权限及仓库访问权限",
                404: "GitHub 未找到发布工作流或授权无权访问仓库，请核对仓库与 Token",
                422: "GitHub 拒绝了工作流参数，请核对 main 分支的发布工作流",
                429: "GitHub 请求过于频繁，请稍后再试",
            }.get(exc.code, "GitHub 未接受构建请求，请核对发布配置")
        else:
            state = "unknown"
    except (OSError, ValueError, KeyError, TypeError):
        state = "unknown"
    async with db.connection() as conn:
        row = await (
            await conn.execute(
                "UPDATE deployment_builds SET status=%s WHERE owner_id=%s AND request_id=%s RETURNING request_id,status,created_at",
                (state, who.id, data.request_id),
            )
        ).fetchone()
    return {**row, **({"message": message} if message else {})}


@router.get("/builds/{request_id}")
async def build_receipt(request_id: UUID, request: Request, who: Admin):
    async with request.app.state.db.connection() as conn:
        row = await (
            await conn.execute(
                "SELECT request_id,status,created_at FROM deployment_builds WHERE owner_id=%s AND request_id=%s",
                (who.id, request_id),
            )
        ).fetchone()
    if not row:
        raise HTTPException(404, "未查到此构建请求")
    if row["status"] in {"unknown", "dispatching"}:
        from .deployment_config import effective
        from .deployment_build_receipts import find_run

        settings = await effective(request)
        try:
            matched = await asyncio.to_thread(find_run, settings, github_json, request_id)
        except (OSError, ValueError, KeyError, TypeError):
            matched = False
        if matched:
            async with request.app.state.db.connection() as conn:
                row = await (await conn.execute(
                    "UPDATE deployment_builds SET status='submitted' WHERE owner_id=%s AND request_id=%s AND status IN ('unknown','dispatching') RETURNING request_id,status,created_at",
                    (who.id, request_id),
                )).fetchone() or row
    return row
