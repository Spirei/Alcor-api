"""Shared system uploads and narrowly indexed public rendering; no public directory mount."""

import asyncio
import re
from uuid import UUID, uuid4

from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile

from .profile_http import bounded_body
from .resource_api import PrivateResourceResponse, byte_range
from .security import digest, identity
from .system_assets import SystemAssets

# Bundled illustration from the old security-check route. Host volumes are not consulted.
SECURITY_CHECK_SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100" fil'
    b'l="none"><defs><linearGradient id="shield" x1="20" y1="10" x2="77" y2="82" gradientUnits="'
    b'userSpaceOnUse"><stop stop-color="#9b9cff"/><stop offset=".38" stop-color="#0866ff"/><stop'
    b' offset="1" stop-color="#00d5f4"/></linearGradient><linearGradient id="fold" x1="32" y1="4'
    b'9" x2="60" y2="90" gradientUnits="userSpaceOnUse"><stop stop-color="#1340da"/><stop offset'
    b'="1" stop-color="#002a98"/></linearGradient></defs><path d="M49 8c-14 0-27 5-35 10v27c0 23'
    b' 13 37 35 47 22-10 35-24 35-47V18C76 13 63 8 49 8Z" fill="url(#shield)"/><path d="M14 36c7'
    b' 23 21 38 45 46l-10 10C27 82 14 68 14 45Z" fill="url(#fold)"/><circle cx="76" cy="64" r="2'
    b'2" fill="white"/><circle cx="76" cy="64" r="17" stroke="#0866ff" stroke-width="3.5"/><path'
    b' d="M76 54v12" stroke="#0866ff" stroke-width="4" stroke-linecap="round"/><circle cx="76" c'
    b'y="73" r="2.2" fill="#0866ff"/></svg>'
)


def mount_system_assets(app, settings, db, rate_limit):
    service = SystemAssets(db)
    app.state.system_assets = service

    async def admin(request):
        if "authorization" in request.headers:
            raise HTTPException(403, "请使用当前网页管理员会话")
        who = await identity(request)
        if who.role != "admin":
            raise HTTPException(403, "需要管理员权限")
        return who

    async def form_upload(who, form, request, canonical=False):
        if (
            set(form) - {"file", "kind", "folder", "name", "code", "market", "requestId", "expectedRevision"}
            or len(form.getlist("file")) != 1
            or any(len(form.getlist(k)) != 1 for k in form)
        ):
            raise HTTPException(400, "上传表单无效")
        file = form.get("file")
        if not isinstance(file, UploadFile):
            raise HTTPException(400, "请选择要上传的文件")
        fields = {k: v for k, v in form.items() if k != "file"}
        if any(not isinstance(v, str) for v in fields.values()):
            raise HTTPException(400, "上传字段无效")
        if canonical and ("requestId" not in fields or "expectedRevision" not in fields):
            raise HTTPException(400, "需要原UUID和当前素材修订")
        fields.setdefault("requestId", str(uuid4()))
        if "expectedRevision" in fields:
            value = fields["expectedRevision"]
            if not value.isascii() or not value.isdecimal() or len(value) > 16:
                raise HTTPException(400, "素材修订无效")
            fields["expectedRevision"] = int(value)
        value = await service.upload(
            who, fields, file.filename or "", await file.read(20971521), request.state.request_id, canonical
        )
        body = (
            value
            if canonical
            else {"url": value["legacyUrl"]}
            if value["state"] == "completed"
            else {"error": value["message"]}
        )
        return JSONResponse(
            body,
            status_code=value["httpStatus"],
            headers={
                "Cache-Control": "no-store",
                "X-Alcor-Operation": value["requestId"],
                "X-Alcor-Revision": str(value["revision"]),
            },
        )

    app.state.system_asset_form = form_upload

    @app.get("/api/admin/shared-assets")
    async def read(request: Request):
        if request.query_params:
            raise HTTPException(400, "查询字段无效")
        return await service.read(await admin(request))

    @app.post("/api/admin/shared-assets/upload")
    async def upload(request: Request):
        who = await admin(request)
        address = request.client.host if request.client else "unknown"
        for key, maximum in ((digest("upload:" + address + ":" + who.id), 60), ("upload-global", 600)):
            if not await rate_limit(db, key, maximum, window_seconds=3600):
                raise HTTPException(429, "上传过于频繁")
        if request.query_params:
            raise HTTPException(400, "查询字段无效")
        async with app.state.resource_library.upload_slot():
            await bounded_body(request, 21 * 1024 * 1024)
            form = await request.form(max_files=1, max_fields=12)
            try:
                return await form_upload(who, form, request, True)
            finally:
                await form.close()

    @app.get("/api/admin/shared-assets/operations/{identifier}")
    async def receipt(identifier: UUID, request: Request):
        if request.query_params:
            raise HTTPException(400, "查询字段无效")
        return await service.receipt(await admin(request), identifier)

    @app.get("/api/admin/shared-assets/versions/{identifier}/original")
    async def original(identifier: UUID, request: Request):
        if request.query_params:
            raise HTTPException(400, "查询字段无效")
        row, stream = await service.original(await admin(request), identifier)
        return content(request, row, stream, private=True)

    @app.get("/uploads/{path:path}")
    async def public(path: str, request: Request):
        if re.search(b"%2f|%5c|%00", request.scope.get("raw_path", b""), re.IGNORECASE):
            raise HTTPException(400, "无效的素材路径")
        query = request.query_params
        if "sha256" in query and (len(query.getlist("sha256")) != 1 or set(query) != {"sha256"}):
            raise HTTPException(400, "素材摘要参数无效")
        # Old public URLs ignore ordinary cache-busting query fields; sha256 is strict.
        sha = query.get("sha256")
        row, stream = await service.public("/uploads/" + path, sha)
        return content(request, row, stream, immutable=sha is not None)

    @app.get(
        "/api/system-assets/security-check",
        responses={200: {"content": {"image/svg+xml": {}}}},
    )
    async def security_check():
        return security_check_response()


def security_check_response():
    return Response(SECURITY_CHECK_SVG, headers={
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
    })


def content(request, row, stream, private=False, immutable=False):
    size = row["original_size"] if private else row["served_size"]
    sha = row["original_sha256"] if private else row["served_sha256"]
    headers = {
        "Content-Type": row["media_type"],
        "Content-Length": str(size),
        "ETag": '"' + sha + '"',
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store"
        if private
        else "public, max-age=31536000, immutable"
        if immutable
        else "public, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'",
    }
    if private:
        headers["Content-Disposition"] = "attachment"
    if not private and request.headers.get("if-none-match") in (headers["ETag"], "*"):
        stream.close()
        return Response(status_code=304, headers={k: v for k, v in headers.items() if k != "Content-Length"})
    if len(request.headers.getlist("range")) > 1:
        stream.close()
        return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"})
    try:
        start, end = byte_range(request.headers.get("range"), size)
    except HTTPException:
        stream.close()
        return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"})
    length = end - start + 1
    headers["Content-Length"] = str(length)
    if "range" in request.headers:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"

    async def chunks():
        try:
            stream.seek(start)
            remaining = length
            while remaining:
                raw = await asyncio.to_thread(stream.read, min(1048576, remaining))
                if not raw:
                    raise OSError("original truncated")
                remaining -= len(raw)
                yield raw
        finally:
            stream.close()

    return PrivateResourceResponse(
        stream, chunks(), status_code=206 if "range" in request.headers else 200, headers=headers
    )
