import type { LibraryAsset } from "./asset-library-market";
const names: Record<string, string> = {
  AX: "奥兰群岛",
  BO: "玻利维亚",
  CD: "刚果民主共和国",
  CG: "刚果共和国",
  CI: "科特迪瓦",
  CZ: "捷克",
  FM: "密克罗尼西亚",
  GB: "英国",
  HK: "中国香港",
  KR: "韩国",
  KP: "朝鲜",
  LA: "老挝",
  MO: "中国澳门",
  MK: "北马其顿",
  PS: "巴勒斯坦",
  RU: "俄罗斯",
  ST: "圣多美和普林西比",
  SZ: "斯威士兰",
  TR: "土耳其",
  TW: "中国台湾",
  US: "美国",
  VA: "梵蒂冈",
  VE: "委内瑞拉",
  VN: "越南",
  XK: "科索沃",
  EU: "欧盟",
};
const regions = new Intl.DisplayNames(["zh-Hans-CN"], { type: "region" });
const collator = new Intl.Collator("zh-Hans-CN", { numeric: true });
export function materialLabel(asset: LibraryAsset, kind: string): LibraryAsset {
  const code = (asset.code || "").toUpperCase();
  // Explicit labels, including the user's own changes, always take precedence.
  if (
    kind !== "flag" ||
    !/^[A-Z]{2}$/.test(code) ||
    asset.name.toUpperCase() !== code
  )
    return asset;
  return { ...asset, name: names[code] || regions.of(code) || asset.name };
}
export function localizedMaterials(
  rows: LibraryAsset[],
  kind: string,
  query: string,
  market: string,
) {
  const text = query.trim().toLocaleLowerCase();
  return rows
    .map((a) => materialLabel(a, kind))
    .filter(
      (a) =>
        (!text ||
          `${a.name} ${a.code || ""} ${a.bank || ""} ${a.region || ""}`
            .toLocaleLowerCase()
            .includes(text)) &&
        (!market ||
          (a.market || "OTHER") === market ||
          (market === "OTHER" &&
            ["GROUP", "OTHER", ""].includes(a.market || ""))),
    )
    .sort((a, b) =>
      kind === "flag"
        ? collator.compare(a.name, b.name) ||
          collator.compare(a.code || "", b.code || "")
        : 0,
    );
}
