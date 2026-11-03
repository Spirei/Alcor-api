import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { safeReturnPath } from "./site-paths";
type Site = { title: string; logoText: string; siteLogo: string; ico: string; mobileNavigationOrder:string[];marketBadges:Record<string,{label:string;bg:string;fg:string}>;marketBadgesVisible:boolean;homeNav: { key: string; label: string; href: string; enabled: boolean }[] };
const defaults: Site = { title: "Alcor", logoText: "Alcor", siteLogo: "", ico: "", mobileNavigationOrder:[],marketBadges:{},marketBadgesVisible:true,homeNav: [] };
const Context = createContext<Site>(defaults);
export const usePublicSite = () => useContext(Context);
function asset(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return "";
  try { const url = new URL(value, location.origin); return url.origin === location.origin ? url.pathname + url.search : ""; } catch { return ""; }
}
export function PublicSiteProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState(defaults);
  useEffect(() => {
    let controller = new AbortController();
    const load=()=>{controller.abort();controller=new AbortController();const current=controller;
    void fetch("/api/settings/public", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(({ settings }) => {
        if (current.signal.aborted || !settings || typeof settings !== "object") return;
        setSite({ title: typeof settings.title === "string" ? settings.title : defaults.title,
          logoText: typeof settings.logoText === "string" ? settings.logoText : defaults.logoText,
          siteLogo: asset(settings.siteLogo), ico: asset(settings.ico),
          mobileNavigationOrder:Array.isArray(settings.mobileNavigationOrder)?settings.mobileNavigationOrder.filter((value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value)).slice(0,100):[],
          marketBadgesVisible:settings.marketBadgesVisible!==false,
          marketBadges:settings.marketBadges&&typeof settings.marketBadges==='object'&&!Array.isArray(settings.marketBadges)?Object.fromEntries(Object.entries(settings.marketBadges).filter(([,value])=>{const badge=value as {label?:unknown;bg?:unknown;fg?:unknown}|null;return badge&&typeof badge.label==='string'&&typeof badge.bg==='string'&&/^#[0-9a-f]{6}$/i.test(badge.bg)&&typeof badge.fg==='string'&&/^#[0-9a-f]{6}$/i.test(badge.fg);})) as Site['marketBadges']: {},
          homeNav: Array.isArray(settings.homeNav) ? settings.homeNav.filter((row: Site["homeNav"][number]) => row && typeof row.key === "string" && typeof row.label === "string" && typeof row.href === "string" && row.enabled === true).slice(0, 20) : [] });
      }).catch(() => { /* Unavailable public configuration never substitutes private settings. */ });
    };load();window.addEventListener("alcor:public-site-updated",load);
    return () => {controller.abort();window.removeEventListener("alcor:public-site-updated",load);};
  }, []);
  useEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) { icon.href = site.ico || "/assets/brand.svg"; icon.removeAttribute("type"); }
  }, [site.ico]);
  return <Context.Provider value={site}>{children}</Context.Provider>;
}
export function PublicHomeNav() {
  const site = usePublicSite();
  const links = site.homeNav.flatMap(row => {
    const href = row.href.startsWith("#") && /^#[A-Za-z][\w-]*$/.test(row.href) ? row.href : safeReturnPath(row.href);
    return href ? [{ ...row, href }] : [];
  });
  return links.length ? <nav aria-label="站点导航">{links.map(row => <NavLink key={row.key} to={row.href}>{row.label}</NavLink>)}</nav> : null;
}
export function registerSiteWorker() {
  if (!("serviceWorker" in navigator) || !(location.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname))) return;
  void navigator.serviceWorker.register("/service-worker.js", { scope: "/", updateViaCache: "none" }).catch(() => { /* Registration failure does not imply installation. */ });
}
