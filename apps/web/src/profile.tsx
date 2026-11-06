import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Pencil, Upload, ImagePlus } from "lucide-react";
import { api, base } from "./api";
import type { Profile, Session } from "./api";
import { useProfileInvalidation, useResource } from "./hooks";
import { Dialog } from "./dialog";
import { RequestHeatmap } from "./request-heatmap";
import { WorkspaceTabs } from "./workspace-ui";
import { LoadingPlaceholder } from "./loading-placeholder";
import type { Personal } from "./personal-profile";
const PersonalProfile = lazy(() =>
  import("./personal-profile").then((module) => ({
    default: module.PersonalProfile,
  })),
);

function avatarUrl(profile?: Profile | null) {
  return profile?.avatar_revision
    ? `${base}/profile/avatar?revision=${profile.avatar_revision}`
    : undefined;
}
export function ProfileAvatar({
  profile,
  username,
  preview,
}: {
  profile?: Profile | null;
  username: string;
  preview?: string | null;
}) {
  const src = preview === undefined ? avatarUrl(profile) : preview || undefined;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className="avatar">
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        (profile?.display_name || username).slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
function ErrorLine({ message }: { message: string }) {
  return message ? (
    <div role="alert" className="notice error">
      {message}
    </div>
  ) : null;
}
async function prepareImage(file: File) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("请选择 PNG、JPEG 或 WebP 图片");
  if (file.size > 8 * 1024 * 1024) throw new Error("图片不能超过 8 MB");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 20000000)
      throw new Error("图片尺寸过大，请选择较小的图片");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法处理图片，请重新选择");
    const size = Math.min(bitmap.width, bitmap.height);
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 256, 256);
    ctx.drawImage(
      bitmap,
      (bitmap.width - size) / 2,
      (bitmap.height - size) / 2,
      size,
      size,
      0,
      0,
      256,
      256,
    );
    const encoded = canvas.toDataURL("image/jpeg", 0.85);
    if (encoded.length > 65500)
      throw new Error("图片内容过大，请选择较简单的图片");
    return encoded;
  } finally {
    bitmap.close();
  }
}
function ProfileEditor({
  session,
  profile,
  onClose,
  onSaved,
  onPersonalValue,
}: {
  session: Session;
  profile: Profile;
  onClose: () => void;
  onSaved: () => void;
  onPersonalValue: (value: Personal | null) => void;
}) {
  const [section, setSection] = useState<"identity" | "personal">("identity");
  const [personalBusy, setPersonalBusy] = useState(false);
  const [name, setName] = useState(profile.display_name);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null | undefined>();
  const [processing, setProcessing] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null),
    generation = useRef(0),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  async function select(file?: File) {
    if (!file) return;
    const version = ++generation.current;
    setProcessing(true);
    setError("");
    try {
      const image = await prepareImage(file);
      if (alive.current && version === generation.current) setPreview(image);
    } catch (e) {
      if (alive.current && version === generation.current)
        setError(e instanceof Error ? e.message : "图片读取失败");
    } finally {
      if (alive.current && version === generation.current) setProcessing(false);
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api<Profile>(
        "/profile",
        {
          method: "PATCH",
          body: JSON.stringify({
            display_name: name,
            revision: profile.revision,
            ...(preview !== undefined ? { avatar_data: preview } : {}),
          }),
        },
        session.csrf,
      );
      onSaved();
      if (alive.current) onClose();
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : "保存失败");
        setSaving(false);
      }
    }
  }
  return (
    <Dialog
      title="编辑资料"
      className="profile-edit-dialog"
      onClose={saving || personalBusy ? () => {} : onClose}
    >
      <div className="dialog-content profile-editor-content">
        <WorkspaceTabs
          label="资料编辑分类"
          value={section}
          onChange={setSection}
          disabled={saving || processing || personalBusy}
          items={[
            { value: "identity", label: "头像与名称" },
            { value: "personal", label: "简介与背景" },
          ]}
        />
        <section hidden={section !== "identity"} aria-label="头像与名称">
          <form className="profile-editor" onSubmit={(e) => void save(e)}>
            <div
              className={`avatar-dropzone${dragging ? " dragging" : ""}`}
              role="group"
              aria-label="头像上传，可拖入图片或点击上传头像"
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes("Files")) return;
                event.preventDefault();
                event.dataTransfer.dropEffect =
                  saving || processing ? "none" : "copy";
                if (!saving && !processing) setDragging(true);
              }}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                )
                  setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (saving || processing) return;
                const files = event.dataTransfer.files;
                if (files.length > 1) {
                  setError("每次请选择一张头像图片");
                  return;
                }
                void select(files[0]);
              }}
            >
              <div className="editor-avatar">
                <ProfileAvatar
                  profile={profile}
                  username={session.user.username}
                  preview={preview}
                />
              </div>
              <input
                ref={input}
                type="file"
                hidden
                accept="image/png,image/jpeg,image/webp"
                aria-label="选择头像图片"
                disabled={saving}
                onChange={(e) => {
                  void select(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <div className="avatar-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={saving || processing}
                  onClick={() => input.current?.click()}
                >
                  <Upload size={16} />
                  {processing ? "正在处理…" : "上传头像"}
                </button>
                {(preview ||
                  (preview === undefined && profile.avatar_revision)) && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={saving || processing}
                    onClick={() => setPreview(null)}
                  >
                    移除头像
                  </button>
                )}
              </div>
            </div>
            <label className="profile-name-field">
              显示名称
              <input
                value={name}
                maxLength={80}
                disabled={saving}
                placeholder={session.user.username}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <ErrorLine message={error} />
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                disabled={saving}
                onClick={onClose}
              >
                取消
              </button>
              <button
                className="button primary"
                disabled={saving || processing}
              >
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </form>
        </section>
        <section hidden={section !== "personal"} aria-label="简介与背景">
          <Suspense fallback={<LoadingPlaceholder />}>
            <PersonalProfile
              session={session}
              onValue={onPersonalValue}
              onBusyChange={setPersonalBusy}
            />
          </Suspense>
        </section>
      </div>
    </Dialog>
  );
}
export function ProfilePage({ session }: { session: Session }) {
  const profile = useResource<Profile>("/profile"),
    invalidate = useProfileInvalidation();
  const [editing, setEditing] = useState(false),
    [saved, setSaved] = useState(false);
  const [personal, setPersonal] = useState<{
    bio: string;
    background: { path: string; sha256: string } | null;
  } | null>(null);
  const [personalError, setPersonalError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setPersonal(null);
    setPersonalError("");
    api<{ bio: string; background: { path: string; sha256: string } | null }>(
      "/account/personal-profile",
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setPersonal(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setPersonalError(
            error instanceof Error ? error.message : "资料读取失败",
          );
      });
    return () => controller.abort();
  }, [session.instance_id, session.user.id, session.receipt_scope]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) setEditing(false);
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      setEditing(false);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  return (
    <div className="profile-page">
      <ErrorLine message={profile.error} />
      <ErrorLine message={personalError} />
      <div
        className={`profile-identity profile-hero${personal?.background ? " has-cover" : ""}`}
      >
        <div className="profile-cover">
          {personal?.background && (
            <img
              className="profile-cover-image"
              src={personal.background.path}
              alt="个人资料背景"
            />
          )}
          <button
            className="icon-button profile-cover-edit"
            aria-label="编辑背景图片"
            onClick={() => setEditing(true)}
            disabled={!profile.data}
          >
            <ImagePlus size={18} />
          </button>
        </div>
        <button
          className="profile-avatar-button"
          aria-label="编辑头像和资料"
          disabled={!profile.data}
          onClick={() => {
            setSaved(false);
            setEditing(true);
          }}
          data-dialog-return
        >
          <ProfileAvatar
            profile={profile.data}
            username={session.user.username}
          />
          <span className="avatar-pencil profile-avatar-badge">
            <Pencil size={18} />
          </span>
        </button>
        <h1>{profile.data?.display_name || session.user.username}</h1>
        <p>@{session.user.username}</p>
        {personal?.bio && <p className="profile-signature">{personal.bio}</p>}
        <button
          className="button secondary small"
          disabled={!profile.data}
          onClick={() => {
            setSaved(false);
            setEditing(true);
          }}
          data-dialog-return
        >
          编辑资料
        </button>
        {saved && (
          <span className="profile-saved" role="status">
            已保存
          </span>
        )}
        {profile.error && (
          <button className="text-button" onClick={profile.reload}>
            重新读取资料
          </button>
        )}
      </div>
      <RequestHeatmap />
      {editing && profile.data && (
        <ProfileEditor
          session={session}
          profile={profile.data}
          onPersonalValue={setPersonal}
          onClose={() => setEditing(false)}
          onSaved={() => {
            invalidate();
            setSaved(true);
          }}
        />
      )}
    </div>
  );
}
