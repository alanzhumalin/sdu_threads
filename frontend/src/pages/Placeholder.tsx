export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-8 text-center space-y-2 max-w-md w-full">
        <p className="text-xl text-white font-semibold">{title}</p>
        <p className="text-sm text-white/60">Скоро здесь будет контент.</p>
      </div>
    </div>
  );
}
