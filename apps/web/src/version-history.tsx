import { LoadingPlaceholder } from "./loading-placeholder";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "./dialog";
import { useResource } from "./hooks";

export function VersionHistory({ version }: { version: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => () => setOpen(false), []);
  return (
    <>
      <button
        type="button"
        className="text-button version-trigger"
        onClick={() => setOpen(true)}
        aria-label={`查看版本记录，${version}`}
      >
        {version}
      </button>
      {open &&
        createPortal(
          <VersionDialog onClose={() => setOpen(false)} />,
          document.body,
        )}
    </>
  );
}

function VersionDialog({ onClose }: { onClose: () => void }) {
  const resource = useResource<{
    version: string;
    releases: { version: string; date: string; changes: string[] }[];
  }>("/versions");
  return (
    <Dialog
      title="版本记录"
      onClose={onClose}
      className="version-history-dialog"
    >
      <div className="dialog-content version-history">
        {resource.error ? (
          <div className="notice error" role="alert">
            {resource.error}
            <button
              type="button"
              className="text-button"
              onClick={resource.reload}
            >
              重新读取
            </button>
          </div>
        ) : !resource.data ? (
          <LoadingPlaceholder label="正在读取" compact />
        ) : (
          resource.data.releases.map((release) => (
            <section
              key={release.version}
              aria-label={`版本 ${release.version}`}
            >
              <div className="version-history-heading">
                <h3>v{release.version}</h3>
                {release.version === resource.data?.version && (
                  <span className="version-current">当前版本</span>
                )}
                <time dateTime={release.date}>{release.date}</time>
              </div>
              <ul>
                {release.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </Dialog>
  );
}
