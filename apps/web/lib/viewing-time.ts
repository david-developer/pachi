export const DEFAULT_VIEWING_TIMEZONE = 'Africa/Douala';

function clockParts(instant: number, formatter: Intl.DateTimeFormat): number[] {
  const parts = formatter.formatToParts(new Date(instant));
  return ['year', 'month', 'day', 'hour', 'minute'].map(
    (key) => Number(parts.find((part) => part.type === key)?.value)
  );
}

/** Resolve a wall-clock entry in its submitted IANA zone without the browser's zone. */
export function viewingTimeToUtc(local: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) throw new Error('Enter a valid date and time.');
  const values = match.slice(1).map(Number);
  const [year, month, day, hour, minute] = values as [number, number, number, number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(wall);
  if (year < 100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute)
    throw new Error('Enter a valid date and time.');
  let formatter: Intl.DateTimeFormat;
  try {
    if (timezone !== 'UTC' && !/^[A-Za-z_]+\/[A-Za-z0-9_+\-/]+$/.test(timezone)) throw new Error();
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
  } catch { throw new Error('Enter a valid IANA timezone, such as Africa/Douala.'); }
  // Offset samples on either side of a transition detect skipped or repeated times.
  const candidates = new Set<number>();
  for (const shift of [-48, -24, 0, 24, 48]) {
    const sample = wall + shift * 3_600_000;
    const parts = clockParts(sample, formatter) as [number, number, number, number, number];
    const offset = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]) - sample;
    const candidate = wall - offset;
    if (clockParts(candidate, formatter).every((part, index) => part === values[index])) candidates.add(candidate);
  }
  if (candidates.size !== 1)
    throw new Error('This local time is skipped or repeated by a timezone change. Choose a different time.');
  return new Date([...candidates][0]!).toISOString();
}

export function viewingTimeLabel(utc: string, timezone: string): string {
  return `${new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date(utc))} (${timezone})`;
}
