import { useEffect, useMemo, useState, type ReactNode } from "react";

type Props = {
  text: string;
  renderText: (text: string) => ReactNode;
  className?: string;
  collapsedLines?: number;
  collapseAtChars?: number;
};

export function ExpandablePostText({
  text,
  renderText,
  className,
  collapsedLines = 6,
  collapseAtChars = 340,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [text]);

  const shouldCollapse = useMemo(() => {
    const lines = text.split(/\r?\n/).length;
    return text.length > collapseAtChars || lines > collapsedLines;
  }, [collapseAtChars, collapsedLines, text]);

  const collapseClass =
    !expanded && shouldCollapse
      ? `[display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:${collapsedLines}] overflow-hidden`
      : "";

  return (
    <div className="mt-3">
      <div className={`${className ?? ""} ${collapseClass}`.trim()}>{renderText(text)}</div>
      {shouldCollapse ? (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-2 text-sm font-medium text-white/70 hover:text-white transition"
        >
          {expanded ? "Скрыть" : "Показать ещё"}
        </button>
      ) : null}
    </div>
  );
}
