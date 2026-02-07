export const fileToWebpIfNeeded = async (file: File): Promise<File> => {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif" || file.type === "image/webp") return file;

  // Best-effort: if conversion fails (e.g. unsupported format), upload original.
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0);
    // @ts-ignore - not available in older types but supported in modern browsers.
    bitmap.close?.();

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("webp_convert_failed"))),
        "image/webp",
        0.9
      );
    });

    const base = (file.name || "image").replace(/\\.[^.]+$/, "");
    return new File([blob], `${base}.webp`, { type: "image/webp" });
  } catch {
    return file;
  }
};

