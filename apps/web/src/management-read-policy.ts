/** Memory snapshots are only for ordinary management reads, never financial proofs. */
export function managementReadAllowed(path: string) {
  return /^\/(?:activities$|deployment(?:$|\/config$|\/history\?page=\d+$|\/activity$)|meta$|versions$|account$|users(?:$|\?)|backups$|clients$|grants$|connect\/authorize(?:$|\?)|auth\/registration$|connections\/(?:postgresql|redis)$|profile(?:$|\/activity$|\/requests$)|system\/(?:overview$|migration(?:$|\?summary=1$))|tasks(?:$|[/?]))/.test(
    path,
  );
}

/** Heavy or user-controlled snapshots refresh only on an explicit request. */
export function manualManagementRead(path: string) {
  return (
    path === "/system/migration" ||
    path === "/system/migration?summary=1" ||
    path === "/profile/requests" ||
    path === "/deployment" ||
    path.startsWith("/deployment/")
  );
}
