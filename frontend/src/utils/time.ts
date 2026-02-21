import type { AppLanguage } from "../i18n";

const ruPlural = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};

export function formatTimeAgo(iso: string, language: AppLanguage): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const sec = Math.floor(diffMs / 1000);
  const min = Math.floor(sec / 60);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);

  if (language === "en") {
    if (sec < 45) return "just now";
    if (min < 60) return `${min} min ago`;
    if (hour < 24) return `${hour} h ago`;
    if (day === 1) return "yesterday";
    if (day < 7) return `${day} d ago`;
    return date.toLocaleString("en-US");
  }

  if (language === "kk") {
    if (sec < 45) return "дәл қазір";
    if (min < 60) return `${min} мин бұрын`;
    if (hour < 24) return `${hour} сағ бұрын`;
    if (day === 1) return "кеше";
    if (day < 7) return `${day} күн бұрын`;
    return date.toLocaleString("kk-KZ");
  }

  if (sec < 45) return "только что";
  if (min < 60) return `${min} ${ruPlural(min, "минуту назад", "минуты назад", "мин назад")}`;
  if (hour < 24) return `${hour} ${ruPlural(hour, "час назад", "часа назад", "ч назад")}`;
  if (day === 1) return "вчера";
  if (day < 7) return `${day} ${ruPlural(day, "день назад", "дня назад", "дн назад")}`;
  return date.toLocaleString("ru-RU");
}
