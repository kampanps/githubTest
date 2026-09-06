/**
 * Shared domain types. These mirror the SQLite schema but are plain data -
 * no framework, no I/O - which is what makes the unit tests cheap to write.
 */

export const MEMBER_TIERS = ['STANDARD', 'PREMIUM', 'STAFF'] as const;
export type MemberTier = (typeof MEMBER_TIERS)[number];

export const MEMBER_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const LOAN_STATUSES = ['ACTIVE', 'RETURNED'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const RESERVATION_STATUSES = ['PENDING', 'READY', 'FULFILLED', 'CANCELLED'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const FINE_STATUSES = ['UNPAID', 'PAID', 'WAIVED'] as const;
export type FineStatus = (typeof FINE_STATUSES)[number];

export const ROLES = ['ADMIN', 'LIBRARIAN', 'MEMBER'] as const;
export type Role = (typeof ROLES)[number];

export interface Member {
  id: number;
  name: string;
  email: string;
  tier: MemberTier;
  status: MemberStatus;
  joinedAt: string;
  membershipExpiresAt: string;
}

export interface Book {
  id: number;
  isbn: string;
  title: string;
  author: string;
  publishedYear: number;
  totalCopies: number;
  availableCopies: number;
  createdAt: string;
}

export interface Loan {
  id: number;
  bookId: number;
  memberId: number;
  borrowedAt: string;
  dueAt: string;
  returnedAt: string | null;
  renewalCount: number;
  status: LoanStatus;
}

export interface Reservation {
  id: number;
  bookId: number;
  memberId: number;
  createdAt: string;
  status: ReservationStatus;
}

export interface Fine {
  id: number;
  loanId: number;
  memberId: number;
  amountCents: number;
  reason: string;
  status: FineStatus;
  createdAt: string;
  settledAt: string | null;
}

/** Injectable clock so that time-dependent rules stay deterministic under test. */
export type Clock = () => Date;
