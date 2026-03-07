import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Heart, Volume2, VolumeX, X } from "lucide-react";
import { api, type GiftCard } from "../api/client";
import { useI18n } from "../i18n";

type EnvelopePhase = "closed" | "opening" | "opened";

const isVideoMedia = (gift: GiftCard | null) => {
  if (!gift?.media?.url) return false;
  const t = String(gift.media.type || "").toLowerCase();
  if (t === "video") return true;
  const url = String(gift.media.url || "").toLowerCase();
  return /\.(mp4|webm|mov|m4v|avi|mkv|3gp|ogv)(\?|#|$)/i.test(url);
};

const normalizeGiftLanguage = (raw: string | undefined): "kk" | "ru" | "en" => {
  const next = String(raw || "").toLowerCase();
  if (next === "ru") return "ru";
  if (next === "en") return "en";
  return "kk";
};

const normalizeLegacyOpenLine = (raw: string | undefined, lang: "kk" | "ru" | "en") => {
  const value = String(raw || "").trim();
  if (!value) return "";

  const normalized = value.toLowerCase();
  const isLegacyDefault =
    normalized === "happy march 8" ||
    normalized === "с 8 марта" ||
    normalized === "8 наурыз мерекеңізбен";

  if (!isLegacyDefault) return value;

  if (lang === "ru") return "Для вас открытка";
  if (lang === "en") return "A card for you";
  return "Сізге ашық хат";
};

export default function GiftViewPage() {
  const { pick } = useI18n();
  const trFallback = useCallback((kk: string, ru: string, en: string) => pick({ kk, ru, en }), [pick]);
  const { code = "" } = useParams();

  const [loading, setLoading] = useState(true);
  const [gift, setGift] = useState<GiftCard | null>(null);
  const [error, setError] = useState("");
  const [envelopePhase, setEnvelopePhase] = useState<EnvelopePhase>("closed");
  const [showCelebration, setShowCelebration] = useState(false);
  const [muted, setMuted] = useState(true);
  const [fullscreenMedia, setFullscreenMedia] = useState(false);
  const [mediaReady, setMediaReady] = useState(true);

  const OPENING_TO_OPENED_MS = 1180;
  const openTimerRef = useRef<number | null>(null);
  const celebrationTimerRef = useRef<number | null>(null);

  const language = useMemo(() => normalizeGiftLanguage(gift?.ui_language), [gift?.ui_language]);

  const trGift = useCallback(
    (kk: string, ru: string, en: string) => {
      if (language === "ru") return ru;
      if (language === "en") return en;
      return kk;
    },
    [language]
  );

  const teaserLine = useMemo(() => {
    const main = normalizeLegacyOpenLine(gift?.open_line, language);
    if (main) return main;
    return trGift("Сізге ашық хат", "Для вас открытка", "A card for you");
  }, [gift?.open_line, language, trGift]);

  const openingLine = useMemo(() => {
    const main = String(gift?.message || "").trim();
    if (main) return main;
    return trGift("8 наурыз мерекеңізбен", "С 8 марта", "Happy March 8");
  }, [gift?.message, trGift]);

  useEffect(() => {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (celebrationTimerRef.current) {
      window.clearTimeout(celebrationTimerRef.current);
      celebrationTimerRef.current = null;
    }
    setEnvelopePhase("closed");
    setShowCelebration(false);
    setFullscreenMedia(false);
  }, [code]);

  useEffect(() => {
    return () => {
      if (openTimerRef.current) {
        window.clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
      if (celebrationTimerRef.current) {
        window.clearTimeout(celebrationTimerRef.current);
        celebrationTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const bodyPrev = document.body.style.overflow;
    const htmlPrev = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = bodyPrev;
      document.documentElement.style.overflow = htmlPrev;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!code.trim()) {
      setError(trFallback("Ашық хат табылмады", "Открытка не найдена", "Card not found"));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    api
      .giftByCode(code)
      .then((res) => {
        if (cancelled) return;
        setGift(res);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message || trFallback("Ашық хат жүктелмеді", "Не удалось загрузить открытку", "Failed to load card"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [code, trFallback]);

  const showVideo = isVideoMedia(gift);
  const hasGiftMedia = Boolean(String(gift?.media?.url || "").trim());
  const visualAnimationType = "envelope";
  const collectiveWishes = useMemo(
    () => gift?.wishes?.filter((wish) => String(wish?.text || "").trim()) || [],
    [gift?.wishes]
  );

  useEffect(() => {
    const mediaUrl = String(gift?.media?.url || "").trim();
    if (!mediaUrl || showVideo) {
      setMediaReady(true);
      return;
    }

    let cancelled = false;
    setMediaReady(false);

    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.fetchPriority = "high";

    const markReady = () => {
      if (!cancelled) setMediaReady(true);
    };

    img.onload = markReady;
    img.onerror = markReady;
    img.src = mediaUrl;

    if (img.complete) {
      markReady();
    } else if (typeof img.decode === "function") {
      img.decode().then(markReady).catch(() => {
        // onload/onerror will settle readiness if decode is unsupported by the source
      });
    }

    return () => {
      cancelled = true;
    };
  }, [gift?.media?.url, showVideo]);

  const isClosed = envelopePhase === "closed";
  const isOpening = envelopePhase === "opening";
  const isOpened = envelopePhase === "opened";

  const themeClass = "gift8-theme-envelope";
  const sceneVariantClass = `gift8-view-envelope-scene--${visualAnimationType}`;
  const envelopeVariantClass = `gift8-view-envelope--${visualAnimationType}`;
  const paperVariantClass = `gift8-view-envelope-paper--${visualAnimationType}`;
  const sealContent = <Heart className="w-4 h-4" />;
  const burstSymbols = ["♥", "✦", "✿", "✦", "♥", "✿"];
  const celebrationSymbols = ["♥", "✦", "✿", "♥", "✦", "✿", "♥", "✦", "✿"];

  const handleOpenEnvelope = useCallback(() => {
    if (!gift || envelopePhase !== "closed") return;

    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (celebrationTimerRef.current) {
      window.clearTimeout(celebrationTimerRef.current);
      celebrationTimerRef.current = null;
    }

    setEnvelopePhase("opening");
    setShowCelebration(false);

    openTimerRef.current = window.setTimeout(() => {
      setEnvelopePhase("opened");
      setShowCelebration(true);
      openTimerRef.current = null;

      celebrationTimerRef.current = window.setTimeout(() => {
        setShowCelebration(false);
        celebrationTimerRef.current = null;
      }, 3200);
    }, OPENING_TO_OPENED_MS);
  }, [envelopePhase, gift]);

  const renderEnvelopeLetter = useCallback(
    (className = "") => (
      <article
        className={`gift8-letter ${className} ${hasGiftMedia ? "has-media" : "text-only"} ${
          collectiveWishes.length ? "has-wishes" : ""
        } ${isOpened ? "is-expanded" : ""}`.trim()}
      >
        <div className="gift8-letter-inner">
          {isOpened && hasGiftMedia ? (
            <div className="gift8-letter-media">
              {showVideo ? (
                <video
                  src={gift?.media?.url}
                  className={`gift8-letter-media-asset ${mediaReady ? "is-ready" : ""}`.trim()}
                  autoPlay
                  loop
                  muted={muted}
                  playsInline
                  preload="auto"
                  onClick={() => setFullscreenMedia(true)}
                />
              ) : (
                <img
                  src={gift?.media?.url}
                  alt="gift media"
                  className={`gift8-letter-media-asset ${mediaReady ? "is-ready" : ""}`.trim()}
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                  onClick={() => setFullscreenMedia(true)}
                />
              )}

              {showVideo ? (
                <button
                  type="button"
                  onClick={() => setMuted((v) => !v)}
                  className="gift8-mute gift8-letter-mute"
                  aria-label={
                    muted
                      ? trGift("Дыбысты қосу", "Включить звук", "Unmute")
                      : trGift("Дыбысты өшіру", "Выключить звук", "Mute")
                  }
                >
                  {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="gift8-letter-copy">
            <p className="gift8-letter-text gift-script">{openingLine}</p>
            {gift?.from_name ? (
              <p className="gift8-letter-sign">
                <span className="gift8-letter-sign-mark" aria-hidden="true">
                  —
                </span>
                <span>{gift.from_name}</span>
              </p>
            ) : null}
          </div>

          {isOpened && collectiveWishes.length ? (
            <div className="gift8-letter-wishes">
              {collectiveWishes.map((wish, idx) => (
                <p key={`${wish.author}-${wish.text}-${idx}`} className="gift8-wish-minimal">
                  {wish.author ? `${wish.author}: ` : ""}
                  {wish.text}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </article>
    ),
    [collectiveWishes, gift?.from_name, gift?.media?.url, hasGiftMedia, isOpened, mediaReady, muted, openingLine, showVideo, trGift]
  );

  const renderOpenedAmbientLayer = () => {
    return (
      <div className="gift8-rose-layer" aria-hidden="true">
        <span className="gift8-rose r-1">✿</span>
        <span className="gift8-rose r-2">❀</span>
        <span className="gift8-rose r-3">✿</span>
        <span className="gift8-rose r-4">❀</span>
        <span className="gift8-rose r-5">✿</span>
        <span className="gift8-rose r-6">❀</span>
        <span className="gift8-rose r-7">✿</span>
        <span className="gift8-rose r-8">❀</span>
      </div>
    );
  };

  return (
    <main data-page-root className="gift8-view-root page-fade">
      <section className={`gift8-shell gift8-view-shell ${themeClass}`}>
        <div className="gift8-orb orb-1" aria-hidden="true" />
        <div className="gift8-orb orb-2" aria-hidden="true" />
        <div className="gift8-orb orb-3" aria-hidden="true" />

        <div className="gift8-particles" aria-hidden="true">
          <span className="gift8-particle p-1">♥</span>
          <span className="gift8-particle p-2">✦</span>
          <span className="gift8-particle p-3">❀</span>
          <span className="gift8-particle p-4">♥</span>
          <span className="gift8-particle p-5">✦</span>
          <span className="gift8-particle p-6">❀</span>
          <span className="gift8-particle p-7">♥</span>
          <span className="gift8-particle p-8">✦</span>
          <span className="gift8-particle p-9">❀</span>
          <span className="gift8-particle p-10">♥</span>
        </div>

        {loading ? (
          <div className="gift8-state-box text-white/80">
            {trFallback("Жүктелуде...", "Загрузка...", "Loading...")}
          </div>
        ) : error || !gift ? (
          <div className="gift8-state-box is-error">
            {error || trFallback("Ашық хат табылмады", "Открытка не найдена", "Card not found")}
          </div>
        ) : (
          <div
            className={`gift8-closed-stage gift8-view-closed ${isOpening ? "is-opening" : ""} ${isOpened ? "is-opened" : ""}`}
            onClick={isClosed ? handleOpenEnvelope : undefined}
            role={isClosed ? "button" : undefined}
            tabIndex={isClosed ? 0 : undefined}
            onKeyDown={
              isClosed
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleOpenEnvelope();
                    }
                  }
                : undefined
            }
            aria-label={isClosed ? trGift("Конвертті ашу", "Открыть конверт", "Open envelope") : undefined}
          >
            {isOpened ? (
              <>
                {showCelebration ? (
                  <div className="gift8-celebration" aria-hidden="true">
                    {celebrationSymbols.map((symbol, idx) => (
                      <span key={`celebration-${idx}-${symbol}`} className={`c c-${idx + 1}`}>
                        {symbol}
                      </span>
                    ))}
                  </div>
                ) : null}

                {renderOpenedAmbientLayer()}
              </>
            ) : null}

            <div className="gift8-closed-stage-stack gift8-view-closed-stack">
              <div
                className={`gift8-envelope-scene gift8-view-envelope-scene ${sceneVariantClass} ${isOpening ? "is-opening" : ""} ${isOpened ? "is-opened" : ""}`}
              >
                <div className="gift8-envelope-shadow gift8-view-envelope-shadow" />

                <div className={`gift8-envelope gift8-view-envelope ${envelopeVariantClass}`}>
                  <div className="gift8-envelope-chrome gift8-view-envelope-chrome" aria-hidden="true">
                    <div className="gift8-envelope-back gift8-view-envelope-back" />
                    <div className="gift8-envelope-flap gift8-view-envelope-flap" />
                    <div className="gift8-envelope-front gift8-view-envelope-front" />

                    <div className="gift8-envelope-seal gift8-view-envelope-seal">
                      {sealContent}
                    </div>

                    <div className="gift8-burst" aria-hidden="true">
                      {burstSymbols.map((symbol, idx) => (
                        <span key={`burst-${idx}-${symbol}`} className={`b-${idx + 1}`}>
                          {symbol}
                        </span>
                      ))}
                    </div>
                  </div>

                  {renderEnvelopeLetter(`gift8-view-envelope-paper ${paperVariantClass}`)}
                </div>
              </div>

              <div className="gift8-closed-stage-copy gift8-view-closed-copy">
                <p className="gift-script text-[2rem] sm:text-[2.6rem] text-rose-100/95 leading-none drop-shadow-[0_8px_30px_rgba(251,113,133,0.26)]">
                  {teaserLine}
                </p>
                <p className="text-sm sm:text-base text-white/70">
                  {isOpening
                    ? trGift("Ашылуда...", "Открываем...", "Opening...")
                    : trGift(
                        "Ашу үшін экранның кез келген жерін түртіңіз",
                        "Нажмите в любом месте экрана, чтобы открыть",
                        "Tap anywhere on the screen to open"
                      )}
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {fullscreenMedia && gift?.media?.url ? (
        <div
          className="fixed inset-0 z-[220] bg-black/96 p-3 sm:p-6 flex items-center justify-center"
          onClick={() => setFullscreenMedia(false)}
        >
          <button
            type="button"
            onClick={() => setFullscreenMedia(false)}
            className="absolute right-4 top-4 h-10 w-10 rounded-full border border-white/20 bg-black/70 text-white grid place-items-center"
            aria-label={trGift("Жабу", "Закрыть", "Close")}
          >
            <X className="w-5 h-5" />
          </button>

          {showVideo ? (
            <video
              src={gift.media.url}
              className="w-full max-h-[94vh] object-contain"
              controls
              autoPlay
              playsInline
              preload="auto"
              muted={false}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={gift.media.url}
              alt="gift media fullscreen"
              className="w-full max-h-[94vh] object-contain"
              loading="eager"
              decoding="async"
              fetchPriority="high"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      ) : null}
    </main>
  );
}
