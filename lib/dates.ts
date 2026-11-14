const formatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

const dayFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export function ago(value: string, now = new Date()) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return value;
  const minutes = Math.floor((now.getTime() - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return dayFormatter.format(time);
}

export function intervalWords(minutes: number) {
  const [size, unit] = minutes % 1440 === 0 ? [minutes / 1440, "day"] : minutes % 60 === 0 ? [minutes / 60, "hour"] : [minutes, "minute"];
  return `${size} ${unit}${size === 1 ? "" : "s"}`;
}

export function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatter.format(date);
}
