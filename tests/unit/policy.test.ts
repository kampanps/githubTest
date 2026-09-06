import {
  BORROW_BLOCK_FINE_THRESHOLD_CENTS,
  FINE_GRACE_DAYS,
  FINE_MAX_CENTS,
  FINE_PER_DAY_CENTS,
  RESERVATION_HOLD_DAYS,
  TIER_POLICIES,
  getTierPolicy,
} from '../../src/domain/policy';
import { MEMBER_TIERS } from '../../src/domain/types';

describe('getTierPolicy', () => {
  it.each(MEMBER_TIERS)('returns a policy for %s', (tier) => {
    const policy = getTierPolicy(tier);
    expect(policy.maxActiveLoans).toBeGreaterThan(0);
    expect(policy.loanPeriodDays).toBeGreaterThan(0);
    expect(policy.renewalDays).toBeGreaterThan(0);
    expect(policy.maxRenewals).toBeGreaterThanOrEqual(0);
  });

  it('throws for an unknown tier', () => {
    expect(() => getTierPolicy('GOLD' as never)).toThrow(RangeError);
  });
});

describe('tier ordering', () => {
  it('gives higher tiers a larger loan allowance', () => {
    expect(TIER_POLICIES.STANDARD.maxActiveLoans).toBeLessThan(TIER_POLICIES.PREMIUM.maxActiveLoans);
    expect(TIER_POLICIES.PREMIUM.maxActiveLoans).toBeLessThan(TIER_POLICIES.STAFF.maxActiveLoans);
  });

  it('gives higher tiers a longer loan period', () => {
    expect(TIER_POLICIES.STANDARD.loanPeriodDays).toBeLessThan(TIER_POLICIES.PREMIUM.loanPeriodDays);
    expect(TIER_POLICIES.PREMIUM.loanPeriodDays).toBeLessThan(TIER_POLICIES.STAFF.loanPeriodDays);
  });

  it('gives higher tiers at least as many renewals', () => {
    expect(TIER_POLICIES.PREMIUM.maxRenewals).toBeGreaterThanOrEqual(TIER_POLICIES.STANDARD.maxRenewals);
    expect(TIER_POLICIES.STAFF.maxRenewals).toBeGreaterThanOrEqual(TIER_POLICIES.PREMIUM.maxRenewals);
  });
});

describe('policy constants', () => {
  it('keeps every monetary constant in whole cents', () => {
    for (const value of [FINE_PER_DAY_CENTS, FINE_MAX_CENTS, BORROW_BLOCK_FINE_THRESHOLD_CENTS]) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });

  it('blocks borrowing below the per-loan cap, so one late book can be recovered from', () => {
    expect(BORROW_BLOCK_FINE_THRESHOLD_CENTS).toBeLessThan(FINE_MAX_CENTS);
  });

  it('forgives at least one day', () => {
    expect(FINE_GRACE_DAYS).toBeGreaterThanOrEqual(1);
  });

  it('holds a ready reservation for a few days', () => {
    expect(RESERVATION_HOLD_DAYS).toBeGreaterThan(0);
  });

  it('freezes the policy table against accidental mutation', () => {
    expect(Object.isFrozen(TIER_POLICIES)).toBe(true);
  });
});
