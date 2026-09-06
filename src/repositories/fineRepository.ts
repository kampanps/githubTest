import type { Db } from '../db/connection';
import type { Fine, FineStatus } from '../domain/types';
import { toFine, type FineRow } from './mappers';

export interface NewFine {
  loanId: number;
  memberId: number;
  amountCents: number;
  reason: string;
  createdAt: string;
}

export interface FineRepository {
  insert(input: NewFine): Fine;
  findById(id: number): Fine | null;
  listByMember(memberId: number, status?: FineStatus): Fine[];
  sumUnpaidByMember(memberId: number): number;
  settle(id: number, status: Extract<FineStatus, 'PAID' | 'WAIVED'>, settledAt: string): Fine | null;
}

export function createFineRepository(db: Db): FineRepository {
  return {
    insert(input) {
      const result = db
        .prepare(
          `INSERT INTO fines (loan_id, member_id, amount_cents, reason, status, created_at)
           VALUES (?, ?, ?, ?, 'UNPAID', ?)`,
        )
        .run(input.loanId, input.memberId, input.amountCents, input.reason, input.createdAt);

      return this.findById(Number(result.lastInsertRowid)) as Fine;
    },

    findById(id) {
      const row = db.prepare('SELECT * FROM fines WHERE id = ?').get(id) as FineRow | undefined;
      return row ? toFine(row) : null;
    },

    listByMember(memberId, status) {
      const rows = status
        ? (db
            .prepare('SELECT * FROM fines WHERE member_id = ? AND status = ? ORDER BY id ASC')
            .all(memberId, status) as FineRow[])
        : (db.prepare('SELECT * FROM fines WHERE member_id = ? ORDER BY id ASC').all(memberId) as FineRow[]);

      return rows.map(toFine);
    },

    sumUnpaidByMember(memberId) {
      const row = db
        .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM fines WHERE member_id = ? AND status = 'UNPAID'")
        .get(memberId) as { total: number };
      return row.total;
    },

    settle(id, status, settledAt) {
      db.prepare("UPDATE fines SET status = ?, settled_at = ? WHERE id = ? AND status = 'UNPAID'").run(
        status,
        settledAt,
        id,
      );
      return this.findById(id);
    },
  };
}
