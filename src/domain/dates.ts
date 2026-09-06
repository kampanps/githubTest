export const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

export function assertValidDate(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${label} must be a valid Date`);
  }
}

/** Parse an ISO string into a Date, throwing on anything unparseable. */
export function parseIso(value: string, label = 'date'): Date {
  const parsed = new Date(value);
  assertValidDate(parsed, label);
  return parsed;
}

export function toIso(date: Date): string {
  assertValidDate(date, 'date');
  return date.toISOString();
}

export function addDays(date: Date, days: number): Date {
  assertValidDate(date, 'date');
  if (!Number.isInteger(days)) {
    throw new TypeError('days must be an integer');
  }
  return new Date(date.getTime() + days * MILLIS_PER_DAY);
}

/** Midnight UTC of the given instant - lets us compare calendar days, not clock times. */
export function startOfUtcDay(date: Date): Date {
  assertValidDate(date, 'date');
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Whole calendar days between two instants (UTC).
 * Returns a negative number when `to` is before `from`.
 */
export function diffInCalendarDays(from: Date, to: Date): number {
  const fromDay = startOfUtcDay(from).getTime();
  const toDay = startOfUtcDay(to).getTime();
  return Math.round((toDay - fromDay) / MILLIS_PER_DAY);
}

export function isBefore(a: Date, b: Date): boolean {
  assertValidDate(a, 'a');
  assertValidDate(b, 'b');
  return a.getTime() < b.getTime();
}

export function latest(a: Date, b: Date): Date {
  return isBefore(a, b) ? b : a;
}
