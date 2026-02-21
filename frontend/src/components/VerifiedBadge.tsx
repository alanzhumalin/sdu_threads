import { Badge, Check } from "lucide-react";
import { useI18n } from "../i18n";

type VerifiedBadgeProps = {
  className?: string;
};

export function VerifiedBadge({ className = "" }: VerifiedBadgeProps) {
  const { pick } = useI18n();
  const label = pick({
    kk: "Верификациядан өткен қолданушы",
    ru: "Верифицированный пользователь",
    en: "Verified user",
  });

  return (
    <span
      className={`relative inline-flex h-[16px] w-[16px] items-center justify-center align-middle ${className}`.trim()}
      aria-label={label}
      title={label}
    >
      <Badge
        className="h-[16px] w-[16px] text-sky-500 drop-shadow-[0_0_0.5px_rgba(56,189,248,0.55)]"
        fill="currentColor"
        strokeWidth={1.8}
      />
      <Check className="absolute h-2.5 w-2.5 text-white" strokeWidth={3.4} />
    </span>
  );
}
