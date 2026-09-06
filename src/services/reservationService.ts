import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '../domain/errors';
import type { Reservation } from '../domain/types';
import { validateBorrowInput } from '../domain/validation';
import type { ServiceContext } from './types';

export interface ReservationWithPosition extends Reservation {
  position: number | null;
}

export interface ReservationService {
  reserve(input: unknown): ReservationWithPosition;
  cancel(id: number): Reservation;
  queue(bookId: number): ReservationWithPosition[];
  getById(id: number): ReservationWithPosition;
}

export function createReservationService({ db, repos, clock }: ServiceContext): ReservationService {
  function withPosition(reservation: Reservation): ReservationWithPosition {
    return { ...reservation, position: repos.reservations.positionInQueue(reservation.id) };
  }

  return {
    reserve(input) {
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
        if (member.status === 'SUSPENDED') {
          throw new BusinessRuleError('MEMBER_SUSPENDED', 'Suspended members cannot reserve books');
        }

        const book = repos.books.findById(bookId);
        if (!book) {
          throw new NotFoundError('Book', bookId);
        }

        if (repos.loans.findActive(bookId, memberId)) {
          throw new ConflictError('ALREADY_BORROWED', 'You already have this book on loan');
        }

        if (repos.reservations.findOpenFor(bookId, memberId)) {
          throw new ConflictError('ALREADY_RESERVED', 'You are already in the queue for this book');
        }

        // Reserving something you could simply walk out with is almost always a
        // mistake, so it is rejected rather than silently queued.
        if (book.availableCopies > repos.reservations.countWaiting(bookId)) {
          throw new BusinessRuleError('BOOK_AVAILABLE', 'This book is available now - borrow it instead');
        }

        return withPosition(repos.reservations.insert(bookId, memberId, clock().toISOString()));
      })();
    },

    cancel(id) {
      const reservation = repos.reservations.findById(id);
      if (!reservation) {
        throw new NotFoundError('Reservation', id);
      }
      if (reservation.status !== 'PENDING' && reservation.status !== 'READY') {
        throw new ConflictError('RESERVATION_NOT_OPEN', `A ${reservation.status} reservation cannot be cancelled`);
      }
      return repos.reservations.setStatus(id, 'CANCELLED') as Reservation;
    },

    queue(bookId) {
      if (!repos.books.findById(bookId)) {
        throw new NotFoundError('Book', bookId);
      }
      return repos.reservations.queueForBook(bookId).map((entry, index) => ({ ...entry, position: index + 1 }));
    },

    getById(id) {
      const reservation = repos.reservations.findById(id);
      if (!reservation) {
        throw new NotFoundError('Reservation', id);
      }
      return withPosition(reservation);
    },
  };
}
