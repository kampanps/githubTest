import {
  calculateDueDate,
  calculateRenewedDueDate,
  evaluateBorrow,
  evaluateRenewal,
  isOverdue,
  type BorrowContext,
  type RenewalContext,
} from '../../src/domain/loanRules';
import { BORROW_BLOCK_FINE_THRESHOLD_CENTS, TIER_POLICIES } from '../../src/domain/policy';

const NOW = new Date('2025-01-15T09:00:00.000Z');
const FUTURE = '2026-01-15T09:00:00.000Z';
const PAST = '2024-01-15T09:00:00.000Z';

function borrowContext(overrides: Partial<BorrowContext> = {}): BorrowContext {
  return {
    member: { tier: 'STANDARD', status: 'ACTIVE', membershipExpiresAt: FUTURE },
    book: { availableCopies: 2 },
    activeLoanCount: 0,
    unpaidFineCents: 0,
    alreadyHasCopy: false,
    heldForAnotherMember: false,
    now: NOW,
    ...overrides,
  };
}

function renewalContext(overrides: Partial<RenewalContext> = {}): RenewalContext {
  return {
    loan: { status: 'ACTIVE', renewalCount: 0, dueAt: FUTURE },
    member: { tier: 'STANDARD', status: 'ACTIVE' },
    hasPendingReservations: false,
    unpaidFineCents: 0,
    now: NOW,
    ...overrides,
  };
}

describe('evaluateBorrow', () => {
  it('allows a member in good standing', () => {
    expect(evaluateBorrow(borrowContext())).toEqual({ allowed: true });
  });

  it('blocks a suspended member', () => {
    const decision = evaluateBorrow(
      borrowContext({ member: { tier: 'STANDARD', status: 'SUSPENDED', membershipExpiresAt: FUTURE } }),
    );
    expect(decision).toMatchObject({ allowed: false, code: 'MEMBER_SUSPENDED' });
  });

  it('blocks an expired membership', () => {
    const decision = evaluateBorrow(
      borrowContext({ member: { tier: 'STANDARD', status: 'ACTIVE', membershipExpiresAt: PAST } }),
    );
    expect(decision).toMatchObject({ allowed: false, code: 'MEMBERSHIP_EXPIRED' });
  });

  it('allows a membership that expires later today', () => {
    const decision = evaluateBorrow(
      borrowContext({
        member: { tier: 'STANDARD', status: 'ACTIVE', membershipExpiresAt: '2025-01-15T23:59:00.000Z' },
      }),
    );
    expect(decision.allowed).toBe(true);
  });

  it('blocks a member at or above the fine threshold', () => {
    const decision = evaluateBorrow(borrowContext({ unpaidFineCents: BORROW_BLOCK_FINE_THRESHOLD_CENTS }));
    expect(decision).toMatchObject({ allowed: false, code: 'OUTSTANDING_FINES' });
  });

  it('allows a member one cent below the fine threshold', () => {
    const decision = evaluateBorrow(borrowContext({ unpaidFineCents: BORROW_BLOCK_FINE_THRESHOLD_CENTS - 1 }));
    expect(decision.allowed).toBe(true);
  });

  it.each([
    ['STANDARD' as const, TIER_POLICIES.STANDARD.maxActiveLoans],
    ['PREMIUM' as const, TIER_POLICIES.PREMIUM.maxActiveLoans],
    ['STAFF' as const, TIER_POLICIES.STAFF.maxActiveLoans],
  ])('blocks a %s member at their limit of %i loans', (tier, max) => {
    const atLimit = evaluateBorrow(
      borrowContext({
        member: { tier, status: 'ACTIVE', membershipExpiresAt: FUTURE },
        activeLoanCount: max,
      }),
    );
    expect(atLimit).toMatchObject({ allowed: false, code: 'LOAN_LIMIT_REACHED' });

    const belowLimit = evaluateBorrow(
      borrowContext({
        member: { tier, status: 'ACTIVE', membershipExpiresAt: FUTURE },
        activeLoanCount: max - 1,
      }),
    );
    expect(belowLimit.allowed).toBe(true);
  });

  it('blocks borrowing a second copy of the same title', () => {
    expect(evaluateBorrow(borrowContext({ alreadyHasCopy: true }))).toMatchObject({
      allowed: false,
      code: 'DUPLICATE_LOAN',
    });
  });

  it('blocks when no copies are on the shelf', () => {
    expect(evaluateBorrow(borrowContext({ book: { availableCopies: 0 } }))).toMatchObject({
      allowed: false,
      code: 'NO_COPIES_AVAILABLE',
    });
  });

  it('blocks when the last copy is held for someone else', () => {
    expect(
      evaluateBorrow(borrowContext({ book: { availableCopies: 1 }, heldForAnotherMember: true })),
    ).toMatchObject({ allowed: false, code: 'RESERVED_BY_ANOTHER_MEMBER' });
  });

  it('reports the most blocking reason first when several apply', () => {
    const decision = evaluateBorrow(
      borrowContext({
        member: { tier: 'STANDARD', status: 'SUSPENDED', membershipExpiresAt: PAST },
        book: { availableCopies: 0 },
        unpaidFineCents: 100_000,
        activeLoanCount: 99,
      }),
    );
    expect(decision).toMatchObject({ allowed: false, code: 'MEMBER_SUSPENDED' });
  });

  it('carries a human-readable message on every rejection', () => {
    const decision = evaluateBorrow(borrowContext({ book: { availableCopies: 0 } }));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.message.length).toBeGreaterThan(10);
    }
  });
});

describe('evaluateRenewal', () => {
  it('allows a healthy renewal', () => {
    expect(evaluateRenewal(renewalContext())).toEqual({ allowed: true });
  });

  it('blocks a returned loan', () => {
    expect(
      evaluateRenewal(renewalContext({ loan: { status: 'RETURNED', renewalCount: 0, dueAt: FUTURE } })),
    ).toMatchObject({ allowed: false, code: 'LOAN_ALREADY_RETURNED' });
  });

  it('blocks a suspended member', () => {
    expect(evaluateRenewal(renewalContext({ member: { tier: 'STANDARD', status: 'SUSPENDED' } }))).toMatchObject({
      allowed: false,
      code: 'MEMBER_SUSPENDED',
    });
  });

  it('blocks an overdue loan', () => {
    expect(
      evaluateRenewal(renewalContext({ loan: { status: 'ACTIVE', renewalCount: 0, dueAt: PAST } })),
    ).toMatchObject({ allowed: false, code: 'LOAN_OVERDUE' });
  });

  it('blocks once the renewal limit is reached', () => {
    const max = TIER_POLICIES.STANDARD.maxRenewals;
    expect(
      evaluateRenewal(renewalContext({ loan: { status: 'ACTIVE', renewalCount: max, dueAt: FUTURE } })),
    ).toMatchObject({ allowed: false, code: 'RENEWAL_LIMIT_REACHED' });

    expect(
      evaluateRenewal(renewalContext({ loan: { status: 'ACTIVE', renewalCount: max - 1, dueAt: FUTURE } })).allowed,
    ).toBe(true);
  });

  it('lets a PREMIUM member renew past the STANDARD limit', () => {
    const decision = evaluateRenewal(
      renewalContext({
        member: { tier: 'PREMIUM', status: 'ACTIVE' },
        loan: { status: 'ACTIVE', renewalCount: TIER_POLICIES.STANDARD.maxRenewals, dueAt: FUTURE },
      }),
    );
    expect(decision.allowed).toBe(true);
  });

  it('blocks a member with outstanding fines', () => {
    expect(
      evaluateRenewal(renewalContext({ unpaidFineCents: BORROW_BLOCK_FINE_THRESHOLD_CENTS })),
    ).toMatchObject({ allowed: false, code: 'OUTSTANDING_FINES' });
  });

  it('blocks when someone else is queued for the title', () => {
    expect(evaluateRenewal(renewalContext({ hasPendingReservations: true }))).toMatchObject({
      allowed: false,
      code: 'RESERVED_BY_ANOTHER_MEMBER',
    });
  });
});

describe('calculateDueDate', () => {
  it.each([
    ['STANDARD' as const, 14],
    ['PREMIUM' as const, 30],
    ['STAFF' as const, 60],
  ])('gives a %s member %i days', (tier, days) => {
    const due = calculateDueDate(NOW, tier);
    expect(due.getTime() - NOW.getTime()).toBe(days * 24 * 60 * 60 * 1000);
  });

  it('preserves the time of day', () => {
    expect(calculateDueDate(NOW, 'STANDARD').toISOString()).toBe('2025-01-29T09:00:00.000Z');
  });
});

describe('calculateRenewedDueDate', () => {
  it('extends from the current due date when the loan is not yet due', () => {
    const currentDue = new Date('2025-01-29T09:00:00.000Z');
    expect(calculateRenewedDueDate(currentDue, NOW, 'STANDARD').toISOString()).toBe('2025-02-05T09:00:00.000Z');
  });

  it('extends from today when the due date has already passed', () => {
    const currentDue = new Date('2025-01-01T09:00:00.000Z');
    expect(calculateRenewedDueDate(currentDue, NOW, 'STANDARD').toISOString()).toBe('2025-01-22T09:00:00.000Z');
  });

  it('never shortens a loan', () => {
    const currentDue = new Date('2025-06-01T09:00:00.000Z');
    expect(calculateRenewedDueDate(currentDue, NOW, 'STANDARD').getTime()).toBeGreaterThan(currentDue.getTime());
  });

  it('uses the tier renewal length', () => {
    const currentDue = new Date('2025-01-29T09:00:00.000Z');
    const premium = calculateRenewedDueDate(currentDue, NOW, 'PREMIUM');
    expect(premium.getTime() - currentDue.getTime()).toBe(TIER_POLICIES.PREMIUM.renewalDays * 86_400_000);
  });
});

describe('isOverdue', () => {
  it('is true for an active loan past its due date', () => {
    expect(isOverdue({ status: 'ACTIVE', dueAt: PAST }, NOW)).toBe(true);
  });

  it('is false for an active loan still in date', () => {
    expect(isOverdue({ status: 'ACTIVE', dueAt: FUTURE }, NOW)).toBe(false);
  });

  it('is false for a returned loan, however late it was', () => {
    expect(isOverdue({ status: 'RETURNED', dueAt: PAST }, NOW)).toBe(false);
  });
});
