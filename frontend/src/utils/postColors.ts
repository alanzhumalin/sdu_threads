export const POST_CONTAINER_COLOR_OPTIONS = [
  {
    key: "ocean",
    label: "Ocean",
    previewClass: "bg-gradient-to-br from-cyan-400 to-blue-500",
    cardClass: "border-cyan-300/30 bg-gradient-to-br from-cyan-500/18 to-blue-500/12",
  },
  {
    key: "rose",
    label: "Rose",
    previewClass: "bg-gradient-to-br from-rose-400 to-pink-500",
    cardClass: "border-rose-300/30 bg-gradient-to-br from-rose-500/18 to-pink-500/12",
  },
  {
    key: "emerald",
    label: "Emerald",
    previewClass: "bg-gradient-to-br from-emerald-400 to-teal-500",
    cardClass: "border-emerald-300/30 bg-gradient-to-br from-emerald-500/18 to-teal-500/12",
  },
  {
    key: "amber",
    label: "Amber",
    previewClass: "bg-gradient-to-br from-amber-400 to-orange-500",
    cardClass: "border-amber-300/30 bg-gradient-to-br from-amber-500/18 to-orange-500/12",
  },
  {
    key: "violet",
    label: "Violet",
    previewClass: "bg-gradient-to-br from-indigo-400 to-violet-500",
    cardClass: "border-indigo-300/30 bg-gradient-to-br from-indigo-500/18 to-violet-500/12",
  },
] as const;

type Option = (typeof POST_CONTAINER_COLOR_OPTIONS)[number];
export type PostContainerColorKey = Option["key"] | "";

const optionMap = new Map<string, Option>(
  POST_CONTAINER_COLOR_OPTIONS.map((item) => [item.key, item])
);

export const normalizePostContainerColor = (raw?: string | null): PostContainerColorKey => {
  const key = String(raw || "")
    .trim()
    .toLowerCase();
  if (key === "") return "";
  return optionMap.has(key) ? (key as PostContainerColorKey) : "";
};

export const getPostContainerColorClass = (raw?: string | null) => {
  const key = normalizePostContainerColor(raw);
  if (!key) return "";
  return optionMap.get(key)?.cardClass || "";
};
