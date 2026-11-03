const prefix = "alcor.personal-profile.";
export function clearPersonalProfileRequests(storage: Storage, keep?: string) {
  for (const key of Object.keys(storage))
    if (key.startsWith(prefix) && key !== keep && key !== keep + ".replace")
      storage.removeItem(key);
}
export function restorePersonalProfileRequest(storage: Storage, key: string) {
  clearPersonalProfileRequests(storage, key);
  const value = storage.getItem(key);
  if (
    value !== null &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      value,
    )
  )
    throw new Error("原请求编号无效");
  return value;
}
