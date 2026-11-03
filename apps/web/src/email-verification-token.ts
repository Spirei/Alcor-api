/** Only the in-memory verification component receives this credential. */
export function verificationToken(search: string, hash: string): string {
  const values = [
    ...new URLSearchParams(search).getAll("token"),
    ...new URLSearchParams(hash.replace(/^#/, "")).getAll("token"),
  ];
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0])
    ? values[0]
    : "";
}

/** Observe links the router cannot see, without putting credentials in history. */
export function observeVerificationLinks(
  target: Pick<Window, "addEventListener" | "removeEventListener" | "location">,
  receive: (token: string) => void,
): () => void {
  function changed() {
    const { pathname, search, hash } = target.location;
    if (pathname !== "/verify-email" || (!search && !hash)) return;
    receive(verificationToken(search, hash));
  }
  target.addEventListener("hashchange", changed);
  return () => target.removeEventListener("hashchange", changed);
}
