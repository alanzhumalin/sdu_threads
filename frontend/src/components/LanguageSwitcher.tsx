import { Check, ChevronDown, Languages } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { type AppLanguage, useI18n } from "../i18n";

const options: Array<{ value: AppLanguage; short: string; nameKey: "lang.name.kk" | "lang.name.ru" | "lang.name.en" }> = [
  { value: "kk", short: "KZ", nameKey: "lang.name.kk" },
  { value: "ru", short: "RU", nameKey: "lang.name.ru" },
  { value: "en", short: "EN", nameKey: "lang.name.en" },
];

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (evt: MouseEvent) => {
      const target = evt.target as Node | null;
      if (!target) return;
      if (ref.current?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const current = options.find((o) => o.value === language) || options[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="h-10 rounded-xl border border-white/15 bg-black/80 px-3 text-white/90 hover:bg-black/95 inline-flex items-center gap-2 backdrop-blur"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={t("lang.switcher_aria")}
      >
        <Languages className="w-4 h-4 text-white/70" />
        <span className="text-xs font-semibold tracking-wide">{current.short}</span>
        <ChevronDown className={`w-4 h-4 text-white/60 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-44 rounded-xl border border-white/12 bg-black/95 p-1.5 shadow-2xl backdrop-blur">
          {options.map((opt) => {
            const selected = opt.value === language;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setLanguage(opt.value);
                  setOpen(false);
                }}
                className={`w-full rounded-lg px-2.5 py-2 text-left text-sm flex items-center justify-between transition ${
                  selected ? "bg-white/12 text-white" : "text-white/80 hover:bg-white/8 hover:text-white"
                }`}
              >
                <span>{t(opt.nameKey)}</span>
                {selected ? <Check className="w-4 h-4 text-sky-300" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

