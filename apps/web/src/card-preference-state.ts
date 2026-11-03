type Store = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
export type CardPreferenceOperation = {
  requestId: string;
  kind: "tags" | "holdings";
};
const prefix = "alcor.card-preference-request:";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function readPreferenceOperation(
  storage: Store,
  scope: string,
): CardPreferenceOperation | null {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix) && key !== prefix + scope)
      storage.removeItem(key);
  }
  const text = storage.getItem(prefix + scope);
  if (text === null) return null;
  const value = JSON.parse(text) as CardPreferenceOperation;
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).length !== 2 ||
    typeof value.requestId !== "string" ||
    !uuid.test(value.requestId) ||
    !["tags", "holdings"].includes(value.kind)
  )
    throw new Error("原卡包请求编号无法读取");
  return { requestId: value.requestId, kind: value.kind };
}
export function retainPreferenceOperation(
  storage: Store,
  scope: string,
  value: CardPreferenceOperation,
) {
  const existing = readPreferenceOperation(storage, scope);
  if (
    existing &&
    (existing.requestId !== value.requestId || existing.kind !== value.kind)
  )
    throw new Error("请先核对原卡包请求");
  storage.setItem(
    prefix + scope,
    JSON.stringify({ requestId: value.requestId, kind: value.kind }),
  );
}
export function releasePreferenceOperation(
  storage: Store,
  scope: string,
  identifier: string,
) {
  const existing = readPreferenceOperation(storage, scope);
  if (existing?.requestId !== identifier) throw new Error("原卡包请求已变化");
  storage.removeItem(prefix + scope);
}
export type PreferenceCard = { key: string; label: string };
export function preferenceCards(
  manifest: unknown,
  custom: readonly { image: string; name: string; bank: string }[],
) {
  const result = new Map<string, PreferenceCard>();
  let invalid = 0;
  const add = (key: unknown, label: string) => {
    if (typeof key !== "string" || !key) {
      invalid += 1;
      return;
    }
    try {
      const normalized = key
        .trim()
        .split("/")
        .map((segment) => {
          try {
            return encodeURIComponent(decodeURIComponent(segment));
          } catch {
            return encodeURIComponent(segment);
          }
        })
        .join("/");
      if (!normalized || normalized.length > 600) throw new Error();
      if (!result.has(normalized))
        result.set(normalized, { key: normalized, label });
    } catch {
      invalid += 1;
    }
  };
  if (
    manifest &&
    typeof manifest === "object" &&
    "regions" in manifest &&
    Array.isArray(manifest.regions)
  )
    for (const region of manifest.regions) {
      if (!region || typeof region !== "object" || !Array.isArray(region.banks))
        continue;
      for (const bank of region.banks) {
        if (!bank || typeof bank !== "object" || !Array.isArray(bank.cards))
          continue;
        for (const card of bank.cards) {
          if (!card || typeof card !== "object") continue;
          const label = `${typeof bank.name === "string" ? bank.name : "—"} · ${typeof card.name === "string" ? card.name : "—"}`;
          add(card.file, label);
          if (Array.isArray(card.faces))
            for (const face of card.faces)
              if (face && typeof face === "object") add(face.file, label);
        }
      }
    }
  for (const card of custom) add(card.image, `${card.bank} · ${card.name}`);
  return { cards: [...result.values()], invalid };
}
