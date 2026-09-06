import {
  MILLIS_PER_DAY,
  addDays,
  assertValidDate,
  diffInCalendarDays,
  isBefore,
  latest,
  parseIso,
  startOfUtcDay,
  toIso,
} from '../../src/domain/dates';

describe('assertValidDate', () => {
  it('accepts a real date', () => {
    expect(() => assertValidDate(new Date('2025-01-01T00:00:00Z'), 'when')).not.toThrow();
  });

  it.each([
    ['an invalid date', new Date('not-a-date')],
    ['a string', '2025-01-01' as unknown as Date],
    ['null', null as unknown as Date],
    ['undefined', undefined as unknown as Date],
  ])('rejects %s', (_label, value) => {
    expect(() => assertValidDate(value, 'when')).toThrow(TypeError);
    expect(() => assertValidDate(value, 'when')).toThrow(/when must be a valid Date/);
  });
});

describe('parseIso', () => {
  it('parses an ISO timestamp', () => {
    expect(parseIso('2025-03-01T10:30:00.000Z').toISOString()).toBe('2025-03-01T10:30:00.000Z');
  });

  it('throws on garbage, naming the field', () => {
    expect(() => parseIso('definitely-not-a-date', 'dueAt')).toThrow(/dueAt must be a valid Date/);
  });
});

describe('toIso', () => {
  it('round-trips through parseIso', () => {
    const original = '2025-06-30T23:59:59.000Z';
    expect(toIso(parseIso(original))).toBe(original);
  });

  it('rejects an invalid date', () => {
    expect(() => toIso(new Date(Number.NaN))).toThrow(TypeError);
  });
});

describe('addDays', () => {
  it('adds whole days', () => {
    expect(addDays(new Date('2025-01-01T00:00:00Z'), 14).toISOString()).toBe('2025-01-15T00:00:00.000Z');
  });

  it('preserves the time of day', () => {
    expect(addDays(new Date('2025-01-01T09:15:00Z'), 1).toISOString()).toBe('2025-01-02T09:15:00.000Z');
  });

  it('accepts negative days', () => {
    expect(addDays(new Date('2025-01-10T00:00:00Z'), -9).toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  it('handles zero as a no-op', () => {
    const start = new Date('2025-01-10T00:00:00Z');
    expect(addDays(start, 0).getTime()).toBe(start.getTime());
  });

  it('crosses a month boundary', () => {
    expect(addDays(new Date('2025-01-25T00:00:00Z'), 10).toISOString()).toBe('2025-02-04T00:00:00.000Z');
  });

  it('crosses a leap day', () => {
    expect(addDays(new Date('2024-02-28T00:00:00Z'), 1).toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });

  it('rejects a fractional number of days', () => {
    expect(() => addDays(new Date('2025-01-01T00:00:00Z'), 1.5)).toThrow(/days must be an integer/);
  });
});

describe('startOfUtcDay', () => {
  it('strips the time component', () => {
    expect(startOfUtcDay(new Date('2025-01-15T23:59:59.999Z')).toISOString()).toBe('2025-01-15T00:00:00.000Z');
  });

  it('is idempotent', () => {
    const midnight = startOfUtcDay(new Date('2025-01-15T13:00:00Z'));
    expect(startOfUtcDay(midnight).getTime()).toBe(midnight.getTime());
  });
});

describe('diffInCalendarDays', () => {
  it('counts whole days forward', () => {
    expect(diffInCalendarDays(new Date('2025-01-01T00:00:00Z'), new Date('2025-01-04T00:00:00Z'))).toBe(3);
  });

  it('ignores the time of day', () => {
    // 23:59 on the 1st to 00:01 on the 2nd is two minutes, but one calendar day.
    expect(diffInCalendarDays(new Date('2025-01-01T23:59:00Z'), new Date('2025-01-02T00:01:00Z'))).toBe(1);
  });

  it('returns 0 within the same day', () => {
    expect(diffInCalendarDays(new Date('2025-01-01T00:00:01Z'), new Date('2025-01-01T23:59:59Z'))).toBe(0);
  });

  it('returns a negative number when going backwards', () => {
    expect(diffInCalendarDays(new Date('2025-01-10T00:00:00Z'), new Date('2025-01-07T00:00:00Z'))).toBe(-3);
  });

  it('counts across a year boundary', () => {
    expect(diffInCalendarDays(new Date('2024-12-30T00:00:00Z'), new Date('2025-01-02T00:00:00Z'))).toBe(3);
  });
});

describe('isBefore / latest', () => {
  const earlier = new Date('2025-01-01T00:00:00Z');
  const later = new Date('2025-02-01T00:00:00Z');

  it('orders two instants', () => {
    expect(isBefore(earlier, later)).toBe(true);
    expect(isBefore(later, earlier)).toBe(false);
  });

  it('treats equal instants as not-before', () => {
    expect(isBefore(earlier, new Date(earlier))).toBe(false);
  });

  it('picks the later of two dates', () => {
    expect(latest(earlier, later)).toBe(later);
    expect(latest(later, earlier)).toBe(later);
  });
});

describe('MILLIS_PER_DAY', () => {
  it('is one day in milliseconds', () => {
    expect(MILLIS_PER_DAY).toBe(86_400_000);
  });
});
