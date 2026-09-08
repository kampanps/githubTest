import type { MemberTier } from './types';

export interface TierPolicy {
  /** How many books a member of this tier may hold at once. */
  maxActiveLoans: number;
  /** Length of a fresh loan, in days. */
  loanPeriodDays: number;
  /** How many times a single loan may be renewed. */
  maxRenewals: number;
  /** Days added by each renewal. */
  renewalDays: number;
}

export const TIER_POLICIES: Readonly<Record<MemberTier, TierPolicy>> = Object.freeze({
  STANDARD: { maxActiveLoans: 3, loanPeriodDays: 14, maxRenewals: 2, renewalDays: 7 },
  PREMIUM: { maxActiveLoans: 10, loanPeriodDays: 30, maxRenewals: 3, renewalDays: 14 },
  STAFF: { maxActiveLoans: 20, loanPeriodDays: 60, maxRenewals: 5, renewalDays: 30 },
});

/** Money is stored in whole cents (satang) - never floats. */
export const FINE_PER_DAY_CENTS = 600;

/** Days of lateness that are forgiven before any fine accrues. */
export const FINE_GRACE_DAYS = 1;

/** A single loan can never be fined more than this. */
export const FINE_MAX_CENTS = 50_000;

/** Once a member owes at least this much, borrowing is blocked until they pay. */
export const BORROW_BLOCK_FINE_THRESHOLD_CENTS = 20_000;

/** How long a reservation stays READY before the next person in the queue gets it. */
export const RESERVATION_HOLD_DAYS = 3;

export function getTierPolicy(tier: MemberTier): TierPolicy {
  const policy = TIER_POLICIES[tier];
  if (!policy) {
    throw new RangeError(`Unknown member tier: ${String(tier)}`);
  }
  return policy;
}
