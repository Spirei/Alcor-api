export const siteArtworkFields = [
  {
    field: "ico",
    label: "网站图标",
    kind: "ico",
    description: "浏览器标签与收藏夹",
  },
  {
    field: "pwaIcon",
    label: "应用图标",
    kind: "ico",
    description: "安装到主屏幕后的入口",
  },
  {
    field: "siteLogo",
    label: "首页标志",
    kind: "logo",
    description: "站点与邮件中的品牌标识",
  },
  {
    field: "homepageBg",
    label: "首页背景",
    kind: "background",
    description: "首页品牌区域的背景",
  },
  {
    field: "loginSideImage",
    label: "登录配图",
    kind: "login",
    description: "登录入口的侧边图片",
  },
] as const;
export type SiteArtworkField = (typeof siteArtworkFields)[number]["field"];
export type SiteArtwork = {
  id: string;
  kind: string;
  public_path: string;
  served_sha256: string;
};
export type ArtworkRequest = { id: string; field: SiteArtworkField };

export function artworkRequest(raw: string | null): ArtworkRequest | null {
  if (raw === null) return null;
  const value = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).sort().join() !== "field,id" ||
    typeof value.id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      value.id,
    ) ||
    !siteArtworkFields.some((item) => item.field === value.field)
  )
    throw new Error("原图片操作编号无法读取，请先核对浏览器存储");
  return value;
}
export function siteArtworkUrl(asset?: SiteArtwork): string | undefined {
  if (
    !asset ||
    !/^[a-f0-9]{64}$/.test(asset.served_sha256) ||
    !["ico", "logo", "background", "login"].includes(asset.kind) ||
    !new RegExp(`^/uploads/${asset.kind}/[A-Za-z0-9._/-]+$`).test(
      asset.public_path,
    ) ||
    asset.public_path.includes("..") ||
    asset.public_path.includes("//")
  )
    return;
  return asset.public_path + "?sha256=" + asset.served_sha256;
}
