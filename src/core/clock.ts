/** Injectable time. Tests freeze it; the Inn runs on the real one. */
export type Clock = {
  now(): Date;
  iso(): string;
  /** Local calendar day, 'YYYY-MM-DD'. The boundary the daily spend cap resets on. */
  day(): string;
};

const localDay = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const systemClock: Clock = {
  now: () => new Date(),
  iso: () => new Date().toISOString(),
  day: () => localDay(new Date()),
};

/** A clock you can shove forward by hand. Used by every test that touches money. */
export const fixedClock = (start: string | Date): Clock & { advance(ms: number): void; set(d: string | Date): void } => {
  let t = new Date(start);
  return {
    now: () => new Date(t),
    iso: () => t.toISOString(),
    day: () => localDay(t),
    advance(ms: number) { t = new Date(t.getTime() + ms); },
    set(d: string | Date) { t = new Date(d); },
  };
};
