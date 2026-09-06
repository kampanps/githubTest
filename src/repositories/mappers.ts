import type { Book, Fine, Loan, Member, Reservation } from '../domain/types';

export interface MemberRow {
  id: number;
  name: string;
  email: string;
  tier: Member['tier'];
  status: Member['status'];
  joined_at: string;
  membership_expires_at: string;
}

export interface BookRow {
  id: number;
  isbn: string;
  title: string;
  author: string;
  published_year: number;
  total_copies: number;
  available_copies: number;
  created_at: string;
}

export interface LoanRow {
  id: number;
  book_id: number;
  member_id: number;
  borrowed_at: string;
  due_at: string;
  returned_at: string | null;
  renewal_count: number;
  status: Loan['status'];
}

export interface ReservationRow {
  id: number;
  book_id: number;
  member_id: number;
  created_at: string;
  status: Reservation['status'];
}

export interface FineRow {
  id: number;
  loan_id: number;
  member_id: number;
  amount_cents: number;
  reason: string;
  status: Fine['status'];
  created_at: string;
  settled_at: string | null;
}

export function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    tier: row.tier,
    status: row.status,
    joinedAt: row.joined_at,
    membershipExpiresAt: row.membership_expires_at,
  };
}

export function toBook(row: BookRow): Book {
  return {
    id: row.id,
    isbn: row.isbn,
    title: row.title,
    author: row.author,
    publishedYear: row.published_year,
    totalCopies: row.total_copies,
    availableCopies: row.available_copies,
    createdAt: row.created_at,
  };
}

export function toLoan(row: LoanRow): Loan {
  return {
    id: row.id,
    bookId: row.book_id,
    memberId: row.member_id,
    borrowedAt: row.borrowed_at,
    dueAt: row.due_at,
    returnedAt: row.returned_at,
    renewalCount: row.renewal_count,
    status: row.status,
  };
}

export function toReservation(row: ReservationRow): Reservation {
  return {
    id: row.id,
    bookId: row.book_id,
    memberId: row.member_id,
    createdAt: row.created_at,
    status: row.status,
  };
}

export function toFine(row: FineRow): Fine {
  return {
    id: row.id,
    loanId: row.loan_id,
    memberId: row.member_id,
    amountCents: row.amount_cents,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    settledAt: row.settled_at,
  };
}
