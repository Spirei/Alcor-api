"""Versioned public metadata edits over AssetCatalog's one transaction core."""

import hashlib
import json
import math
import re
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from .asset_lookup_contract import trim

TYPES = ("stock", "market", "flag", "crypto", "metal", "broker", "group", "icon")
V1_TYPES = ("stock", "market", "flag", "crypto", "metal")


def page_number(value, fallback=1, maximum=1000000):
    try:
        raw = trim(value or "")
        number = (
            int(raw, 0)
            if re.fullmatch(r"0[xX][a-fA-F0-9]+|0[bB][01]+|0[oO][0-7]+", raw)
            else float(raw or "0")
        )
        return min(maximum, math.floor(number)) if math.isfinite(number) and number >= 1 else fallback
    except (ValueError, OverflowError):
        return fallback


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9:._-]{1,120}", value):
        raise HTTPException(400, "素材标识无效")
    return value


def fingerprint(data):
    return hashlib.sha256(
        json.dumps(data, sort_keys=True, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode()
    ).hexdigest()


class AssetManagement:
    def __init__(self, catalog):
        self.catalog = catalog

    async def prior(self, conn, who, request_id, fp):
        row = await (
            await conn.execute(
                "SELECT * FROM asset_catalog_operations WHERE actor_id=%s AND request_id=%s",
                (who.id, request_id),
            )
        ).fetchone()
        if row and row["fingerprint"] != fp:
            raise HTTPException(409, "原请求编号已用于其他素材操作")
        return row["result"] if row else None

    async def version_for_url(self, conn, url, kind):
        if not url:
            return None
        if not isinstance(url, str) or len(url) > 1024:
            raise HTTPException(400, "图片地址无效")
        parsed = urlsplit(url)
        if parsed.scheme or parsed.netloc or not parsed.path.startswith("/uploads/asset/") or parsed.fragment:
            raise HTTPException(409, "请先在共享素材中登记公共图片原件")
        query = parse_qs(parsed.query)
        if set(query) - {"sha256"} or (
            "sha256" in query
            and (len(query["sha256"]) != 1 or not re.fullmatch(r"[a-f0-9]{64}", query["sha256"][0]))
        ):
            raise HTTPException(400, "图片摘要参数无效")
        row = await (
            await conn.execute(
                """SELECT v.id FROM system_asset_versions v LEFT JOIN system_asset_paths p ON p.current_version=v.id
            WHERE v.public_path=%s AND v.kind='asset' AND v.folder=%s
            AND ((%s::text IS NULL AND p.current_version=v.id) OR v.served_sha256=%s) ORDER BY v.created_at DESC LIMIT 1""",
                (parsed.path, kind, query.get("sha256", [None])[0], query.get("sha256", [None])[0]),
            )
        ).fetchone()
        if not row:
            raise HTTPException(409, "请先在共享素材中登记公共图片原件")
        image, _ = await self.catalog.image(conn, str(row["id"]), kind)
        if not image:
            raise HTTPException(409, "公共图片原件缺失或尚未核对")
        return str(row["id"])

    async def write(self, who, request_id, expected, raw, *, restore=False, rename=False, connection=None):
        if not isinstance(raw, dict) or set(raw) - {
            "id",
            "type",
            "market",
            "code",
            "name",
            "imageVersion",
            "darkImageVersion",
            "url",
            "urlDark",
        }:
            raise HTTPException(400, "素材字段无效")
        if type(restore) is not bool:
            raise HTTPException(400, "恢复标记无效")
        fp = fingerprint(["asset-management", expected, raw, restore, rename])
        context = self.catalog.context(who, True) if connection is None else self.catalog.context(who, True, connection=connection)
        async with context as conn:
            if prior := await self.prior(conn, who, request_id, fp):
                return prior
            current = (
                await (await conn.execute("SELECT revision FROM asset_catalog_scope FOR UPDATE")).fetchone()
            )["revision"]
            if type(expected) is not int or expected != current or expected >= 9007199254740990:
                raise HTTPException(409, "公共素材目录已变化，请重新读取")
            if rename:
                aid = identifier(raw.get("id"))
                old = await (
                    await conn.execute("SELECT * FROM asset_catalog_entries WHERE id=%s", (aid,))
                ).fetchone()
                if not old:
                    raise HTTPException(404, "素材不存在")
                kind, market, code = old["type"], old["market"], old["code"]
                name = raw.get("name")
                if not isinstance(name, str) or not trim(name):
                    raise HTTPException(400, "缺少素材名称")
            else:
                kind = raw.get("type")
                if kind not in TYPES:
                    raise HTTPException(409, "此类素材由原领域管理，当前目录仅提供只读投影")
                if any(not isinstance(raw.get(key, ""), str) for key in ("market", "code", "name")):
                    raise HTTPException(400, "素材字段无效")
                market = trim(raw.get("market") or "OTHER").upper()
                code = trim(raw.get("code", "")).upper()
                if kind in ("stock", "market") and not market:
                    raise HTTPException(400, "缺少市场标识")
                if kind not in ("market", "group") and not code:
                    raise HTTPException(400, "缺少素材代码")
                aid = identifier(
                    raw.get("id")
                    or (
                        "market:" + market
                        if kind == "market"
                        else kind + ":" + code
                        if kind in ("flag", "crypto", "metal", "broker", "icon")
                        else "stock:" + market + ":" + code
                    )
                )
                old = await (
                    await conn.execute("SELECT * FROM asset_catalog_entries WHERE id=%s", (aid,))
                ).fetchone()
                name = raw.get("name") or code or market
            tombstone = await (
                await conn.execute(
                    "SELECT * FROM asset_catalog_tombstones WHERE asset_id=%s AND restored_at IS NULL", (aid,)
                )
            ).fetchone()
            if tombstone and not restore:
                raise HTTPException(409, "素材已删除；请显式确认恢复")
            before = dict(old) if old else None
            if old and any(old[k] != v for k, v in (("type", kind), ("market", market), ("code", code))):
                raise HTTPException(409, "素材身份不可改写，请使用新标识")
            light = str(old["light_version"]) if old and old["light_version"] else None
            dark = str(old["dark_version"]) if old and old["dark_version"] else None
            if not rename:
                if "imageVersion" in raw:
                    light = raw["imageVersion"] or None
                elif raw.get("url"):
                    light = await self.version_for_url(conn, raw["url"], kind)
                if "darkImageVersion" in raw:
                    dark = raw["darkImageVersion"] or None
                elif "urlDark" in raw:
                    dark = await self.version_for_url(conn, raw["urlDark"], kind)
            if tombstone:
                await conn.execute(
                    "UPDATE asset_catalog_tombstones SET restored_at=clock_timestamp(),restored_by=%s,restored_request_id=%s WHERE asset_id=%s",
                    (who.id, request_id, aid),
                )
            entry = {
                "id": aid,
                "type": kind,
                "market": market,
                "code": code,
                "name": name,
                "imageVersion": light,
                "darkImageVersion": dark,
            }
            text = json.dumps(
                {"version": 1, "publicMetadataConfirmed": True, "entries": [entry]},
                ensure_ascii=True,
                separators=(",", ":"),
            )
            action = "restore" if tombstone else "rename" if rename else "upsert"
            result = await self.catalog.import_locked(
                conn,
                who,
                request_id,
                expected,
                hashlib.sha256(text.encode()).hexdigest(),
                text,
                "管理员素材登记",
                managed=action,
                operation_fingerprint=fp,
            )
            await self.event(conn, who, request_id, aid, action, before, result["asset"], result)
            return result

    async def event(self, conn, who, request_id, aid, kind, before, after, result):
        # Snapshots use the public projection rather than credentials/actor state.
        if before and "created_at" in before:
            before = {
                **{k: before[k] for k in ("id", "type", "market", "code", "name", "material_state")},
                "imageVersion": str(before["light_version"]) if before["light_version"] else None,
                "darkImageVersion": str(before["dark_version"]) if before["dark_version"] else None,
                "sourceId": str(before["source_id"]),
            }
        await conn.execute(
            "INSERT INTO asset_catalog_management_events(id,actor_id,request_id,asset_id,kind,before_snapshot,after_snapshot,result) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                uuid4(),
                who.id,
                request_id,
                aid,
                kind,
                Jsonb(before) if before is not None else None,
                Jsonb(after) if after is not None else None,
                Jsonb(result),
            ),
        )
        await conn.execute(
            "INSERT INTO audit_events(actor_id,action,target_id,request_id) VALUES(%s,%s,%s,%s)",
            (who.id, "asset-catalog." + kind, aid, request_id),
        )

    async def delete(self, who, request_id, expected, aid, *, connection=None):
        aid = identifier(aid)
        fp = fingerprint(["asset-delete", expected, aid])
        context = self.catalog.context(who, True) if connection is None else self.catalog.context(who, True, connection=connection)
        async with context as conn:
            if prior := await self.prior(conn, who, request_id, fp):
                return prior
            current = (
                await (await conn.execute("SELECT revision FROM asset_catalog_scope FOR UPDATE")).fetchone()
            )["revision"]
            if type(expected) is not int or expected != current or expected >= 9007199254740990:
                raise HTTPException(409, "公共素材目录已变化，请重新读取")
            row = await (
                await conn.execute("SELECT * FROM asset_catalog_entries WHERE id=%s", (aid,))
            ).fetchone()
            if row is None and aid.split(":", 1)[0] == "card":
                raise HTTPException(409, "此类素材由原领域管理，不能在当前目录删除")
            await conn.execute(
                """INSERT INTO asset_catalog_tombstones(asset_id,deleted_by,request_id) VALUES(%s,%s,%s)
                ON CONFLICT(asset_id) DO UPDATE SET deleted_at=clock_timestamp(),deleted_by=excluded.deleted_by,request_id=excluded.request_id,restored_at=NULL,restored_by=NULL,restored_request_id=NULL""",
                (aid, who.id, request_id),
            )
            result = {
                "requestId": str(request_id),
                "state": "completed",
                "kind": "delete",
                "id": aid,
                "deleted": True,
                "alreadyAbsent": row is None,
                "revision": current + 1,
            }
            await conn.execute("UPDATE asset_catalog_scope SET revision=revision+1")
            await conn.execute(
                "INSERT INTO asset_catalog_operations(actor_id,request_id,fingerprint,result) VALUES(%s,%s,%s,%s)",
                (who.id, request_id, fp, Jsonb(result)),
            )
            await self.event(conn, who, request_id, aid, "delete", dict(row) if row else None, None, result)
            return result

    async def web_icons(self, kind, selected):
        from .asset_web_keys import icon_rows, related_icons, stock_codes

        async with self.catalog.context() as conn:
            mapping = {}
            cache = {}
            budget = {"bytes": 0, "verified": set()}
            for item in selected:
                market = item["market"].upper() if kind == "stock" else ""
                codes = stock_codes(market, item["code"]) if kind == "stock" else [item]
                for code in codes:
                    row = await (
                        await conn.execute(
                            """SELECT e.* FROM asset_catalog_entries e WHERE type=%s
                        AND upper(code)=%s AND (%s='flag' OR upper(market)=%s)
                        AND NOT EXISTS(SELECT 1 FROM asset_catalog_tombstones t WHERE t.asset_id=e.id AND t.restored_at IS NULL)
                        ORDER BY created_at,id LIMIT 1""",
                            (kind, code, kind, market),
                        )
                    ).fetchone()
                    if not row:
                        continue
                    asset = await self.catalog.project(conn, row, cache, budget)
                    if not asset["imageUrl"]:
                        continue
                    if kind == "stock":
                        mapping[row["market"].upper() + ":" + row["code"].upper()] = asset["imageUrl"]
                        mapping[market + ":" + item["code"].upper()] = asset["imageUrl"]
                    else:
                        mapping[code] = asset["imageUrl"]
                    break
            return {"assets": icon_rows(kind, related_icons(mapping) if kind == "stock" else mapping)}

    async def listing(
        self,
        *,
        kind=None,
        q="",
        market=None,
        page=1,
        page_size=10,
        clamp=False,
        sort=None,
        direction="asc",
        deleted=False,
    ):
        from .card_catalog import published_card_assets

        async with self.catalog.context() as conn:
            rows = await (
                await conn.execute(
                    """SELECT e.* FROM asset_catalog_entries e WHERE (%s::text IS NULL OR type=%s)
                AND (%s::text IS NULL OR market=%s) AND EXISTS(SELECT 1 FROM asset_catalog_tombstones t WHERE t.asset_id=e.id AND t.restored_at IS NULL)=%s
                ORDER BY type,market,code LIMIT 5001""",
                    (kind, kind, market, market, deleted),
                )
            ).fetchall()
            cards = (
                await published_card_assets(conn, limit=5001)
                if kind in (None, "card") and not deleted
                else []
            )
            if len(rows) > 5000 or len(cards) > 5000:
                raise HTTPException(503, "素材列表超过读取预算，请缩小分类和筛选范围")
            records = [(row, False) for row in rows] + [
                (card, True) for card in cards if market is None or card["market"] == market
            ]
            query = trim(q)
            if sort is not None:
                from .asset_web_paging import sqlite_like_contains

                records = [
                    (row, card)
                    for row, card in records
                    if not query
                    or sqlite_like_contains(row["code"], query)
                    or sqlite_like_contains(row["name"], query)
                ]
            else:
                records = [
                    (row, card)
                    for row, card in records
                    if not query
                    or query.upper() in row["code"].upper()
                    or query.upper() in row["name"].upper()
                ]
            records.sort(key=lambda pair: (pair[0]["type"], pair[0]["market"], pair[0]["code"]))
            if sort is not None:
                records.sort(key=lambda pair: pair[0]["code"])
                if sort in ("name", "code"):
                    records.sort(key=lambda pair: pair[0][sort], reverse=direction == "desc")
            total = len(records)
            if clamp:
                page = min(page, max(1, math.ceil(total / page_size)))
            selected = records[(page - 1) * page_size : page * page_size]
            cache = {}
            budget = {"bytes": 0, "verified": set()}
            assets = []
            for row, card in selected:
                if not card:
                    assets.append(
                        {**await self.catalog.project(conn, row, cache, budget), "deleted": deleted}
                    )
                    continue
                assets.append(await self.catalog.project_card(conn, row, budget))
            revision = (await (await conn.execute("SELECT revision FROM asset_catalog_scope")).fetchone())[
                "revision"
            ]
            return {
                "assets": assets,
                "total": total,
                "page": page,
                "pageSize": page_size,
                "revision": revision,
                "coverage": "platform-public-metadata",
                "historicalCoverageKnown": False,
            }
