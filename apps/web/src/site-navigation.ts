// Default old workspace keys, confirmed in fire-web/lib/settings.ts.
export const legacyNavigation: Record<string, { path: string; label: string }> =
  {
    holdings: { path: "/portfolio", label: "账户资产" },
    assets: { path: "/portfolio", label: "资产分析" },
    watchlist: { path: "/portfolio", label: "自选记录" },
    fire: { path: "/fire", label: "FIRE" },
    global: { path: "/market", label: "全球资产" },
    trading: { path: "/feed", label: "动态" },
    earnings: { path: "/market", label: "财报日程" },
    celebs: { path: "/celebs", label: "名人持仓" },
    users: { path: "/users", label: "用户管理" },
    attachments: { path: "/attachments", label: "共享附件" },
    library: { path: "/shared-assets", label: "共享素材" },
    cards: { path: "/cards", label: "卡面" },
    activities: { path: "/activity", label: "活动" },
    settings: { path: "/settings", label: "设置" },
  };
export function mobileNavigation<T extends { path: string }>(
  items: readonly T[],
  order: readonly string[],
  mobile: boolean,
): T[] {
  if (!mobile || !order.length) return [...items];
  const paths = [
    ...new Set(
      order.flatMap((key) =>
        Object.hasOwn(legacyNavigation, key)
          ? [legacyNavigation[key].path]
          : [],
      ),
    ),
  ];
  return [...items].sort((a, b) => {
    const x = paths.indexOf(a.path),
      y = paths.indexOf(b.path);
    return (x < 0 ? paths.length : x) - (y < 0 ? paths.length : y);
  });
}

const workspaceSections = [
  {
    key: "assets",
    label: "资产",
    paths: [
      "/portfolio",
      "/fire",
      "/watch-groups",
      "/market",
      "/reference",
      "/feed",
      "/celebs",
      "/fees",
      "/simple",
    ],
  },
  {
    key: "management",
    label: "管理",
    paths: [
      "/users",
      "/attachments",
      "/shared-assets",
      "/cards",
      "/financial-reports",
      "/resources",
      "/legacy-import",
      "/activity",
    ],
  },
  {
    key: "system",
    label: "系统",
    paths: ["/", "/tasks", "/migration", "/backups", "/account", "/settings"],
  },
] as const;

/** Group only supplied, already-authorized entries. Unknown entries remain reachable. */
export function workspaceNavigation<T extends { path: string }>(
  items: readonly T[],
  preferInputOrder = false,
): { key: string; label: string; items: T[] }[] {
  const byPath = new Map(items.map((item) => [item.path, item]));
  const assigned = new Set<string>();
  const sections: { key: string; label: string; items: T[] }[] =
    workspaceSections.map((section) => ({
      key: section.key,
      label: section.label,
      items: section.paths.flatMap((path) => {
        const item = byPath.get(path);
        if (!item) return [];
        assigned.add(path);
        return [item];
      }),
    }));
  const remaining = items.filter((item) => !assigned.has(item.path));
  if (remaining.length)
    sections.push({ key: "other", label: "其他", items: remaining });
  const visible = sections.filter((section) => section.items.length);
  if (preferInputOrder) {
    const position = new Map(items.map((item, index) => [item.path, index]));
    for (const section of visible)
      section.items.sort(
        (a, b) => position.get(a.path)! - position.get(b.path)!,
      );
    visible.sort(
      (a, b) => position.get(a.items[0].path)! - position.get(b.items[0].path)!,
    );
  }
  return visible;
}

/** Resolve child pages without assigning inaccessible routes to a navigation group. */
export function currentNavigationSection<T extends { path: string }>(
  sections: readonly { key: string; items: readonly T[] }[],
  pathname: string,
): string | undefined {
  const parent = pathname.startsWith("/connections/") || pathname === "/deploy-status"
    ? "/"
    : pathname;
  return sections.find(section => section.items.some(item => item.path === parent))?.key;
}
