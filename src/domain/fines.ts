import { assertValidDate, diffInCalendarDays } from './dates';
import { FINE_GRACE_DAYS, FINE_MAX_CENTS, FINE_PER_DAY_CENTS } from './policy';

export interface FineBreakdown {
  daysLate: number;
  billableDays: number;
  amountCents: number;
  capped: boolean;
}

/**
 * Whole calendar days a loan is late. Never negative - an early return is 0.
 */
export function countOverdueDays(dueAt: Date, returnedAt: Date): number {
  assertValidDate(dueAt, 'dueAt');
  assertValidDate(returnedAt, 'returnedAt');
  return Math.max(0, diffInCalendarDays(dueAt, returnedAt));
}

/**
 * Fine for a single loan, in cents.
 *
 *   - the first FINE_GRACE_DAYS days late are free
 *   - each remaining day costs FINE_PER_DAY_CENTS
 *   - the total is capped at FINE_MAX_CENTS
 */
export function calculateFine(dueAt: Date, returnedAt: Date): FineBreakdown {
  const daysLate = countOverdueDays(dueAt, returnedAt);
  const billableDays = Math.max(0, daysLate - FINE_GRACE_DAYS);
  const rawAmount = billableDays * FINE_PER_DAY_CENTS;
  const amountCents = Math.min(rawAmount, FINE_MAX_CENTS);

  return {
    daysLate,
    billableDays,
    amountCents,
    capped: rawAmount > FINE_MAX_CENTS,
  };
}

export function calculateFineCents(dueAt: Date, returnedAt: Date): number {
  return calculateFine(dueAt, returnedAt).amountCents;
}

/** 45000 -> "450.00" - display only, all arithmetic stays in integer cents. */
export function formatCents(amountCents: number): string {
  if (!Number.isInteger(amountCents)) {
    throw new TypeError('amountCents must be an integer');
  }
  const sign = amountCents < 0 ? '-' : '';
  const absolute = Math.abs(amountCents);
  const major = Math.floor(absolute / 100);
  const minor = String(absolute % 100).padStart(2, '0');
  return `${sign}${major}.${minor}`;
}

export function sumUnpaidFines(fines: ReadonlyArray<{ amountCents: number; status: string }>): number {
  return fines
    .filter((fine) => fine.status === 'UNPAID')
    .reduce((total, fine) => total + fine.amountCents, 0);
}
