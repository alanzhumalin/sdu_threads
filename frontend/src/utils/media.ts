export const fileToWebpIfNeeded = async (file: File): Promise<File> => {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif") return file; // GIF не трогаем (анимация)

  const MIN_BYTES = 100 * 1024;     
  const MAX_BYTES = 900 * 1024;  

  const base = (file.name || "image").replace(/\.[^.]+$/, "");

  const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("webp_convert_failed"))),
        "image/webp",
        quality
      );
    });

  try {
    const bitmap = await createImageBitmap(file);

    const drawScaled = (scale: number) => {
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("no_canvas_ctx");
      ctx.drawImage(bitmap, 0, 0, w, h);
      return canvas;
    };

    const fitMaxByQuality = async (canvas: HTMLCanvasElement) => {
      let lo = 0.45;
      let hi = 0.92;
      let best: Blob | null = null;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        const b = await toBlob(canvas, mid);
        if (b.size <= MAX_BYTES) {
          best = b;
          lo = mid;
        } else {
          hi = mid;
        }
      }
      if (best) return best;
      return await toBlob(canvas, lo);
    };

    let scale = 1.0;
    let canvas = drawScaled(scale);

    for (let iter = 0; iter < 10; iter++) {
      const blob = await fitMaxByQuality(canvas);

      if (blob.size >= MIN_BYTES && blob.size <= MAX_BYTES) {
        // @ts-ignore
        bitmap.close?.();
        return new File([blob], `${base}.webp`, { type: "image/webp" });
      }

      if (blob.size < MIN_BYTES) {
        // маленькая картинка — просто дадим качество повыше и выходим
        const b2 = await toBlob(canvas, 0.95);
        // @ts-ignore
        bitmap.close?.();
        return new File([b2], `${base}.webp`, { type: "image/webp" });
      }

      // blob.size > MAX_BYTES: уменьшаем пиксели
      const ratio = Math.sqrt(MAX_BYTES / blob.size) * 0.95;
      const nextScale = Math.max(0.1, scale * Math.min(0.9, ratio));
      if (Math.abs(nextScale - scale) < 0.02) {
        // @ts-ignore
        bitmap.close?.();
        return new File([blob], `${base}.webp`, { type: "image/webp" });
      }
      scale = nextScale;
      canvas = drawScaled(scale);
    }

    const fallback = await toBlob(canvas, 0.75);
    // @ts-ignore
    bitmap.close?.();
    return new File([fallback], `${base}.webp`, { type: "image/webp" });
  } catch {
    return file;
  }
};