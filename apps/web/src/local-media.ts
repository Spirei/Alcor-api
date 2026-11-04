/** Only local paths resolved by the registered media authority may be embedded. */
export function assetImageUrl(value?: string): string {
  return value &&
    /^\/(?:api\/asset-image\/|uploads\/)[^\\\s#]*$/.test(value) &&
    !/%(?:2f|5c|00|2e)/i.test(value) &&
    !value.split("?")[0].split("/").includes("..")
    ? value
    : "";
}
