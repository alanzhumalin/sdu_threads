import { FormEvent, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";

export default function LoginPage() {
  const navigate = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.login(email, password);
      setToken(res.token);
      navigate("/");
    } catch (err: any) {
      setError(err.message || "Ошибка входа");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md card p-6 md:p-8">
        <h1 className="text-2xl font-semibold mb-6 text-white text-center">Вход</h1>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-sm text-white/70">Email</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-white focus:border-white/30 outline-none"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-sm text-white/70">Пароль</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-white focus:border-white/30 outline-none"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full px-4 py-2 font-semibold text-black bg-white hover:bg-gray-200 disabled:opacity-60"
          >
            {loading ? "Входим..." : "Войти"}
          </button>
        </form>
        <p className="mt-4 text-sm text-white/60 text-center">
          Нет аккаунта?{" "}
          <Link className="text-white underline" to="/register">
            Регистрация
          </Link>
        </p>
      </div>
    </div>
  );
}
