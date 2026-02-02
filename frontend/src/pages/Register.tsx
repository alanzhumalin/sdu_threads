import { FormEvent, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";

export default function RegisterPage() {
  const navigate = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);
  const [form, setForm] = useState({
    email: "",
    username: "",
    full_name: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const normalizedUsername = form.username.toLowerCase().replace(/\s+/g, "_");
      const res = await api.register({ ...form, username: normalizedUsername });
      setToken(res.token);
      navigate("/");
    } catch (err: any) {
      setError(err.message || "Ошибка регистрации");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md card p-6 md:p-8">
        <h1 className="text-2xl font-semibold mb-6 text-white text-center">Регистрация</h1>
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="Email (sdu.edu.kz)"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Field
            label="Username"
            value={form.username}
            onChange={(e) => {
              const v = e.target.value.toLowerCase().replace(/\s+/g, "_");
              setForm({ ...form, username: v });
            }}
          />
          <Field
            label="Имя"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
          <Field
            label="Пароль"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full px-4 py-2 font-semibold text-black bg-white hover:bg-gray-200 disabled:opacity-60"
          >
            {loading ? "Регистрируем..." : "Создать аккаунт"}
          </button>
        </form>
        <p className="mt-4 text-sm text-white/60 text-center">
          Уже есть аккаунт?{" "}
          <Link className="text-white underline" to="/login">
            Войти
          </Link>
        </p>
      </div>
    </div>
  );
}

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

function Field({ label, ...props }: FieldProps) {
  return (
    <div>
      <label className="text-sm text-white/70">{label}</label>
      <input
        className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-white focus:border-white/30 outline-none"
        {...props}
      />
    </div>
  );
}
