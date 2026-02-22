import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon, X } from "lucide-react";
import { useI18n } from "../i18n";
import type { MediaItem } from "../types/media";
import { ErrorMessage } from "./ErrorMessage";

type EditablePost = {
  id: string;
  content: string;
  media?: MediaItem[];
};

type SubmitPayload = {
  content: string;
  media: MediaItem[];
};

type Props = {
  open: boolean;
  post: EditablePost | null;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (payload: SubmitPayload) => void;
};

export function EditPostModal({
  open,
  post,
  loading = false,
  error = "",
  onClose,
  onSubmit,
}: Props) {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open || !post) return;
    setContent(post.content || "");
    setMedia(Array.isArray(post.media) ? post.media : []);
    setLocalError("");
  }, [open, post]);

  const canSubmit = useMemo(() => content.trim().length > 0 && !loading, [content, loading]);

  if (!open || !post) return null;

  return createPortal(
    <div className="fixed inset-0 z-[230] bg-black/75 backdrop-blur-sm overflow-y-auto">
      <div className="min-h-screen w-full flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0b0b0f] shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <h3 className="text-white font-semibold">{t("feed.edit.title")}</h3>
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-full border border-white/15 bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
              aria-label={t("feed.edit.cancel")}
            >
              <X className="w-4 h-4 mx-auto" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            <ErrorMessage message={error || localError} />

            <div>
              <label className="text-sm text-white/60">{t("feed.edit.content_label")}</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={6}
                className="mt-2 w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-white focus:border-white/35 outline-none resize-y min-h-[120px]"
                placeholder={t("composer.placeholder")}
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm text-white/60">{t("feed.edit.media_label")}</p>
              {media.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white/50 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4" />
                  <span>{t("feed.edit.no_media")}</span>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {media.map((item, index) => (
                    <div key={`${item.url}-${index}`} className="relative aspect-square rounded-xl overflow-hidden border border-white/10 bg-black/25">
                      <img
                        src={item.url}
                        alt="media"
                        className="w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setMedia((prev) => prev.filter((_, i) => i !== index));
                        }}
                        className="absolute top-1 right-1 h-6 w-6 rounded-full border border-white/20 bg-black/70 text-white/90 hover:bg-black"
                        aria-label={t("feed.edit.remove_media")}
                        title={t("feed.edit.remove_media")}
                      >
                        <X className="w-3.5 h-3.5 mx-auto" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="px-5 pb-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/80 hover:text-white hover:border-white/35 transition disabled:opacity-60"
            >
              {t("feed.edit.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                const trimmed = content.trim();
                if (!trimmed) {
                  setLocalError(t("feed.edit.empty_content"));
                  return;
                }
                setLocalError("");
                onSubmit({ content: trimmed, media });
              }}
              disabled={!canSubmit}
              className="rounded-full border border-white bg-white text-black px-4 py-2 text-sm hover:bg-white/90 transition disabled:opacity-60"
            >
              {loading ? t("feed.edit.saving") : t("feed.edit.save")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

