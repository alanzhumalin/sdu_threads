import { FormEvent, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { ErrorMessage } from "../components/ErrorMessage";
import { X } from "lucide-react";
import { useI18n } from "../i18n";

export default function RegisterPage() {
  const { t, pick } = useI18n();
  const tr = (kk: string, ru: string, en: string) => pick({ kk, ru, en });
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
      setError(t("register.accept_required"));
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
      setError(err.message || t("register.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md card p-6 md:p-8">
        <h1 className="text-2xl font-semibold mb-6 text-white text-center">{t("register.title")}</h1>
        <form onSubmit={submit} className="space-y-4">
          <Field
            label={t("register.email")}
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Field
            label={t("register.username")}
            value={form.username}
            onChange={(e) => {
              const v = e.target.value.toLowerCase().replace(/\s+/g, "_");
              setForm({ ...form, username: v });
            }}
          />
          <Field
            label={t("register.full_name")}
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
          <Field
            label={t("register.password")}
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
              {t("register.accept_prefix")}{" "}
              <button
                type="button"
                className="text-white underline underline-offset-2 hover:text-white/90"
                onClick={() => setRulesOpen(true)}
              >
                {t("register.rules_link")}
              </button>
            </p>
          </div>
          <ErrorMessage message={error} />
          <button
            type="submit"
            disabled={loading || !acceptedRules}
            className="w-full rounded-full px-4 py-2 font-semibold text-black bg-white hover:bg-gray-200 disabled:opacity-60"
          >
            {loading ? t("register.loading") : t("register.submit")}
          </button>
        </form>
        <p className="mt-4 text-sm text-white/60 text-center">
          {t("register.have_account")}{" "}
          <Link className="text-white underline" to="/login">
            {t("register.login")}
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
                  aria-label={t("register.close")}
                >
                  <X className="w-5 h-5" />
                </button>
                <h3 className="text-lg font-semibold text-white">{t("register.rules_title")}</h3>
                <div className="mt-4 text-sm text-white/70 space-y-3 max-h-[70vh] overflow-auto pr-1">
                  <p>
                    {tr(
                      "Барлығы үшін жайлы болуы үшін, қауымдастықтың негізгі ережелерін сақтаңыз:",
                      "Чтобы всем было комфортно, пожалуйста, соблюдайте базовые правила сообщества:",
                      "To keep everyone comfortable, please follow the basic community rules:"
                    )}
                  </p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li>{tr("Бейпіл сөздер мен агрессивті сөйлеуге тыйым салынады.", "Запрещена нецензурная лексика и агрессивные высказывания.", "Profanity and aggressive language are prohibited.")}</li>
                    <li>{tr("18+ контент, шок-контент және зорлықты насихаттауға тыйым салынады.", "Запрещён 18+ контент, шок-контент и пропаганда насилия.", "18+ content, shock content, and violence promotion are prohibited.")}</li>
                    <li>{tr("Қорлау, буллинг, дискриминация және қоқан-лоқыға тыйым салынады.", "Запрещены оскорбления, травля, дискриминация и угрозы.", "Insults, harassment, discrimination, and threats are prohibited.")}</li>
                    <li>{tr("Спам, накрутка, жаппай жарнама және алаяқтыққа тыйым салынады.", "Запрещён спам, накрутки, массовая реклама и мошенничество.", "Spam, fake engagement, mass advertising, and fraud are prohibited.")}</li>
                    <li>{tr("Басқалардың жеке деректерін рұқсатсыз жарияламаңыз.", "Не публикуйте чужие персональные данные без согласия.", "Do not publish other people's personal data without consent.")}</li>
                    <li>{tr("Әкімшілік бұзушылық кезінде контентті модерациялап, өшіре алады.", "Администрация может модерировать и удалять контент при нарушениях.", "Administration may moderate and remove content in case of violations.")}</li>
                  </ul>
                  <p className="text-white/60 font-medium">{tr("Құқықтық ескертпелер", "Юридические оговорки", "Legal notices")}</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li>
                      {tr(
                        "Пайдаланушы жариялайтын кез келген контент үшін (мәтін, сурет, комментарий, белгілеу және т.б.) толық жауапкершілікті өзі көтереді.",
                        "Пользователь самостоятельно несёт полную ответственность за любой публикуемый им контент (тексты, изображения, рисунки, комментарии, упоминания и т.д.).",
                        "The user bears full responsibility for any content they publish (texts, images, drawings, comments, mentions, etc.)."
                      )}
                    </li>
                    <li>{tr("Әкімшілік пен сайт жасаушылары пайдаланушы жариялаған контент үшін жауап бермейді.", "Администрация и создатели веб-сайта не несут ответственности за содержание, публикуемое пользователями.", "Administration and site creators are not responsible for user-published content.")}</li>
                    <li>{tr("Әкімшілік пайдаланушы контентінің дұрыстығына, нақтылығына немесе заңдылығына кепіл бермейді.", "Администрация не гарантирует достоверность, точность или законность пользовательского контента.", "Administration does not guarantee the accuracy, precision, or legality of user content.")}</li>
                    <li>{tr("Барлық контент пайдаланушының өз тәуекелімен жарияланады.", "Весь контент публикуется пользователями на их собственный риск.", "All content is published at the user's own risk.")}</li>
                    <li>
                      {tr(
                        "Заң бұзылған жағдайда жауапкершілік тек сәйкес контентті жариялаған пайдаланушыға жүктеледі.",
                        "В случае нарушений законодательства ответственность несёт исключительно пользователь, разместивший соответствующий контент.",
                        "In case of legal violations, responsibility lies solely with the user who posted the corresponding content."
                      )}
                    </li>
                    <li>
                      {tr(
                        "Әкімшілік контентті түсіндірмесіз өшіруге, аккаунттарды шектеуге/блоктауға және заңда көзделген жағдайда ақпаратты құзырлы органдарға беруге құқылы.",
                        "Администрация имеет право удалять контент без объяснения причин, блокировать или ограничивать аккаунты, а также передавать информацию компетентным органам в случаях, предусмотренных законом.",
                        "Administration may remove content without explanation, block or restrict accounts, and provide information to competent authorities when required by law."
                      )}
                    </li>
                    <li>{tr("Сайтты пайдалану — барлық ереже мен шарттарға келісім білдіру дегенді білдіреді.", "Использование сайта означает согласие пользователя со всеми правилами и условиями.", "Using the site means the user agrees to all rules and terms.")}</li>
                  </ul>
                  <p className="text-white/50 text-xs">
                    {tr(
                      "“Аккаунт жасау” батырмасын баса отырып, осы ережелермен келісетініңізді растайсыз.",
                      "Нажимая “Создать аккаунт”, вы подтверждаете согласие с этими правилами.",
                      "By clicking “Create account”, you confirm your agreement with these rules."
                    )}
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
