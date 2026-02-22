export function extractHashtags(text: string): string[] {
  const value = String(text || "");
  const unique = new Set<string>();

  try {
    const re = /#([\p{L}\p{N}_-]+)/gu;
    for (const match of value.matchAll(re)) {
      const raw = String(match[1] || "").trim().toLowerCase();
      if (!raw) continue;
      unique.add(raw);
    }
  } catch {
    const fallback = /#([A-Za-z0-9_-]+)/g;
    for (const match of value.matchAll(fallback)) {
      const raw = String(match[1] || "").trim().toLowerCase();
      if (!raw) continue;
      unique.add(raw);
    }
  }

  return Array.from(unique);
}

