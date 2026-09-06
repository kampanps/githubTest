import type { Db } from '../db/connection';
import type { Pagination } from '../domain/pagination';
import type { Loan, LoanStatus } from '../domain/types';
import { toLoan, type LoanRow } from './mappers';

export interface NewLoan {
  bookId: number;
  memberId: number;
  borrowedAt: string;
  dueAt: string;
}

export interface LoanFilters {
  memberId?: number | undefined;
  bookId?: number | undefined;
  status?: LoanStatus | undefined;
  /** Only loans that are still out and past their due date. */
  overdueAsOf?: string | undefined;
}

export interface LoanRepository {
  insert(input: NewLoan): Loan;
  findById(id: number): Loan | null;
  findActive(bookId: number, memberId: number): Loan | null;
  countActiveByMember(memberId: number): number;
  list(filters: LoanFilters, pagination: Pagination): { rows: Loan[]; total: number };
  markReturned(id: number, returnedAt: string): Loan | null;
  extendDueDate(id: number, dueAt: string): Loan | null;
}

function buildFilterClause(filters: LoanFilters): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.memberId !== undefined) {
    conditions.push('member_id = ?');
    params.push(filters.memberId);
  }
  if (filters.bookId !== undefined) {
    conditions.push('book_id = ?');
    params.push(filters.bookId);
  }
  if (filters.status !== undefined) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.overdueAsOf !== undefined) {
    conditions.push("status = 'ACTIVE' AND due_at < ?");
    params.push(filters.overdueAsOf);
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export function createLoanRepository(db: Db): LoanRepository {
  return {
    insert(input) {
      const result = db
        .prepare(
          `INSERT INTO loans (book_id, member_id, borrowed_at, due_at, renewal_count, status)
           VALUES (?, ?, ?, ?, 0, 'ACTIVE')`,
        )
        .run(input.bookId, input.memberId, input.borrowedAt, input.dueAt);

      return this.findById(Number(result.lastInsertRowid)) as Loan;
    },

    findById(id) {
      const row = db.prepare('SELECT * FROM loans WHERE id = ?').get(id) as LoanRow | undefined;
      return row ? toLoan(row) : null;
    },

    findActive(bookId, memberId) {
      const row = db
        .prepare("SELECT * FROM loans WHERE book_id = ? AND member_id = ? AND status = 'ACTIVE'")
        .get(bookId, memberId) as LoanRow | undefined;
      return row ? toLoan(row) : null;
    },

    countActiveByMember(memberId) {
      const { total } = db
        .prepare("SELECT COUNT(*) AS total FROM loans WHERE member_id = ? AND status = 'ACTIVE'")
        .get(memberId) as { total: number };
      return total;
    },

    list(filters, pagination) {
      const { clause, params } = buildFilterClause(filters);

      const rows = db
        .prepare(`SELECT * FROM loans ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
        .all(...params, pagination.limit, pagination.offset) as LoanRow[];

      const { total } = db.prepare(`SELECT COUNT(*) AS total FROM loans ${clause}`).get(...params) as {
        total: number;
      };

      return { rows: rows.map(toLoan), total };
    },

    markReturned(id, returnedAt) {
      db.prepare("UPDATE loans SET status = 'RETURNED', returned_at = ? WHERE id = ? AND status = 'ACTIVE'").run(
        returnedAt,
        id,
      );
      return this.findById(id);
    },

    extendDueDate(id, dueAt) {
      db.prepare(
        "UPDATE loans SET due_at = ?, renewal_count = renewal_count + 1 WHERE id = ? AND status = 'ACTIVE'",
      ).run(dueAt, id);
      return this.findById(id);
    },
  };
}
