import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Plus, Volume2, VolumeX, X } from "lucide-react";
import { api, type StoryGroup, type StoryItem } from "../api/client";
import { useI18n } from "../i18n";
import { getImageDimensions, getVideoDimensions } from "../utils/media";

type StoriesBarProps = {
  token?: string | null;
  onRequireAuth?: () => void;
};

type StoryComposerModalProps = {
  open: boolean;
  token?: string | null;
  onClose: () => void;
  onCreated: () => void;
};

const IMAGE_MIME_RE = /^image\//i;
const VIDEO_MIME_RE = /^video\//i;
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|webp|gif|bmp|avif|heic|heif|tif|tiff)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|avi|mkv|3gp|ogv)$/i;
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

const isStoryVideo = (item: { media?: { type?: string; url?: string } } | null | undefined) => {
  if (!item?.media?.url) return false;
  if (item.media.type === "video") return true;
  const normalized = String(item.media.url).toLowerCase().split("?")[0]?.split("#")[0] || "";
  return VIDEO_EXT_RE.test(normalized);
};

const inferFileKind = (file: File): "image" | "video" | null => {
  const type = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  if (VIDEO_MIME_RE.test(type) || VIDEO_EXT_RE.test(name)) return "video";
  if ((IMAGE_MIME_RE.test(type) && type !== "image/svg+xml") || IMAGE_EXT_RE.test(name)) return "image";
  return null;
};

function StoryComposerModal({ open, token, onClose, onCreated }: StoryComposerModalProps) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewURL, setPreviewURL] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video" | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const resetForm = useCallback(() => {
    setContent("");
    setFile(null);
    setMediaType(null);
    setDims({ width: 0, height: 0 });
    setError("");
    setLoading(false);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open, resetForm]);

  useEffect(() => {
    if (!file) {
      setPreviewURL("");
      return;
    }
    const next = URL.createObjectURL(file);
    setPreviewURL(next);
    return () => {
      URL.revokeObjectURL(next);
    };
  }, [file]);

  const onPickFile = async (picked: File | null) => {
    setError("");
    if (!picked) return;
    const kind = inferFileKind(picked);
    if (!kind) {
      setError(t("stories.invalid_type"));
      return;
    }
    if (kind === "video" && picked.size > MAX_VIDEO_BYTES) {
      setError(t("stories.too_large_video"));
      return;
    }

    setFile(picked);
    setMediaType(kind);
    try {
      const meta = kind === "video" ? await getVideoDimensions(picked) : await getImageDimensions(picked);
      setDims({ width: meta.width || 0, height: meta.height || 0 });
    } catch {
      setDims({ width: 0, height: 0 });
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (!file || !mediaType) {
      setError(t("stories.media_required"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const uploaded = await api.uploadMedia([file], "story", token);
      const first = uploaded[0];
      if (!first?.url) {
        throw new Error("upload_failed");
      }
      await api.createStory(
        {
          content: content.trim(),
          media: {
            url: first.url,
            type: mediaType,
            width: dims.width || first.width || 0,
            height: dims.height || first.height || 0,
          },
        },
        token
      );
      resetForm();
      onClose();
      onCreated();
    } catch (err: any) {
      setError(err?.message || t("stories.create_error"));
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[170] bg-black/80 backdrop-blur-md p-4 flex items-center justify-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-3xl border border-white/15 bg-[#0a0f1c] shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h3 className="text-white font-semibold">{t("stories.create_title")}</h3>
          <button
            type="button"
            onClick={() => !loading && onClose()}
            className="w-8 h-8 rounded-full border border-white/15 text-white/70 hover:text-white hover:bg-white/10 grid place-items-center"
            aria-label={t("stories.create_cancel")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={600}
            rows={3}
            className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/45 focus:outline-none focus:border-white/30"
            placeholder={t("stories.create_text_placeholder")}
          />

          {previewURL ? (
            <div className="relative rounded-2xl border border-white/15 overflow-hidden bg-black/40">
              {mediaType === "video" ? (
                <video src={previewURL} className="w-full max-h-[420px] object-contain bg-black/60" controls muted />
              ) : (
                <img src={previewURL} alt="story preview" className="w-full max-h-[420px] object-contain bg-black/60" />
              )}
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setMediaType(null);
                  setDims({ width: 0, height: 0 });
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="absolute top-2 right-2 w-8 h-8 rounded-full border border-white/20 bg-black/65 text-white/90 hover:bg-black grid place-items-center"
                aria-label={t("stories.create_remove_media")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => {
                const picked = e.currentTarget.files?.[0] || null;
                void onPickFile(picked);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-full border border-sky-300/35 bg-sky-500/20 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-500/30 transition"
            >
              {previewURL ? t("stories.create_change_media") : t("stories.create_pick_media")}
            </button>
          </div>

          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </div>

        <div className="px-4 py-3 border-t border-white/10 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => !loading && onClose()}
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/10 transition"
            disabled={loading}
          >
            {t("stories.create_cancel")}
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded-full border border-sky-300/35 bg-sky-500/20 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-500/30 transition disabled:opacity-60"
          >
            {loading ? t("stories.create_publishing") : t("stories.create_publish")}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

type StoryViewerModalProps = {
  open: boolean;
  group: StoryGroup | null;
  onClose: () => void;
};

function StoryViewerModal({ open, group, onClose }: StoryViewerModalProps) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const timerRef = useRef<number | null>(null);

  const stories = group?.stories || [];
  const count = stories.length;
  const current = stories[index];
  const currentIsVideo = isStoryVideo(current ? { media: current.media } : null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setMuted(true);
  }, [open, group?.user.id]);

  useEffect(() => {
    clearTimer();
    if (!open || !current || currentIsVideo) return;
    timerRef.current = window.setTimeout(() => {
      setIndex((prev) => {
        if (prev >= count - 1) {
          onClose();
          return prev;
        }
        return prev + 1;
      });
    }, 5000);
    return clearTimer;
  }, [open, current, currentIsVideo, count, onClose, clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  if (!open || !group || count === 0) return null;

  const goPrev = () => setIndex((prev) => (prev > 0 ? prev - 1 : prev));
  const goNext = () =>
    setIndex((prev) => {
      if (prev >= count - 1) {
        onClose();
        return prev;
      }
      return prev + 1;
    });

  return createPortal(
    <div className="fixed inset-0 z-[180] bg-black flex items-center justify-center">
      <div className="relative w-full h-full max-w-[640px] mx-auto">
        <div className="absolute inset-x-3 top-3 z-20 flex items-center gap-1">
          {stories.map((story, i) => {
            const done = i < index;
            const active = i === index;
            return (
              <div key={story.id} className="h-1 flex-1 rounded-full bg-white/20 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    done || active ? "bg-white/90" : "bg-transparent"
                  }`}
                  style={{ width: done ? "100%" : active ? "35%" : "0%" }}
                />
              </div>
            );
          })}
        </div>

        <div className="absolute top-7 left-3 right-3 z-20 flex items-center justify-between">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/45 px-2.5 py-1.5">
            <span className="relative inline-flex shrink-0 rounded-full bg-white/10 overflow-hidden items-center justify-center w-8 h-8 text-xs font-semibold text-white">
              <span aria-hidden>{group.user.full_name?.[0]?.toUpperCase() || group.user.username?.[0]?.toUpperCase()}</span>
              {group.user.avatar_url ? (
                <img
                  src={group.user.avatar_url}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : null}
            </span>
            <div className="min-w-0">
              <p className="text-white text-sm font-semibold truncate">{group.user.full_name || group.user.username}</p>
              <p className="text-white/70 text-xs truncate">@{group.user.username}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full border border-white/15 bg-black/50 text-white/90 hover:bg-black/70 grid place-items-center"
            aria-label={t("stories.create_cancel")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={goPrev}
          className="absolute left-0 top-0 h-full w-1/2 z-10"
          aria-label="previous story"
        />
        <button
          type="button"
          onClick={goNext}
          className="absolute right-0 top-0 h-full w-1/2 z-10"
          aria-label="next story"
        />

        {currentIsVideo ? (
          <video
            key={current.id}
            src={current.media.url}
            className="w-full h-full object-contain bg-black"
            autoPlay
            playsInline
            preload="metadata"
            muted={muted}
            onEnded={goNext}
          />
        ) : (
          <img src={current.media.url} alt="story" className="w-full h-full object-contain bg-black" />
        )}

        {current.content ? (
          <div className="absolute inset-x-3 bottom-5 z-20">
            <div className="rounded-2xl border border-white/15 bg-black/45 px-3 py-2 text-sm text-white whitespace-pre-wrap break-words">
              {current.content}
            </div>
          </div>
        ) : null}

        {currentIsVideo ? (
          <button
            type="button"
            onClick={() => setMuted((v) => !v)}
            className="absolute right-3 bottom-5 z-30 w-10 h-10 rounded-full border border-white/20 bg-black/60 text-white hover:bg-black/80 grid place-items-center"
            aria-label={muted ? t("stories.sound_on") : t("stories.sound_off")}
            title={muted ? t("stories.sound_on") : t("stories.sound_off")}
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        ) : null}

        <div className="hidden md:block">
          <button
            type="button"
            onClick={goPrev}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full border border-white/15 bg-black/50 text-white/90 hover:bg-black/70 grid place-items-center"
            aria-label="prev"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={goNext}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full border border-white/15 bg-black/50 text-white/90 hover:bg-black/70 grid place-items-center"
            aria-label="next"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function StoriesBar({ token, onRequireAuth }: StoriesBarProps) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [viewerGroup, setViewerGroup] = useState<StoryGroup | null>(null);

  const loadStories = useCallback(async () => {
    try {
      setError("");
      const next = await api.storiesFeed(token);
      setGroups(Array.isArray(next) ? next.filter((g) => Array.isArray(g.stories) && g.stories.length > 0) : []);
    } catch (err: any) {
      setError(err?.message || t("stories.load_error"));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    setLoading(true);
    void loadStories();
  }, [loadStories]);

  const ownGroup = useMemo(() => groups.find((g) => g.is_me), [groups]);

  const openComposer = () => {
    if (!token) {
      onRequireAuth?.();
      return;
    }
    setComposerOpen(true);
  };

  return (
    <>
      <div className="card p-3">
        <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide">
          <button
            type="button"
            onClick={openComposer}
            className="shrink-0 w-[72px] flex flex-col items-center gap-2"
            aria-label={t("stories.add")}
            title={t("stories.add")}
          >
            <span className="w-14 h-14 rounded-full border border-dashed border-sky-300/45 bg-sky-500/15 text-sky-100 grid place-items-center">
              <Plus className="w-5 h-5" />
            </span>
            <span className="text-[11px] text-white/75 text-center leading-tight">
              {ownGroup ? t("stories.your_story") : t("stories.add")}
            </span>
          </button>

          {loading &&
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="shrink-0 w-[72px] flex flex-col items-center gap-2">
                <div className="w-14 h-14 rounded-full bg-white/10 animate-pulse" />
                <div className="h-3 w-12 rounded-full bg-white/10 animate-pulse" />
              </div>
            ))}

          {!loading &&
            groups.map((group) => (
              <button
                key={group.user.id}
                type="button"
                onClick={() => setViewerGroup(group)}
                className="shrink-0 w-[72px] flex flex-col items-center gap-2"
                aria-label={group.user.full_name || group.user.username}
              >
                <span className="p-[2px] rounded-full bg-gradient-to-br from-sky-400 via-blue-500 to-cyan-300">
                  <span className="relative inline-flex shrink-0 rounded-full bg-black overflow-hidden items-center justify-center w-14 h-14 text-sm font-semibold text-white">
                    <span aria-hidden>{group.user.full_name?.[0]?.toUpperCase() || group.user.username?.[0]?.toUpperCase()}</span>
                    {group.user.avatar_url ? (
                      <img
                        src={group.user.avatar_url}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : null}
                  </span>
                </span>
                <span className="text-[11px] text-white/80 text-center leading-tight truncate max-w-[70px]">
                  {group.user.full_name || group.user.username}
                </span>
              </button>
            ))}
        </div>
        {!loading && error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
      </div>

      <StoryComposerModal
        open={composerOpen}
        token={token}
        onClose={() => setComposerOpen(false)}
        onCreated={() => {
          void loadStories();
        }}
      />

      <StoryViewerModal
        open={viewerGroup !== null}
        group={viewerGroup}
        onClose={() => setViewerGroup(null)}
      />
    </>
  );
}
