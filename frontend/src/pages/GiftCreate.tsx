import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, ExternalLink, Heart, Images, Paintbrush, PartyPopper, Sparkles, X } from "lucide-react";
import { api, type GiftCard } from "../api/client";
import { type AppLanguage, useI18n } from "../i18n";
import { DrawingModal } from "../components/DrawingModal";

type GiftUILanguage = AppLanguage;

const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|avi|mkv|3gp|ogv)$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$/;
const GIFT_SLUG_EXAMPLE = "foryousomeone";
const RESERVED_SLUGS = new Set([
  "gift",
  "create",
  "login",
  "register",
  "logout",
  "search",
  "notifications",
  "chats",
  "rooms",
  "profile",
  "admin",
  "moderation",
  "u",
  "p",
  "api",
  "healthz",
]);

const inferMediaType = (file: File): "image" | "video" | null => {
  const ct = String(file.type || "").toLowerCase();
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("image/") && ct !== "image/svg+xml") return "image";
  const name = String(file.name || "").toLowerCase();
  if (VIDEO_EXT_RE.test(name)) return "video";
  if (name.match(/\.(jpg|jpeg|png|webp|gif|bmp|avif|heic|heif|tif|tiff)$/i)) return "image";
  return null;
};

const normalizeSlug = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/--+/g, "-");

export default function GiftCreatePage() {
  const { pick, language } = useI18n();
  const tr = useCallback((kk: string, ru: string, en: string) => pick({ kk, ru, en }), [pick]);
  const [uiLanguage, setUILanguage] = useState<GiftUILanguage>(language);
  const [toName, setToName] = useState("");
  const [fromName, setFromName] = useState("");
  const [message, setMessage] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewURL, setPreviewURL] = useState("");
  const [drawingOpen, setDrawingOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<GiftCard | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewURL("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewURL(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const createdLink = useMemo(() => {
    if (!created?.code) return "";
    return `${window.location.origin}/${created.code}`;
  }, [created]);
  const normalizedCodePreview = useMemo(() => normalizeSlug(customCode), [customCode]);
  const livePreviewLink = useMemo(() => {
    if (!normalizedCodePreview) return "";
    return `${window.location.origin}/${normalizedCodePreview}`;
  }, [normalizedCodePreview]);

  const onPickFile = (picked: File | null) => {
    setError("");
    if (!picked) return;
    const mediaType = inferMediaType(picked);
    if (!mediaType) {
      setError(tr("Тек фото/видео", "Только фото/видео", "Only image/video is allowed"));
      return;
    }
    if (mediaType === "video" && picked.size > MAX_VIDEO_BYTES) {
      setError(tr("Видео 40MB-тан аспауы керек", "Видео не должно превышать 40MB", "Video must be <= 40MB"));
      return;
    }
    setFile(picked);
  };

  const copyLink = async () => {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink);
    } catch {
      setError(tr("Сілтемені көшіру болмады", "Не удалось скопировать ссылку", "Failed to copy link"));
    }
  };

  const formatRetry = (seconds: number) => {
    if (seconds <= 0) return tr("біраз уақытқа", "на некоторое время", "for some time");
    if (seconds < 60) return tr(`${seconds} сек`, `${seconds} сек`, `${seconds}s`);
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return tr(`${minutes} мин`, `${minutes} мин`, `${minutes} min`);
    const hours = Math.ceil(minutes / 60);
    return tr(`${hours} сағ`, `${hours} ч`, `${hours}h`);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError("");
    setCreated(null);

    const normalizedCode = normalizeSlug(customCode);
    if (normalizedCode && !SLUG_RE.test(normalizedCode)) {
      setError(
        tr(
          "Сілтеме 4-40 таңба: a-z, 0-9 және дефис",
          "Ссылка 4-40 символов: a-z, 0-9 и дефис",
          "Link must be 4-40 chars: a-z, 0-9 and hyphen"
        )
      );
      return;
    }
    if (normalizedCode && RESERVED_SLUGS.has(normalizedCode)) {
      setError(tr("Бұл сілтеме атауы қолжетімсіз", "Это имя ссылки недоступно", "This link name is not available"));
      return;
    }

    if (!toName.trim()) {
      setError(tr("Кімге деген өрісті толтырыңыз", "Заполните поле «Кому»", "Please fill the “To” field"));
      return;
    }
    if (!message.trim()) {
      setError(tr("Мәтінді жазыңыз", "Напишите текст", "Please enter your message"));
      return;
    }

    setSaving(true);
    try {
      let mediaPayload: { url: string; type: "image" | "video" } | undefined;
      if (file) {
        const uploaded = await api.uploadGiftMedia(file);
        const first = uploaded[0];
        if (!first?.url) {
          throw new Error(tr("Файл жүктелмеді", "Файл не загрузился", "File upload failed"));
        }
        const fileType = inferMediaType(file);
        mediaPayload = {
          url: first.url,
          type: (fileType || first.type || "image") as "image" | "video",
        };
      }

      const gift = await api.createGift({
        to_name: toName.trim(),
        from_name: fromName.trim(),
        message: message.trim(),
        code: normalizedCode || undefined,
        ui_language: uiLanguage,
        animation_type: "envelope",
        media: mediaPayload,
        wishes: [],
      });
      setCreated(gift);
      setCustomCode(gift.code || normalizedCode);
    } catch (err: any) {
      if (err?.code === "GIFT_SLUG_TAKEN") {
        const eta = formatRetry(Number(err?.retryAfterSeconds || 0));
        setError(tr(`Бұл сілтеме бос емес, ${eta} кейін қайталап көріңіз`, `Эта ссылка занята, попробуйте через ${eta}`, `This link is taken, try again in ${eta}`));
      } else if (err?.code === "MEDIA_BLOCKED") {
        setError(
          tr(
            "Фото модерациядан өтпеді. Басқа суретті таңдаңыз.",
            "Фото не прошло модерацию. Выберите другое изображение.",
            "This image did not pass moderation. Please choose another one."
          )
        );
      } else if (err?.code === "MODERATION_UNAVAILABLE") {
        setError(
          tr(
            "Фото модерациясы уақытша қолжетімсіз. Кейінірек қайталап көріңіз.",
            "Сервис модерации фото временно недоступен. Попробуйте позже.",
            "Image moderation is temporarily unavailable. Please try again later."
          )
        );
      } else {
        setError(err?.message || tr("Ашық хатты жасау мүмкін болмады", "Не удалось создать открытку", "Failed to create card"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <main data-page-root className="max-w-[760px] w-full mx-auto px-2 sm:px-3 py-3 sm:py-6 page-fade">
      <div className="relative overflow-hidden rounded-[28px] border border-rose-200/20 bg-gradient-to-br from-[#1a0712] via-[#0b0c14] to-[#170f2a] p-3.5 sm:p-6">
        <div className="pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full bg-rose-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-fuchsia-400/15 blur-3xl" />

        <div className="relative z-10 mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-white/65 text-sm">{tr("8 наурызға сыйлық", "Подарок к 8 марта", "Gift for March 8")}</p>
            <h1 className="text-white text-2xl sm:text-3xl font-semibold leading-tight">
              {tr("Әдемі ашық хат жасаңыз", "Создайте красивую открытку", "Create a beautiful card")}
            </h1>
          </div>
          <Link
            to="/"
            className="shrink-0 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white/75 hover:bg-white/10 transition"
          >
            {tr("Таспа", "Лента", "Feed")}
          </Link>
        </div>

        <form onSubmit={onSubmit} className="relative z-10 space-y-4">
          <div className="rounded-2xl border border-white/15 bg-black/25 p-3 space-y-3">
            <p className="text-xs text-white/65 uppercase tracking-wide">
              {tr("Ашық хат интерфейс тілі", "Язык интерфейса открытки", "Card interface language")}
            </p>
            <div className="flex flex-wrap gap-2">
              {([
                ["kk", "Қазақша"],
                ["ru", "Русский"],
                ["en", "English"],
              ] as Array<[GiftUILanguage, string]>).map(([value, label]) => {
                const active = uiLanguage === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setUILanguage(value)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      active
                        ? "border-rose-300/45 bg-rose-500/20 text-rose-100"
                        : "border-white/20 bg-white/5 text-white/80 hover:bg-white/10"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-white/65">{tr("Сілтеме атауы (міндетті емес)", "Имя ссылки (необязательно)", "Link name (optional)")}</span>
            <div className="flex items-center rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm text-white/75">
              <span className="shrink-0 text-white/45">{`${window.location.origin}/`}</span>
              <input
                value={customCode}
                onChange={(e) => setCustomCode(normalizeSlug(e.target.value))}
                maxLength={40}
                className="ml-1 min-w-0 flex-1 bg-transparent text-white placeholder:text-white/35 focus:outline-none"
                placeholder={GIFT_SLUG_EXAMPLE}
              />
            </div>
            <p className="text-[11px] text-white/45">
              {tr("Тек a-z, 0-9 және дефис", "Только a-z, 0-9 и дефис", "Only a-z, 0-9 and hyphen")}
            </p>
            {livePreviewLink ? (
              <p className="text-[12px] text-emerald-300/95 break-all">
                {tr("Сілтеме осылай көрінеді:", "Ссылка будет выглядеть так:", "This link will look like:")}{" "}
                <span className="font-medium text-emerald-200">{livePreviewLink}</span>
              </p>
            ) : null}
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-xs text-white/65">{tr("Кімге", "Кому", "To")}</span>
              <input
                value={toName}
                onChange={(e) => setToName(e.target.value)}
                maxLength={80}
                className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-white placeholder:text-white/35 focus:outline-none focus:border-rose-300/45"
                placeholder={tr("Есімі", "Имя получателя", "Recipient name")}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-white/65">{tr("Кімнен", "От кого", "From")}</span>
              <input
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                maxLength={80}
                className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-white placeholder:text-white/35 focus:outline-none focus:border-rose-300/45"
                placeholder={tr("Сіздің атыңыз", "Ваше имя", "Your name")}
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-white/65">{tr("Негізгі мәтін", "Основной текст", "Main message")}</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              maxLength={2400}
              className="w-full rounded-2xl border border-white/15 bg-black/35 px-3 py-2.5 text-white leading-relaxed placeholder:text-white/35 focus:outline-none focus:border-rose-300/45"
              placeholder={tr("Жылы сөздеріңізді жазыңыз…", "Напишите тёплые слова…", "Write warm words...")}
            />
          </label>

          <div className="rounded-2xl border border-white/15 bg-black/30 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-sm text-white/85 inline-flex items-center gap-2">
                <Images className="w-4 h-4 text-rose-200" />
                {tr("Фото/видео (қалауыңызша)", "Фото/видео (опционально)", "Photo/video (optional)")}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setDrawingOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-rose-200/25 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-100 hover:bg-rose-500/20 transition"
                >
                  <Paintbrush className="w-3.5 h-3.5" />
                  {tr("Сурет салу", "Сделать рисунок", "Create drawing")}
                </button>
                <label className="cursor-pointer rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/85 hover:bg-white/10 transition">
                  <input
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={(e) => onPickFile(e.currentTarget.files?.[0] || null)}
                  />
                  {tr("Файл таңдау", "Выбрать файл", "Choose file")}
                </label>
              </div>
            </div>

            {previewURL ? (
              <div className="relative overflow-hidden rounded-xl border border-white/15 bg-black/40">
                {inferMediaType(file as File) === "video" ? (
                  <video src={previewURL} className="w-full max-h-[280px] object-contain bg-black/60" muted loop autoPlay playsInline />
                ) : (
                  <img src={previewURL} alt="gift media preview" className="w-full max-h-[280px] object-contain bg-black/60" />
                )}
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="absolute top-2 right-2 h-8 w-8 rounded-full border border-white/20 bg-black/65 text-white/90 hover:bg-black grid place-items-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/15 px-3 py-6 text-center text-sm text-white/45">
                {tr("Медиа қоспасаңыз да болады", "Можно оставить без медиа", "You can leave it without media")}
              </div>
            )}
          </div>

          {error ? <div className="rounded-xl border border-red-300/35 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-white/55 inline-flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              {tr("Сілтеме арқылы жіберіледі", "Отправляется по ссылке", "Shared by link")}
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-full border border-rose-300/35 bg-rose-500/20 px-5 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/30 transition disabled:opacity-60 inline-flex items-center gap-2"
            >
              <Heart className="w-4 h-4" />
              {saving ? tr("Жасалуда...", "Создаём...", "Creating...") : tr("Ашық хат жасау", "Создать открытку", "Create card")}
            </button>
          </div>
        </form>

        {created ? (
          <div
            className="fixed inset-0 z-[320] bg-black/70 backdrop-blur-md px-3 py-4 flex items-center justify-center"
            onClick={() => setCreated(null)}
          >
            <div
              className="w-full max-w-[420px] rounded-2xl border border-emerald-300/35 bg-[#0b0f14] p-4 sm:p-5 shadow-[0_30px_80px_rgba(0,0,0,0.45)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <p className="text-sm text-emerald-100 inline-flex items-center gap-2">
                  <PartyPopper className="w-4 h-4" />
                  {tr("Ашық хат дайын!", "Открытка готова!", "Card is ready!")}
                </p>
                <button
                  type="button"
                  onClick={() => setCreated(null)}
                  className="h-8 w-8 rounded-full border border-white/15 bg-white/5 text-white/70 hover:bg-white/10 grid place-items-center"
                  aria-label={tr("Жабу", "Закрыть", "Close")}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm break-all text-white/85">
                {createdLink}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={copyLink}
                  className="rounded-full border border-white/20 bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15 transition inline-flex items-center justify-center gap-1.5"
                >
                  <Copy className="w-4 h-4" />
                  {tr("Көшіру", "Копировать", "Copy")}
                </button>
                <a
                  href={createdLink}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-rose-300/35 bg-rose-500/20 px-3 py-2 text-sm text-rose-100 hover:bg-rose-500/30 transition inline-flex items-center justify-center gap-1.5"
                >
                  <ExternalLink className="w-4 h-4" />
                  {tr("Ашу", "Открыть", "Open")}
                </a>
              </div>
            </div>
          </div>
        ) : null}

        {drawingOpen ? (
          <DrawingModal
            title={tr("Ашық хатқа сурет салу", "Нарисовать для открытки", "Draw for the card")}
            onClose={() => setDrawingOpen(false)}
            onSave={(nextFile) => {
              setError("");
              setFile(nextFile);
              setDrawingOpen(false);
            }}
          />
        ) : null}
      </div>
    </main>
  );
}
