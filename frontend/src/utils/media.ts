export const fileToWebpIfNeeded = async (file: File): Promise<File> => {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif") return file;

  // быстрые early-exit
  // Target max size for uploaded images (<= 1MB).
  const MAX_BYTES = 1024 * 1024;
  const MIN_BYTES = 100 * 1024;

  // если уже webp и размер ок — не трогаем
  if (file.type === "image/webp" && file.size <= MAX_BYTES) return file;

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

    // 1) первая попытка: хорошее качество
    let scale = 1.0;
    let canvas = drawScaled(scale);
    let blob = await toBlob(canvas, 0.82);

    if (blob.size <= MAX_BYTES) {
      // @ts-ignore
      bitmap.close?.();
      return new File([blob], `${base}.webp`, { type: "image/webp" });
    }

    // 2) если больше лимита — оценим нужный даунскейл по sqrt(size)
    // size ~ area => scale ~ sqrt(target/current)
    const ratio1 = Math.sqrt(MAX_BYTES / blob.size) * 0.95;
    scale = Math.max(0.1, Math.min(0.98, scale * ratio1));
    canvas = drawScaled(scale);
    blob = await toBlob(canvas, 0.78);

    if (blob.size <= MAX_BYTES) {
      // @ts-ignore
      bitmap.close?.();
      return new File([blob], `${base}.webp`, { type: "image/webp" });
    }

    // 3) последняя попытка: ещё чуть меньше + качество пониже
    const ratio2 = Math.sqrt(MAX_BYTES / blob.size) * 0.95;
    scale = Math.max(0.1, Math.min(0.98, scale * ratio2));
    canvas = drawScaled(scale);
    blob = await toBlob(canvas, 0.70);

    // 4) safety net: ensure we are <= MAX_BYTES (few extra iterations).
    // This keeps backend/storage limits predictable.
    let guard = 0;
    while (blob.size > MAX_BYTES && guard < 3) {
      const ratio = Math.sqrt(MAX_BYTES / blob.size) * 0.92;
      scale = Math.max(0.08, Math.min(0.98, scale * ratio));
      canvas = drawScaled(scale);
      blob = await toBlob(canvas, 0.62);
      guard += 1;
    }

    // если вдруг получилось слишком мало — можно поднять качество без ресайза (дёшево)
    if (blob.size < MIN_BYTES) {
      const b2 = await toBlob(canvas, 0.85);
      // @ts-ignore
      bitmap.close?.();
      if (b2.size <= MAX_BYTES) {
        return new File([b2], `${base}.webp`, { type: "image/webp" });
      }
      return new File([blob], `${base}.webp`, { type: "image/webp" });
    }

    // @ts-ignore
    bitmap.close?.();
    return new File([blob], `${base}.webp`, { type: "image/webp" });
  } catch {
    return file;
  }
};

export const getImageDimensions = async (blob: Blob): Promise<{ width: number; height: number }> => {
  try {
    // Fast path in modern browsers.
    // @ts-ignore
    const bmp: ImageBitmap = await createImageBitmap(blob as any);
    const width = (bmp as any).width ?? 0;
    const height = (bmp as any).height ?? 0;
    // @ts-ignore
    bmp.close?.();
    if (width > 0 && height > 0) return { width, height };
  } catch {
    // fallthrough
  }

  // Fallback for Safari/older browsers.
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const width = (img as any).naturalWidth ?? 0;
      const height = (img as any).naturalHeight ?? 0;
      URL.revokeObjectURL(url);
      resolve({ width, height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image_load_failed"));
    };
    img.src = url;
  });
};
