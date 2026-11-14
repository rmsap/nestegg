const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]] as const;
const invalid = () => new Error("Invalid schedule");

function number(text: string, min: number, max: number) {
  if (!/^\d{1,2}$/.test(text)) throw invalid();
  const value = Number(text);
  if (value < min || value > max) throw invalid();
  return value;
}

function field(text: string, [min, max]: readonly [number, number]) {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const [range, step, ...extra] = part.split("/");
    if (extra.length || (step !== undefined && !/^\d{1,3}$/.test(step))) throw invalid();
    const by = step === undefined ? 1 : Number(step);
    if (by < 1) throw invalid();
    let from: number, to: number;
    if (range === "*") [from, to] = [min, max];
    else if (range.includes("-")) {
      const [a, b, ...more] = range.split("-");
      if (more.length) throw invalid();
      from = number(a, min, max);
      to = number(b, min, max);
      if (from > to) throw invalid();
    } else {
      if (step !== undefined) throw invalid();
      from = to = number(range, min, max);
    }
    for (let value = from; value <= to; value += by) values.add(value);
  }
  return values;
}

function parse(expression: string) {
  if (typeof expression !== "string") throw invalid();
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw invalid();
  const [minute, hour, dom, month, dow] = parts.map((part, i) => field(part, RANGES[i]));
  if (dow.has(7)) dow.add(0);
  return { minute: [...minute].sort((a, b) => a - b), hour: [...hour].sort((a, b) => a - b), dom, month, dow,
    domAny: parts[2].startsWith("*"), dowAny: parts[4].startsWith("*") };
}

export function nextRun(expression: string, after: Date): Date {
  const cron = parse(expression);
  const start = new Date(after.getTime());
  start.setSeconds(0, 0);
  for (let offset = 0; offset <= 5 * 366 + 1; offset++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    const dom = cron.dom.has(day.getDate()), dow = cron.dow.has(day.getDay());
    const today = cron.domAny || cron.dowAny ? dom && dow : dom || dow;
    if (!cron.month.has(day.getMonth() + 1) || !today) continue;
    for (const hour of cron.hour) {
      for (const minute of cron.minute) {
        const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
        if (candidate.getHours() === hour && candidate.getMinutes() === minute && candidate.getTime() > after.getTime()) return candidate;
      }
    }
  }
  throw invalid();
}

export function validSchedule(expression: string) {
  try {
    parse(expression);
    return true;
  } catch {
    return false;
  }
}
