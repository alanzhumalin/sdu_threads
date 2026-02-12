export const fileToWebpIfNeeded = async (file: File): Promise<File> => {
  return file;
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
