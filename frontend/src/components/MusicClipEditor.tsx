import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Scissors } from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { Region } from "wavesurfer.js/dist/plugins/regions.esm.js";
import { useI18n } from "../i18n";

type Props = {
  src: string;
  durationSec: number;
  clipStartSec: number;
  clipEndSec: number;
  maxClipSec?: number;
  onClipChange: (startSec: number, endSec: number) => void;
};

const EPS = 0.05;

const fmt = (sec: number) => {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const normalizeRange = (start: number, end: number, duration: number, maxClipSec: number) => {
  const safeDuration = Math.max(1, duration);
  let safeStart = Number.isFinite(start) ? start : 0;
  let safeEnd = Number.isFinite(end) && end > 0 ? end : safeStart + maxClipSec;

  safeStart = Math.max(0, Math.min(safeDuration - 1, safeStart));
  safeEnd = Math.max(safeStart + 1, Math.min(safeDuration, safeEnd));
  if (safeEnd - safeStart > maxClipSec) {
    safeEnd = safeStart + maxClipSec;
  }

  return { start: safeStart, end: safeEnd };
};

const toRounded = (value: { start: number; end: number }) => ({
  start: Math.max(0, Math.round(value.start)),
  end: Math.max(1, Math.round(value.end)),
});

export function MusicClipEditor({
  src,
  durationSec,
  clipStartSec,
  clipEndSec,
  maxClipSec = 30,
  onClipChange,
}: Props) {
  const { pick } = useI18n();
  const tr = (kk: string, ru: string, en: string) => pick({ kk, ru, en });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const waveRef = useRef<WaveSurfer | null>(null);
  const regionRef = useRef<Region | null>(null);
  const durationRef = useRef<number>(Math.max(1, durationSec || 1));
  const clipStartRef = useRef(clipStartSec);
  const clipEndRef = useRef(clipEndSec);
  const onClipChangeRef = useRef(onClipChange);

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(Math.max(1, durationSec || 1));
  const [clip, setClip] = useState(() =>
    normalizeRange(clipStartSec, clipEndSec, Math.max(1, durationSec || 1), maxClipSec)
  );

  const clipDuration = useMemo(() => Math.max(1, clip.end - clip.start), [clip.end, clip.start]);
  const progress = useMemo(() => {
    const local = Math.max(0, Math.min(clipDuration, currentTime - clip.start));
    return Math.max(0, Math.min(100, (local / clipDuration) * 100));
  }, [clip.start, clipDuration, currentTime]);

  useEffect(() => {
    durationRef.current = Math.max(1, durationSec || 1);
  }, [durationSec]);

  useEffect(() => {
    clipStartRef.current = clipStartSec;
    clipEndRef.current = clipEndSec;
  }, [clipStartSec, clipEndSec]);

  useEffect(() => {
    onClipChangeRef.current = onClipChange;
  }, [onClipChange]);

  const setClipIfChanged = (next: { start: number; end: number }) => {
    setClip((prev) => {
      if (Math.abs(prev.start - next.start) < EPS && Math.abs(prev.end - next.end) < EPS) {
        return prev;
      }
      return next;
    });
  };

  useEffect(() => {
    const ws = waveRef.current;
    const region = regionRef.current;
    if (!ws || !region) {
      setClipIfChanged(normalizeRange(clipStartSec, clipEndSec, durationRef.current, maxClipSec));
      return;
    }

    const next = normalizeRange(clipStartSec, clipEndSec, durationRef.current, maxClipSec);
    const changed = Math.abs(region.start - next.start) > EPS || Math.abs(region.end - next.end) > EPS;
    if (changed) {
      region.setOptions({ start: next.start, end: next.end });
      const now = ws.getCurrentTime();
      if (now < next.start || now > next.end - EPS) {
        ws.setTime(next.start);
        setCurrentTime(next.start);
      }
    }
    setClipIfChanged(next);
  }, [clipStartSec, clipEndSec, maxClipSec]);

  useEffect(() => {
    if (!src || !containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      url: src,
      height: 84,
      waveColor: "rgba(255,255,255,0.3)",
      progressColor: "rgba(56,189,248,0.7)",
      cursorColor: "rgba(125,211,252,0.95)",
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1.5,
      barRadius: 3,
      normalize: true,
      dragToSeek: true,
      hideScrollbar: true,
      backend: "MediaElement",
    });

    const regions = ws.registerPlugin(RegionsPlugin.create());
    waveRef.current = ws;
    setReady(false);
    setLoadError("");
    setIsPlaying(false);

    const syncRegion = (region: Region, emit: boolean) => {
      const next = normalizeRange(region.start, region.end, durationRef.current, maxClipSec);
      if (Math.abs(region.start - next.start) > EPS || Math.abs(region.end - next.end) > EPS) {
        region.setOptions({ start: next.start, end: next.end });
      }
      setClipIfChanged(next);
      if (emit) {
        const nextRounded = toRounded(next);
        if (nextRounded.start !== clipStartRef.current || nextRounded.end !== clipEndRef.current) {
          onClipChangeRef.current(nextRounded.start, nextRounded.end);
        }
      }
    };

    ws.on("ready", (rawDuration) => {
      const safeDuration = Math.max(1, Number.isFinite(rawDuration) ? rawDuration : durationRef.current);
      durationRef.current = safeDuration;
      setDuration(safeDuration);
      setReady(true);

      const next = normalizeRange(clipStartRef.current, clipEndRef.current, safeDuration, maxClipSec);
      const region = regions.addRegion({
        start: next.start,
        end: next.end,
        color: "rgba(56,189,248,0.26)",
        drag: true,
        resize: true,
        minLength: 1,
        maxLength: maxClipSec,
      });
      regionRef.current = region;
      setClipIfChanged(next);
      ws.setTime(next.start);
      setCurrentTime(next.start);

      const nextRounded = toRounded(next);
      if (nextRounded.start !== clipStartRef.current || nextRounded.end !== clipEndRef.current) {
        onClipChangeRef.current(nextRounded.start, nextRounded.end);
      }
    });

    ws.on("timeupdate", (time) => {
      const region = regionRef.current;
      if (!region) {
        setCurrentTime(time);
        return;
      }
      if (time >= region.end - EPS) {
        ws.pause();
        ws.setTime(region.start);
        setCurrentTime(region.start);
        return;
      }
      setCurrentTime(Math.max(region.start, time));
    });
    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("error", () => setLoadError(tr("Аудио превью жүктелмеді", "Не удалось загрузить превью аудио", "Failed to load audio preview")));

    regions.on("region-update", (region) => syncRegion(region, false));
    regions.on("region-updated", (region) => syncRegion(region, true));

    return () => {
      regionRef.current = null;
      waveRef.current = null;
      ws.destroy();
    };
  }, [maxClipSec, src]);

  const togglePlay = async () => {
    const ws = waveRef.current;
    const region = regionRef.current;
    if (!ws || !region) return;
    if (ws.isPlaying()) {
      ws.pause();
      return;
    }
    const now = ws.getCurrentTime();
    if (now < region.start || now >= region.end - EPS) {
      ws.setTime(region.start);
    }
    try {
      await ws.play();
    } catch {
      // ignore autoplay/playback errors
    }
  };

  const seek = (value: number) => {
    const ws = waveRef.current;
    const region = regionRef.current;
    if (!ws || !region) return;
    const next = Math.max(region.start, Math.min(region.end, value));
    ws.setTime(next);
    setCurrentTime(next);
  };

  const currentLocal = Math.max(0, Math.min(clipDuration, currentTime - clip.start));

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/35 bg-cyan-400/15 px-2.5 py-1 text-[11px] text-cyan-100">
          <Scissors className="h-3.5 w-3.5" />
          {tr("Үзіндіні таңдау", "Выбор фрагмента", "Clip selection")}
        </div>
        <button
          type="button"
          onClick={() => void togglePlay()}
          disabled={!ready}
          className="h-8 w-8 rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/15 disabled:opacity-40"
          aria-label={isPlaying ? tr("Кідірту", "Пауза", "Pause") : tr("Ойнату", "Воспроизвести", "Play")}
          title={isPlaying ? tr("Кідірту", "Пауза", "Pause") : tr("Ойнату", "Воспроизвести", "Play")}
        >
          {isPlaying ? <Pause className="mx-auto h-4 w-4" /> : <Play className="mx-auto h-4 w-4 translate-x-[1px]" />}
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10 bg-black/35 p-2">
        <div ref={containerRef} className="w-full" />
      </div>

      <div className="flex items-center gap-2 text-[11px] text-white/65">
        <span className="w-10 shrink-0 tabular-nums">{fmt(currentLocal)}</span>
        <div className="relative h-2 flex-1">
          <div className="absolute inset-0 rounded-full bg-white/15" />
          <div className="absolute left-0 top-0 h-full rounded-full bg-cyan-300" style={{ width: `${progress}%` }} />
          <input
            type="range"
            min={clip.start}
            max={clip.end}
            step={0.05}
            value={Math.max(clip.start, Math.min(clip.end, currentTime))}
            onChange={(e) => seek(Number(e.target.value))}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={tr("Аудио орны", "Позиция аудио", "Audio position")}
          />
        </div>
        <span className="w-10 shrink-0 text-right tabular-nums">{fmt(clipDuration)}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
          <p className="text-white/50">{tr("Басы", "Начало", "Start")}</p>
          <p className="font-semibold tabular-nums text-white">{fmt(clip.start)}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
          <p className="text-white/50">{tr("Соңы", "Конец", "End")}</p>
          <p className="font-semibold tabular-nums text-white">{fmt(clip.end)}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
          <p className="text-white/50">{tr("Үзінді", "Фрагмент", "Clip")}</p>
          <p className="font-semibold tabular-nums text-white">
            {fmt(clipDuration)} / {fmt(Math.max(1, Math.floor(Math.min(maxClipSec, duration))))}
          </p>
        </div>
      </div>

      {loadError && <p className="text-xs text-red-300/90">{loadError}</p>}
    </div>
  );
}
