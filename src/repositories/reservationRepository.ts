import type { Db } from '../db/connection';
import type { Reservation, ReservationStatus } from '../domain/types';
import { toReservation, type ReservationRow } from './mappers';

export interface ReservationRepository {
  insert(bookId: number, memberId: number, createdAt: string): Reservation;
  findById(id: number): Reservation | null;
  findOpenFor(bookId: number, memberId: number): Reservation | null;
  queueForBook(bookId: number): Reservation[];
  nextInQueue(bookId: number): Reservation | null;
  countWaiting(bookId: number): number;
  /** The member holding a READY copy of this book, if anyone. */
  readyHolder(bookId: number): Reservation | null;
  setStatus(id: number, status: ReservationStatus): Reservation | null;
  positionInQueue(id: number): number | null;
}

export function createReservationRepository(db: Db): ReservationRepository {
  return {
    insert(bookId, memberId, createdAt) {
      const result = db
        .prepare(`INSERT INTO reservations (book_id, member_id, created_at, status) VALUES (?, ?, ?, 'PENDING')`)
        .run(bookId, memberId, createdAt);

      return this.findById(Number(result.lastInsertRowid)) as Reservation;
    },

    findById(id) {
      const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) as ReservationRow | undefined;
      return row ? toReservation(row) : null;
    },

    findOpenFor(bookId, memberId) {
      const row = db
        .prepare(
          "SELECT * FROM reservations WHERE book_id = ? AND member_id = ? AND status IN ('PENDING', 'READY')",
        )
        .get(bookId, memberId) as ReservationRow | undefined;
      return row ? toReservation(row) : null;
    },

    queueForBook(bookId) {
      const rows = db
        .prepare(
          "SELECT * FROM reservations WHERE book_id = ? AND status IN ('PENDING', 'READY') ORDER BY created_at ASC, id ASC",
        )
        .all(bookId) as ReservationRow[];
      return rows.map(toReservation);
    },

    nextInQueue(bookId) {
      const row = db
        .prepare(
          "SELECT * FROM reservations WHERE book_id = ? AND status = 'PENDING' ORDER BY created_at ASC, id ASC LIMIT 1",
        )
        .get(bookId) as ReservationRow | undefined;
      return row ? toReservation(row) : null;
    },

    countWaiting(bookId) {
      const { total } = db
        .prepare("SELECT COUNT(*) AS total FROM reservations WHERE book_id = ? AND status IN ('PENDING', 'READY')")
        .get(bookId) as { total: number };
      return total;
    },

    readyHolder(bookId) {
      const row = db
        .prepare("SELECT * FROM reservations WHERE book_id = ? AND status = 'READY' ORDER BY id ASC LIMIT 1")
        .get(bookId) as ReservationRow | undefined;
      return row ? toReservation(row) : null;
    },

    setStatus(id, status) {
      db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run(status, id);
      return this.findById(id);
    },

    positionInQueue(id) {
      const reservation = this.findById(id);
      if (!reservation || (reservation.status !== 'PENDING' && reservation.status !== 'READY')) {
        return null;
      }
      const queue = this.queueForBook(reservation.bookId);
      const index = queue.findIndex((entry) => entry.id === id);
      return index === -1 ? null : index + 1;
    },
  };
}
