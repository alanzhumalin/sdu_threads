import { FormEvent, useState } from "react";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { Image as ImageIcon, Hash } from "lucide-react";

type Props = {
  onCreated?: () => void;
};

export default function PostComposer({ onCreated }: Props) {
  const token = useAuthStore((s) => s.token);
  const [content, setContent] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const tags = hashtags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await api.createPost({ content, hashtags: tags }, token);
      setContent("");
      setHashtags("");
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
        <span className="text-white/40">до 500 символов</span>
      </div>
      <textarea
        className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-white placeholder:text-white/40 focus:border-white/30 outline-none transition"
        rows={3}
        placeholder="Что нового?"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={500}
        required
      />
      <input
        className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white text-sm placeholder:text-white/40 focus:border-white/30 outline-none transition"
        placeholder="Хэштеги через запятую (например: sdu, exams)"
        value={hashtags}
        onChange={(e) => setHashtags(e.target.value)}
      />
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <div className="flex items-center justify-between">
        <div className="flex gap-2 text-white/50">
          <button type="button" className="nav-icon bg-white/5 border border-white/10">
            <ImageIcon className="w-5 h-5" strokeWidth={1.7} />
          </button>
          <button type="button" className="nav-icon bg-white/5 border border-white/10">
            <Hash className="w-5 h-5" strokeWidth={1.7} />
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
