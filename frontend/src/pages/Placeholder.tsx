import { useI18n } from "../i18n";

export default function Placeholder({ title }: { title: string }) {
  const { pick } = useI18n();
  const tr = (kk: string, ru: string, en: string) => pick({ kk, ru, en });

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-8 text-center space-y-2 max-w-md w-full">
        <p className="text-xl text-white font-semibold">{title}</p>
        <p className="text-sm text-white/60">{tr("Жақында мұнда контент болады.", "Скоро здесь будет контент.", "Content will appear here soon.")}</p>
      </div>
    </div>
  );
}
