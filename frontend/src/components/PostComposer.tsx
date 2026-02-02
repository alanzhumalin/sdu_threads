import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { Image as ImageIcon } from "lucide-react";

type Props = {
  onCreated?: () => void;
};

type HashtagSuggestion = { id: number; name: string };

const extractHashtags = (text: string) => {
  const matches = text.match(/#([\p{L}\p{N}_-]+)/gu) || [];
  const unique = new Set(
    matches
      .map((m) => m.slice(1).toLowerCase())
      .filter(Boolean)
  );
  return Array.from(unique);
};

const highlightInlineHashtags = (text: string) => {
  const parts = text.split(/(#[\p{L}\p{N}_-]+)/gu);
  if (parts.length === 0) return [<span key="empty">&nbsp;</span>];
  return parts.map((part, idx) => {
    if (/^#[\p{L}\p{N}_-]+$/u.test(part)) {
      return (
        <span key={idx} className="text-sky-400">
          {part}
        </span>
      );
    }
    if (part === "") {
      return <span key={idx} />;
    }
    return <span key={idx}>{part}</span>;
  });
};

const findActiveHashtag = (text: string, cursor: number) => {
  try {
    const beforeCursor = text.slice(0, cursor);
    const hashIndex = beforeCursor.lastIndexOf("#");
    if (hashIndex === -1) return null;
    const afterHash = beforeCursor.slice(hashIndex);
    const match = afterHash.match(/^#([\p{L}\p{N}_-]*)$/u);
    if (!match) return null;
    const query = match[1] || "";
    return { start: hashIndex, end: cursor, query };
  } catch {
    return null;
  }
};

export default function PostComposer({ onCreated }: Props) {
  const token = useAuthStore((s) => s.token);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [cursor, setCursor] = useState(0);
  const [activeTag, setActiveTag] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const [suggestions, setSuggestions] = useState<HashtagSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const MIN_TA_HEIGHT = 72;

  const autoResize = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const next = Math.max(ta.scrollHeight, MIN_TA_HEIGHT);
    ta.style.height = `${next}px`;
  };

  useEffect(() => {
    const tag = findActiveHashtag(content, cursor);
    if (!tag) {
      setActiveTag(null);
      setSuggestionsOpen(false);
      return;
    }
    setActiveTag(tag);
  }, [content, cursor]);

  useEffect(() => {
    if (!activeTag || activeTag.query.trim() === "") {
      setSuggestions([]);
      setSuggestionsOpen(false);
      return;
    }
    let cancelled = false;
    setSuggestionsLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.searchHashtags(activeTag.query, 8);
        if (!cancelled) {
          setSuggestions(Array.isArray(res) ? res : []);
          setSuggestionsOpen(true);
        }
      } catch {
        if (!cancelled) {
          setSuggestions([]);
          setSuggestionsOpen(false);
        }
      } finally {
        if (!cancelled) setSuggestionsLoading(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [activeTag?.query]);

  useLayoutEffect(() => {
    if (!suggestionsOpen || !textareaRef.current) return;
    const update = () => {
      const rect = textareaRef.current!.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 8,
        left: rect.left + 8,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [suggestionsOpen, textareaRef.current]);

  useEffect(() => {
    autoResize();
  }, [content]);

  const replaceActiveHashtag = (name: string) => {
    if (!activeTag) return;
    setContent((prev) => {
      const before = prev.slice(0, activeTag.start);
      const after = prev.slice(activeTag.end);
      return `${before}#${name}${after}`;
    });
    const pos = activeTag.start + name.length + 1;
    setCursor(pos);
    setSuggestionsOpen(false);
    setActiveTag(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const tags = extractHashtags(content);
      await api.createPost({ content, hashtags: tags }, token);
      setContent("");
      setSuggestions([]);
      setActiveTag(null);
      onCreated?.();
    } catch (err: any) {
      setError(err.message || "Не удалось создать пост");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="card p-4 md:p-4 space-y-3"
    >
      <div className="flex items-center justify-between text-sm text-white/70">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 rounded-full bg-white/10 items-center justify-center text-lg">🙂</span>
          <span className="font-semibold text-white">Поделиться чем-то новым</span>
        </div>
      </div>
      <div className="relative">
        <div className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3">
          <div className="pointer-events-none whitespace-pre-wrap break-words text-white font-medium relative z-0 min-h-[72px]">
            {content.trim().length === 0 ? (
              <span className="text-white/40">Что нового?</span>
            ) : (
              highlightInlineHashtags(content)
            )}
          </div>
        </div>
        <textarea
          className="w-full rounded-xl border-0 bg-transparent px-3 py-3 text-transparent caret-white placeholder:text-transparent focus:border-0 focus:ring-0 focus:outline-none transition absolute inset-0 z-10 resize-none overflow-hidden font-medium"
          rows={3}
          placeholder="Что нового?"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setCursor(e.target.selectionStart ?? e.target.value.length);
            autoResize();
          }}
          ref={textareaRef}
          onSelect={(e) =>
            setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)
          }
          onKeyUp={(e) =>
            setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)
          }
          onClick={(e) =>
            setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)
          }
          required
        />
        {suggestionsOpen &&
          createPortal(
            <div
              className="z-[999] overflow-hidden rounded-xl border border-white/10 bg-[#0f1116] shadow-xl"
              style={{
                position: "fixed",
                top: dropdownPos.top,
                left: dropdownPos.left,
                width: 260,
              }}
            >
              {suggestions.length > 0 ? (
                <ul className="max-h-52 overflow-y-auto divide-y divide-white/5">
                  {suggestions.map((tag) => (
                    <li key={tag.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-white hover:bg-white/5"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        replaceActiveHashtag(tag.name);
                      }}
                    >
                      <span className="text-white/60">#</span>
                      <span className="font-semibold text-sky-400">{tag.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
              ) : (
                <div className="px-3 py-2 text-sm text-white/60">
                  {suggestionsLoading ? "Поиск..." : "Совпадений не найдено"}
                </div>
              )}
            </div>,
            document.body
          )}
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <div className="flex items-center justify-between">
        <div className="flex gap-2 text-white/50">
          <button type="button" className="nav-icon bg-white/5 border border-white/10">
            <ImageIcon className="w-5 h-5" strokeWidth={1.7} />
          </button>
        </div>
        <button
          type="submit"
          disabled={loading || !content.trim()}
          className="rounded-full px-4 py-2 font-semibold text-black bg-white hover:bg-gray-200 disabled:opacity-60"
        >
          {loading ? "Публикуем..." : "Опубликовать"}
        </button>
      </div>
    </form>
  );
}
