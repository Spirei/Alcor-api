import { useEffect, useState } from "react";
import { Globe2 } from "lucide-react";
import { api } from "./api";
import { apiSessionSnapshot, isCurrentApiSession } from "./api-session";
import { assetImageUrl } from "./local-media";
import "./material-flag.css";

/** Batch public material reads; a library restriction must not block unrelated pages. */
export function useMaterialFlags(countries: readonly string[], active = true) {
  const key = [...new Set(countries.filter(code => /^[A-Z]{2}$/.test(code)))].sort().join(",");
  const [icons, setIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!active || !key) return;
    const controller = new AbortController();
    const session = apiSessionSnapshot();
    const current = () => !controller.signal.aborted && isCurrentApiSession(session);
    void api<{ assets: { code: string; url: string }[] }>("/assets?type=flag&keys=" + key, { signal: controller.signal })
      .then(result => {
        if (current()) setIcons(Object.fromEntries(result.assets.filter(item => /^[A-Z]{2}$/.test(item.code) && assetImageUrl(item.url)).map(item => [item.code, item.url])));
      })
      .catch(() => { if (current()) setIcons({}); });
    const retire = () => { controller.abort(); setIcons({}); };
    window.addEventListener("alcor:session-changed", retire);
    window.addEventListener("alcor:session-expired", retire);
    return () => {
      controller.abort();
      window.removeEventListener("alcor:session-changed", retire);
      window.removeEventListener("alcor:session-expired", retire);
    };
  }, [key, active]);
  return icons;
}

export function MaterialFlag({ country, icons, className = "" }: {
  country?: string; icons: Record<string, string>; className?: string;
}) {
  const [failed, setFailed] = useState("");
  const src = country ? assetImageUrl(icons[country]) : "";
  return <span className={"material-flag " + className} aria-hidden="true">
    {src && failed !== src
      ? <img src={src} alt="" decoding="async" onError={() => setFailed(src)} />
      : <Globe2 size={20} />}
  </span>;
}
