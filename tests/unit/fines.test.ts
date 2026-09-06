import { calculateFine, calculateFineCents, countOverdueDays, formatCents, sumUnpaidFines } from '../../src/domain/fines';
import { FINE_GRACE_DAYS, FINE_MAX_CENTS, FINE_PER_DAY_CENTS } from '../../src/domain/policy';

const DUE = new Date('2025-01-15T12:00:00.000Z');

function daysAfterDue(days: number, time = '12:00:00.000Z'): Date {
  const d = new Date(DUE);
  d.setUTCDate(d.getUTCDate() + days);
  return new Date(`${d.toISOString().slice(0, 10)}T${time}`);
}

describe('countOverdueDays', () => {
  it('is 0 when returned on the due date', () => {
    expect(countOverdueDays(DUE, daysAfterDue(0))).toBe(0);
  });

  it('is 0 when returned early', () => {
    expect(countOverdueDays(DUE, daysAfterDue(-5))).toBe(0);
  });

  it('counts calendar days, not 24h blocks', () => {
    // 23:59 on the due date to 00:01 the next morning is one calendar day late.
    expect(countOverdueDays(new Date('2025-01-15T23:59:00Z'), new Date('2025-01-16T00:01:00Z'))).toBe(1);
  });

  it('counts a long overdue period', () => {
    expect(countOverdueDays(DUE, daysAfterDue(45))).toBe(45);
  });

  it('rejects invalid dates', () => {
    expect(() => countOverdueDays(new Date('nope'), DUE)).toThrow(/dueAt must be a valid Date/);
    expect(() => countOverdueDays(DUE, new Date('nope'))).toThrow(/returnedAt must be a valid Date/);
  });
});

describe('calculateFine', () => {
  it('charges nothing for an on-time return', () => {
    expect(calculateFine(DUE, daysAfterDue(0))).toEqual({
      daysLate: 0,
      billableDays: 0,
      amountCents: 0,
      capped: false,
    });
  });

  it('charges nothing inside the grace period', () => {
    const result = calculateFine(DUE, daysAfterDue(FINE_GRACE_DAYS));
    expect(result.daysLate).toBe(FINE_GRACE_DAYS);
    expect(result.amountCents).toBe(0);
  });

  it('charges from the first day after the grace period', () => {
    const result = calculateFine(DUE, daysAfterDue(FINE_GRACE_DAYS + 1));
    expect(result.billableDays).toBe(1);
    expect(result.amountCents).toBe(FINE_PER_DAY_CENTS);
  });

  it('scales linearly with the number of billable days', () => {
    const result = calculateFine(DUE, daysAfterDue(11));
    expect(result.billableDays).toBe(10);
    expect(result.amountCents).toBe(10 * FINE_PER_DAY_CENTS);
    expect(result.capped).toBe(false);
  });

  it('stops exactly at the cap', () => {
    const daysToReachCap = FINE_MAX_CENTS / FINE_PER_DAY_CENTS + FINE_GRACE_DAYS;
    const result = calculateFine(DUE, daysAfterDue(daysToReachCap));
    expect(result.amountCents).toBe(FINE_MAX_CENTS);
    expect(result.capped).toBe(false);
  });

  it('flags the fine as capped once it would exceed the maximum', () => {
    const daysPastCap = FINE_MAX_CENTS / FINE_PER_DAY_CENTS + FINE_GRACE_DAYS + 1;
    const result = calculateFine(DUE, daysAfterDue(daysPastCap));
    expect(result.amountCents).toBe(FINE_MAX_CENTS);
    expect(result.capped).toBe(true);
  });

  it('never returns a negative amount for an early return', () => {
    expect(calculateFine(DUE, daysAfterDue(-30)).amountCents).toBe(0);
  });
});

describe('calculateFineCents', () => {
  it('is the amount from calculateFine', () => {
    expect(calculateFineCents(DUE, daysAfterDue(4))).toBe(calculateFine(DUE, daysAfterDue(4)).amountCents);
  });
});

describe('formatCents', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [50, '0.50'],
    [500, '5.00'],
    [45_000, '450.00'],
    [45_007, '450.07'],
  ])('formats %i as %s', (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });

  it('keeps the sign on a negative balance', () => {
    expect(formatCents(-250)).toBe('-2.50');
  });

  it('rejects a fractional amount', () => {
    expect(() => formatCents(12.5)).toThrow(/amountCents must be an integer/);
  });
});

describe('sumUnpaidFines', () => {
  it('is 0 for an empty list', () => {
    expect(sumUnpaidFines([])).toBe(0);
  });

  it('ignores paid and waived fines', () => {
    const fines = [
      { amountCents: 500, status: 'UNPAID' },
      { amountCents: 1_000, status: 'PAID' },
      { amountCents: 2_000, status: 'WAIVED' },
      { amountCents: 250, status: 'UNPAID' },
    ];
    expect(sumUnpaidFines(fines)).toBe(750);
  });
});
