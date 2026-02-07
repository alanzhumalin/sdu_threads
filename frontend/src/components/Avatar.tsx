type Props = {
  src?: string | null;
  fallback: string;
  className?: string;
  alt?: string;
};

export function AvatarCircle({ src, fallback, className, alt = "" }: Props) {
  const letter = (String(fallback || "").trim()[0] || "?").toUpperCase();

  return (
    <span
      className={`relative inline-flex shrink-0 rounded-full bg-white/10 overflow-hidden items-center justify-center ${
        className ?? ""
      }`}
    >
      <span aria-hidden className="select-none pointer-events-none">
        {letter}
      </span>
      {src ? (
        <img
          src={src}
          alt={alt}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={(e) => {
            // Fall back to initials without adding state.
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </span>
  );
}

