import { useMemo, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import {
  X,
  Instagram,
  Github,
  Linkedin,
  ExternalLink,
} from "lucide-react";
import telegramIconUrl from "../assets/telegram.png";

export type SocialType = "instagram" | "telegram" | "github" | "linkedin";
export type SocialLinks = Partial<Record<SocialType, string>>;

function TelegramIcon({ className = "" }: { className?: string }) {
  return (
    <img
      src={telegramIconUrl}
      className={`${className} block`}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

const labels: Record<SocialType, string> = {
  instagram: "Instagram",
  telegram: "Telegram",
  github: "GitHub",
  linkedin: "LinkedIn",
};

const icons: Record<SocialType, JSX.Element> = {
  instagram: <Instagram className="w-[18px] h-[18px]" strokeWidth={1.7} />,
  telegram: (
    <TelegramIcon className="w-[18px] h-[18px] opacity-80 group-hover:opacity-100 transition" />
  ),
  github: <Github className="w-[18px] h-[18px]" strokeWidth={1.7} />,
  linkedin: <Linkedin className="w-[18px] h-[18px]" strokeWidth={1.7} />,
};

type Props = {
  links?: SocialLinks | null;
  className?: string;
};

export function SocialLinksOverlay({ links, className = "" }: Props) {
  const items = useMemo(() => {
    if (!links) return [];
    return (Object.entries(links) as [SocialType, string][])
      .filter(([, url]) => typeof url === "string" && url.trim() !== "")
      .map(([type, url]) => ({ type, url: url.trim() }));
  }, [links]);

  const [open, setOpen] = useState<{ type: SocialType; url: string } | null>(
    null
  );

  if (!items.length) return null;

  return (
    <>
      <div className={className}>
        {items.map((it) => (
          <button
            key={it.type}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(it);
            }}
            className="group w-8 h-8 rounded-full overflow-hidden bg-black/60 border border-white/10 hover:border-white/30 text-white/80 hover:text-white grid place-items-center transition"
            title={labels[it.type]}
            aria-label={labels[it.type]}
          >
            {it.type === "telegram" ? (
              <TelegramIcon className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition" />
            ) : (
              icons[it.type]
            )}
          </button>
        ))}
      </div>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[260] bg-black/70 backdrop-blur-md"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setOpen(null);
            }}
          >
            <div className="min-h-screen w-full flex items-center justify-center px-4 py-8">
              <div className="bg-[#0b0b0f] border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative space-y-4">
                <button
                  type="button"
                  className="absolute top-3 right-3 text-white/60 hover:text-white"
                  onClick={() => setOpen(null)}
                  aria-label="Закрыть"
                >
                  <X className="w-5 h-5" />
                </button>

                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 grid place-items-center text-white/80">
                    {icons[open.type]}
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-semibold leading-tight">
                      {labels[open.type]}
                    </p>
                    <p className="text-white/50 text-sm">
                      Вы переходите на внешний сайт
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/40 p-3 flex items-start gap-2">
                  <ExternalLink className="w-4 h-4 text-white/50 mt-0.5" strokeWidth={1.7} />
                  <p className="text-white/70 text-sm break-all">{open.url}</p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setOpen(null)}
                    className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/80 hover:border-white/40 transition"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const url = open.url;
                      // Frontend validates, but keep a last safe-guard.
                      if (!url.startsWith("https://")) return;
                      // Close first so the UI doesn't look "stuck" while the new tab opens.
                      flushSync(() => setOpen(null));
                      window.open(url, "_blank", "noopener,noreferrer");
                    }}
                    className="rounded-full bg-white text-black px-4 py-2 text-sm font-semibold hover:bg-white/90 transition"
                  >
                    Перейти
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
