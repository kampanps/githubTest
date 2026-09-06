import { parseIso } from '../domain/dates';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '../domain/errors';
import { calculateFine } from '../domain/fines';
import {
  calculateDueDate,
  calculateRenewedDueDate,
  evaluateBorrow,
  evaluateRenewal,
  isOverdue,
} from '../domain/loanRules';
import { buildPage, parsePagination, type Page } from '../domain/pagination';
import type { Fine, Loan, LoanStatus, Reservation } from '../domain/types';
import { toPositiveInt, validateBorrowInput } from '../domain/validation';
import type { ServiceContext } from './types';

export interface ReturnReceipt {
  loan: Loan;
  daysLate: number;
  fine: Fine | null;
  /** The reservation that was promoted to READY by this return, if any. */
  promotedReservation: Reservation | null;
}

export interface LoanService {
  borrow(input: unknown): Loan;
  returnLoan(loanId: number): ReturnReceipt;
  renew(loanId: number): Loan;
  getById(id: number): Loan;
  list(query: Record<string, unknown>): Page<Loan>;
  listOverdue(query: Record<string, unknown>): Page<Loan>;
}

export function createLoanService({ db, repos, clock }: ServiceContext): LoanService {
  function requireLoan(id: number): Loan {
    const loan = repos.loans.findById(id);
    if (!loan) {
      throw new NotFoundError('Loan', id);
    }
    return loan;
  }

  return {
    /**
     * Borrowing runs inside a single SQLite transaction: the availability check,
     * the decrement and the loan row either all land or none of them do.
     */
    borrow(input) {
      const parsed = validateBorrowInput(input);
      if (!parsed.valid) {
        throw new ValidationError(parsed.errors);
      }
      const { bookId, memberId } = parsed.value;

      return db.transaction(() => {
        const member = repos.members.findById(memberId);
        if (!member) {
          throw new NotFoundError('Member', memberId);
        }

        const book = repos.books.findById(bookId);
        if (!book) {
          throw new NotFoundError('Book', bookId);
        }

        const now = clock();
        const readyHolder = repos.reservations.readyHolder(bookId);

        const decision = evaluateBorrow({
          member,
          book,
          activeLoanCount: repos.loans.countActiveByMember(memberId),
          unpaidFineCents: repos.fines.sumUnpaidByMember(memberId),
          alreadyHasCopy: repos.loans.findActive(bookId, memberId) !== null,
          heldForAnotherMember:
            readyHolder !== null && readyHolder.memberId !== memberId && book.availableCopies <= 1,
          now,
        });

        if (!decision.allowed) {
          throw new BusinessRuleError(decision.code, decision.message);
        }

        if (!repos.books.reserveCopy(bookId)) {
          // Lost a race against another borrow between the read and the write.
          throw new ConflictError('NO_COPIES_AVAILABLE', 'The last copy was taken by another member');
        }

        const loan = repos.loans.insert({
          bookId,
          memberId,
          borrowedAt: now.toISOString(),
          dueAt: calculateDueDate(now, member.tier).toISOString(),
        });

        // Borrowing consumes this member's own place in the queue.
        const ownReservation = repos.reservations.findOpenFor(bookId, memberId);
        if (ownReservation) {
          repos.reservations.setStatus(ownReservation.id, 'FULFILLED');
        }

        return loan;
      })();
    },

    returnLoan(loanId) {
      return db.transaction(() => {
        const loan = requireLoan(loanId);
        if (loan.status === 'RETURNED') {
          throw new ConflictError('LOAN_ALREADY_RETURNED', 'This loan has already been returned');
        }

        const now = clock();
        const breakdown = calculateFine(parseIso(loan.dueAt, 'dueAt'), now);

        const returned = repos.loans.markReturned(loanId, now.toISOString()) as Loan;
        repos.books.releaseCopy(loan.bookId);

        const fine =
          breakdown.amountCents > 0
            ? repos.fines.insert({
                loanId: loan.id,
                memberId: loan.memberId,
                amountCents: breakdown.amountCents,
                reason: `Returned ${breakdown.daysLate} day(s) after the due date`,
                createdAt: now.toISOString(),
              })
            : null;

        // Hand the freed copy to whoever has been waiting longest.
        const next = repos.reservations.nextInQueue(loan.bookId);
        const promotedReservation = next ? repos.reservations.setStatus(next.id, 'READY') : null;

        return { loan: returned, daysLate: breakdown.daysLate, fine, promotedReservation };
      })();
    },

    renew(loanId) {
      return db.transaction(() => {
        const loan = requireLoan(loanId);
        const member = repos.members.findById(loan.memberId);
        if (!member) {
          throw new NotFoundError('Member', loan.memberId);
        }

        const now = clock();
        const decision = evaluateRenewal({
          loan,
          member,
          hasPendingReservations: repos.reservations.countWaiting(loan.bookId) > 0,
          unpaidFineCents: repos.fines.sumUnpaidByMember(loan.memberId),
          now,
        });

        if (!decision.allowed) {
          throw new BusinessRuleError(decision.code, decision.message);
        }

        const newDueAt = calculateRenewedDueDate(parseIso(loan.dueAt, 'dueAt'), now, member.tier);
        return repos.loans.extendDueDate(loan.id, newDueAt.toISOString()) as Loan;
      })();
    },

    getById(id) {
      return requireLoan(id);
    },

    list(query) {
      const pagination = parsePagination(query);
      const status =
        query.status === 'ACTIVE' || query.status === 'RETURNED' ? (query.status as LoanStatus) : undefined;

      const { rows, total } = repos.loans.list(
        {
          memberId: toPositiveInt(query.memberId) ?? undefined,
          bookId: toPositiveInt(query.bookId) ?? undefined,
          status,
        },
        pagination,
      );

      return buildPage(rows, total, pagination);
    },

    listOverdue(query) {
      const pagination = parsePagination(query);
      const now = clock();
      const { rows, total } = repos.loans.list({ overdueAsOf: now.toISOString() }, pagination);

      // Defensive: the SQL filter and the domain rule should always agree.
      return buildPage(
        rows.filter((loan) => isOverdue(loan, now)),
        total,
        pagination,
      );
    },
  };
}
