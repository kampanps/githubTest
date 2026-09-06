import { addDays, isBefore, latest, parseIso } from './dates';
import { BORROW_BLOCK_FINE_THRESHOLD_CENTS, getTierPolicy } from './policy';
import type { Book, Loan, Member } from './types';

export type RuleDecision =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

const ALLOWED: RuleDecision = { allowed: true };

function denied(code: string, message: string): RuleDecision {
  return { allowed: false, code, message };
}

export interface BorrowContext {
  member: Pick<Member, 'tier' | 'status' | 'membershipExpiresAt'>;
  book: Pick<Book, 'availableCopies'>;
  activeLoanCount: number;
  unpaidFineCents: number;
  alreadyHasCopy: boolean;
  /** True when the only free copy is being held for a different member's reservation. */
  heldForAnotherMember: boolean;
  now: Date;
}

/**
 * The single place that answers "may this member borrow this book right now?".
 * Order matters: the checks run cheapest-and-most-blocking first so that the
 * error a caller sees is the most meaningful one.
 */
export function evaluateBorrow(context: BorrowContext): RuleDecision {
  const { member, book, activeLoanCount, unpaidFineCents, alreadyHasCopy, heldForAnotherMember, now } =
    context;

  if (member.status === 'SUSPENDED') {
    return denied('MEMBER_SUSPENDED', 'Suspended members cannot borrow books');
  }

  const expiresAt = parseIso(member.membershipExpiresAt, 'membershipExpiresAt');
  if (isBefore(expiresAt, now)) {
    return denied('MEMBERSHIP_EXPIRED', 'Membership has expired; renew it before borrowing');
  }

  if (unpaidFineCents >= BORROW_BLOCK_FINE_THRESHOLD_CENTS) {
    return denied(
      'OUTSTANDING_FINES',
      `Outstanding fines of ${unpaidFineCents} cents exceed the borrowing limit`,
    );
  }

  const policy = getTierPolicy(member.tier);
  if (activeLoanCount >= policy.maxActiveLoans) {
    return denied(
      'LOAN_LIMIT_REACHED',
      `${member.tier} members may hold at most ${policy.maxActiveLoans} loans at a time`,
    );
  }

  if (alreadyHasCopy) {
    return denied('DUPLICATE_LOAN', 'This member already has an active loan for this book');
  }

  if (book.availableCopies <= 0) {
    return denied('NO_COPIES_AVAILABLE', 'No copies of this book are currently available');
  }

  if (heldForAnotherMember) {
    return denied('RESERVED_BY_ANOTHER_MEMBER', 'The remaining copy is reserved for another member');
  }

  return ALLOWED;
}

export interface RenewalContext {
  loan: Pick<Loan, 'status' | 'renewalCount' | 'dueAt'>;
  member: Pick<Member, 'tier' | 'status'>;
  /** Someone else is waiting in the reservation queue for this title. */
  hasPendingReservations: boolean;
  unpaidFineCents: number;
  now: Date;
}

export function evaluateRenewal(context: RenewalContext): RuleDecision {
  const { loan, member, hasPendingReservations, unpaidFineCents, now } = context;

  if (loan.status === 'RETURNED') {
    return denied('LOAN_ALREADY_RETURNED', 'A returned loan cannot be renewed');
  }

  if (member.status === 'SUSPENDED') {
    return denied('MEMBER_SUSPENDED', 'Suspended members cannot renew loans');
  }

  const dueAt = parseIso(loan.dueAt, 'dueAt');
  if (isBefore(dueAt, now)) {
    return denied('LOAN_OVERDUE', 'Overdue loans must be returned, not renewed');
  }

  const policy = getTierPolicy(member.tier);
  if (loan.renewalCount >= policy.maxRenewals) {
    return denied(
      'RENEWAL_LIMIT_REACHED',
      `A loan may be renewed at most ${policy.maxRenewals} times for ${member.tier} members`,
    );
  }

  if (unpaidFineCents >= BORROW_BLOCK_FINE_THRESHOLD_CENTS) {
    return denied('OUTSTANDING_FINES', 'Settle outstanding fines before renewing');
  }

  if (hasPendingReservations) {
    return denied('RESERVED_BY_ANOTHER_MEMBER', 'Another member is waiting for this book');
  }

  return ALLOWED;
}

export function calculateDueDate(borrowedAt: Date, tier: Member['tier']): Date {
  return addDays(borrowedAt, getTierPolicy(tier).loanPeriodDays);
}

/**
 * Renewing never shortens a loan: the extension is added to whichever is later,
 * the current due date or now.
 */
export function calculateRenewedDueDate(currentDueAt: Date, now: Date, tier: Member['tier']): Date {
  return addDays(latest(currentDueAt, now), getTierPolicy(tier).renewalDays);
}

export function isOverdue(loan: Pick<Loan, 'dueAt' | 'status'>, now: Date): boolean {
  if (loan.status === 'RETURNED') {
    return false;
  }
  return isBefore(parseIso(loan.dueAt, 'dueAt'), now);
}
