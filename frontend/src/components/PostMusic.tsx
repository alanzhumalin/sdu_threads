import { useEffect, useMemo, useRef, useState } from "react";
import { Music2, Pause, Play } from "lucide-react";
import type { PostMusic as PostMusicItem } from "../types/media";
import { useI18n } from "../i18n";

type Props = {
  music?: PostMusicItem | null;
  className?: string;
};

const fmt = (sec: number) => {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

export function PostMusic({ music, className }: Props) {
  const { pick } = useI18n();
  const tr = (kk: string, ru: string, en: string) => pick({ kk, ru, en });
  const audioURL = String(music?.audio_url || "").trim();
  if (!audioURL) return null;

  const meta = useMemo(() => {
    const durationRaw = Number(music?.duration_sec || 0);
    const duration = Number.isFinite(durationRaw) && durationRaw > 0 ? Math.floor(durationRaw) : 0;

    const startRaw = Number(music?.clip_start_sec || 0);
    const clipStart = Number.isFinite(startRaw) && startRaw > 0 ? Math.floor(startRaw) : 0;

    const endRaw = Number(music?.clip_end_sec || 0);
    const fallbackEnd = duration > 0 ? duration : clipStart + 30;
    const endBase = Number.isFinite(endRaw) && endRaw > 0 ? Math.floor(endRaw) : fallbackEnd;
    const maxEnd = duration > 0 ? Math.max(duration, clipStart+1) : Math.max(endBase, clipStart+1);
    const clipEnd = Math.max(clipStart + 1, Math.min(maxEnd, endBase));

    return {
      title: String(music?.title || "").trim() || "Music",
      artist: String(music?.artist || "").trim(),
      coverURL: String(music?.cover_url || "").trim(),
      clipStart,
      clipEnd,
      clipDuration: Math.max(1, clipEnd - clipStart),
    };
  }, [
    music?.artist,
    music?.clip_end_sec,
    music?.clip_start_sec,
    music?.cover_url,
    music?.duration_sec,
    music?.title,
  ]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(meta.clipStart);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setIsPlaying(false);
    setPosition(meta.clipStart);
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    try {
      audio.currentTime = meta.clipStart;
    } catch {
      // ignore seek errors before metadata load
    }
  }, [audioURL, meta.clipStart, meta.clipEnd]);

  const onLoadedMeta = () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      audio.currentTime = meta.clipStart;
    } catch {
      // ignore
    }
  };

  const onTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : meta.clipStart;
    if (current >= meta.clipEnd - 0.04) {
      audio.pause();
      try {
        audio.currentTime = meta.clipStart;
      } catch {
        // ignore
      }
      setPosition(meta.clipEnd);
      setIsPlaying(false);
      return;
    }
    setPosition(current < meta.clipStart ? meta.clipStart : current);
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    try {
      if (audio.currentTime < meta.clipStart || audio.currentTime >= meta.clipEnd - 0.04) {
        audio.currentTime = meta.clipStart;
      }
      await audio.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  };

  const seek = (nextValue: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const bounded = Math.max(0, Math.min(meta.clipDuration, nextValue));
    const nextPos = meta.clipStart + bounded;
    try {
      audio.currentTime = nextPos;
    } catch {
      // ignore
    }
    setPosition(nextPos);
  };

  const relativePosition = Math.max(0, Math.min(meta.clipDuration, position - meta.clipStart));
  const progress = Math.max(0, Math.min(100, (relativePosition / meta.clipDuration) * 100));

  return (
    <div className={`mt-3 rounded-2xl border border-white/10 bg-black/25 p-3 ${className || ""}`}>
      <audio
        ref={audioRef}
        src={audioURL}
        preload="metadata"
        onLoadedMetadata={onLoadedMeta}
        onTimeUpdate={onTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />

      <div className="flex items-center gap-3">
        {meta.coverURL ? (
          <img
            src={meta.coverURL}
            alt={meta.title}
            className="h-12 w-12 shrink-0 rounded-xl object-cover bg-white/10"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="h-12 w-12 shrink-0 rounded-xl bg-white/10 text-white/80 grid place-items-center">
            <Music2 className="h-5 w-5" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{meta.title}</p>
          <p className="truncate text-xs text-white/60">{meta.artist || tr("Белгісіз әртіс", "Неизвестный исполнитель", "Unknown artist")}</p>
          <p className="truncate text-[11px] text-white/45">{tr("Сіздің файлыңыз", "Ваш файл", "Your file")}</p>
        </div>

        <button
          type="button"
          onClick={togglePlay}
          className="h-9 w-9 shrink-0 rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/15 transition"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause className="h-4 w-4 mx-auto" /> : <Play className="h-4 w-4 mx-auto translate-x-[1px]" />}
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="w-10 shrink-0 text-[11px] tabular-nums text-white/60">{fmt(relativePosition)}</span>
        <div className="relative h-2 flex-1">
          <div className="absolute inset-0 rounded-full bg-white/15" />
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-sky-300"
            style={{ width: `${progress}%` }}
          />
          <input
            type="range"
            min={0}
            max={meta.clipDuration}
            step={0.05}
            value={relativePosition}
            onChange={(e) => seek(Number(e.target.value))}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="music-position"
          />
        </div>
        <span className="w-10 shrink-0 text-[11px] tabular-nums text-right text-white/60">{fmt(meta.clipDuration)}</span>
      </div>
    </div>
  );
}
