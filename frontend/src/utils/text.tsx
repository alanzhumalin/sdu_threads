import { Fragment } from "react";

export const highlightHashtags = (text: string) => {
  const parts = text.split(/(#[\p{L}\p{N}_-]+)/gu);
  return parts.map((part, idx) => {
    if (/^#[\p{L}\p{N}_-]+$/u.test(part)) {
      return (
        <span key={idx} className="text-sky-400 font-semibold">
          {part}
        </span>
      );
    }
    return <Fragment key={idx}>{part}</Fragment>;
  });
};

