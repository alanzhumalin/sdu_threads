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

export const getVideoDimensions = async (blob: Blob): Promise<{ width: number; height: number }> => {
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    let settled = false;

    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("error", onErr);
      video.src = "";
      URL.revokeObjectURL(url);
    };

    const onMeta = () => {
      if (settled) return;
      const width = Number(video.videoWidth || 0);
      const height = Number(video.videoHeight || 0);
      settled = true;
      cleanup();
      if (width > 0 && height > 0) {
        resolve({ width, height });
      } else {
        reject(new Error("video_metadata_failed"));
      }
    };

    const onErr = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("video_load_failed"));
    };

    video.preload = "metadata";
    video.playsInline = true;
    video.muted = true;
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("error", onErr);
    video.src = url;
  });
};
