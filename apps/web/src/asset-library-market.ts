/** Market slots follow the old Web. Files remain independent originals. */
export const libraryMarkets: Record<string, string> = {
  US: "美股",
  HK: "港股",
  CN: "A股",
  JP: "日股",
  KR: "韩股",
  SG: "新加坡",
  UK: "英国",
  DE: "德国",
  FR: "法国",
  AU: "澳大利亚",
  CA: "加拿大",
  IN: "印度",
  TW: "台湾",
  BR: "巴西",
};
export type LibraryAsset = {
  id: string;
  name: string;
  type?: string;
  code?: string;
  market?: string;
  imageUrl?: string;
  imageUrlDark?: string;
  readOnly?: boolean;
  placeholder?: boolean;
  bank?: string;
  region?: string;
  customized?: boolean;
  originalImageUrl?: string;
  imageInheritance?: { market: string; code: string };
  iconTarget?: {
    id: string;
    type: string;
    market: string;
    code: string;
    name: string;
  };
};
export function libraryMarketOrder(value: unknown): string[] {
  return [
    ...new Set([
      ...(Array.isArray(value)
        ? value.filter(
            (v): v is string =>
              typeof v === "string" && Object.hasOwn(libraryMarkets, v),
          )
        : []),
      ...Object.keys(libraryMarkets),
    ]),
  ];
}
export function moveLibraryMarket(
  order: readonly string[],
  code: string,
  target: string,
) {
  const next = libraryMarketOrder(order),
    from = next.indexOf(code),
    to = next.indexOf(target);
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
export function marketSlots<T extends LibraryAsset>(
  rows: T[],
  flags: Record<string, string> = {},
): LibraryAsset[] {
  const selected = new Map<string, LibraryAsset>();
  for (const row of rows) {
    const code = (row.market || row.code || "").toUpperCase();
    if (!code || ["SPX", "EU"].includes(code)) continue;
    const old = selected.get(code);
    if (!old || (old.readOnly && !row.readOnly))
      selected.set(code, { ...row, market: code, code });
  }
  const keys = [
    ...Object.keys(libraryMarkets),
    ...[...selected.keys()].filter(
      (key) => !Object.hasOwn(libraryMarkets, key),
    ),
  ];
  return keys.map((code) => ({
    ...{
      id: `market:${code}`,
      type: "market",
      market: code,
      code,
      name: libraryMarkets[code] || code,
      imageUrl: flags[code === "UK" ? "GB" : code],
      placeholder: true,
    },
    ...selected.get(code),
    imageUrl:
      selected.get(code)?.imageUrl || flags[code === "UK" ? "GB" : code],
  }));
}

export function brokerOrder(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (v): v is string =>
              typeof v === "string" && /^[A-Za-z0-9:._-]{1,120}$/.test(v),
          ),
        ),
      ].slice(0, 500)
    : [];
}
