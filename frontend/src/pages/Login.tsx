import { FormEvent, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { ErrorMessage } from "../components/ErrorMessage";
import { useI18n } from "../i18n";

export default function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.login(login, password);
      setToken(res.token);
      navigate("/");
    } catch (err: any) {
      setError(err.message || t("login.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md card p-6 md:p-8">
        <h1 className="text-2xl font-semibold mb-6 text-white text-center">{t("login.title")}</h1>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-sm text-white/70">{t("login.email_or_username")}</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-white focus:border-white/30 outline-none"
              type="text"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-sm text-white/70">{t("login.password")}</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-white focus:border-white/30 outline-none"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <ErrorMessage message={error} />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full px-4 py-2 font-semibold text-black bg-white hover:bg-gray-200 disabled:opacity-60"
          >
            {loading ? t("login.loading") : t("login.submit")}
          </button>
        </form>
        <p className="mt-4 text-sm text-white/60 text-center">
          {t("login.no_account")}{" "}
          <Link className="text-white underline" to="/register">
            {t("login.register")}
          </Link>
        </p>
      </div>
    </div>
  );
}
