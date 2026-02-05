import { FormEvent, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { ErrorMessage } from "../components/ErrorMessage";
import { X } from "lucide-react";

export default function RegisterPage() {
  const navigate = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);
  const [form, setForm] = useState({
    email: "",
    username: "",
    full_name: "",
    password: "",
  });
  const [acceptedRules, setAcceptedRules] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!acceptedRules) {
      setError("Нужно принять правила использования сайта");
      return;
    }
    setLoading(true);
    try {
      const normalizedUsername = form.username.toLowerCase().replace(/\s+/g, "_");
      const res = await api.register({
        ...form,
        username: normalizedUsername,
        accepted_rules: acceptedRules,
      });
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
          <div className="flex items-start gap-2 pt-1">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border border-white/30 bg-black/40 text-white accent-white"
              checked={acceptedRules}
              onChange={(e) => setAcceptedRules(e.target.checked)}
            />
            <p className="text-sm text-white/70 leading-snug">
              Я принимаю{" "}
              <button
                type="button"
                className="text-white underline underline-offset-2 hover:text-white/90"
                onClick={() => setRulesOpen(true)}
              >
                правила использования сайта
              </button>
            </p>
          </div>
          <ErrorMessage message={error} />
          <button
            type="submit"
            disabled={loading || !acceptedRules}
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

      {rulesOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-md"
            onClick={() => setRulesOpen(false)}
          >
            <div className="min-h-screen w-full flex items-center justify-center px-4 py-8">
              <div
                className="bg-[#0b0b0f] border border-white/10 rounded-2xl w-full max-w-lg p-7 shadow-2xl relative"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="absolute top-3 right-3 text-white/60 hover:text-white"
                  onClick={() => setRulesOpen(false)}
                  aria-label="Закрыть"
                >
                  <X className="w-5 h-5" />
                </button>
                <h3 className="text-lg font-semibold text-white">Правила использования</h3>
                <div className="mt-4 text-sm text-white/70 space-y-3 max-h-[70vh] overflow-auto pr-1">
                  <p>
                    Чтобы всем было комфортно, пожалуйста, соблюдайте базовые правила сообщества:
                  </p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li>Запрещена нецензурная лексика и агрессивные высказывания.</li>
                    <li>Запрещён 18+ контент, шок-контент и пропаганда насилия.</li>
                    <li>Запрещены оскорбления, травля, дискриминация и угрозы.</li>
                    <li>Запрещён спам, накрутки, массовая реклама и мошенничество.</li>
                    <li>Не публикуйте чужие персональные данные без согласия.</li>
                    <li>Администрация может модерировать и удалять контент при нарушениях.</li>
                  </ul>
                  <p className="text-white/60 font-medium">Юридические оговорки</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li>
                      Пользователь самостоятельно несёт полную ответственность за любой публикуемый им контент (тексты,
                      изображения, рисунки, комментарии, упоминания и т.д.).
                    </li>
                    <li>Администрация и создатели веб-сайта не несут ответственности за содержание, публикуемое пользователями.</li>
                    <li>Администрация не гарантирует достоверность, точность или законность пользовательского контента.</li>
                    <li>Весь контент публикуется пользователями на их собственный риск.</li>
                    <li>
                      В случае нарушений законодательства ответственность несёт исключительно пользователь, разместивший
                      соответствующий контент.
                    </li>
                    <li>
                      Администрация имеет право удалять контент без объяснения причин, блокировать или ограничивать
                      аккаунты, а также передавать информацию компетентным органам в случаях, предусмотренных законом.
                    </li>
                    <li>Использование сайта означает согласие пользователя со всеми правилами и условиями.</li>
                  </ul>
                  <p className="text-white/50 text-xs">
                    Нажимая “Создать аккаунт”, вы подтверждаете согласие с этими правилами.
                  </p>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
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
