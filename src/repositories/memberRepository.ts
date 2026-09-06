import type { Db } from '../db/connection';
import type { Pagination } from '../domain/pagination';
import type { Member, MemberStatus, MemberTier } from '../domain/types';
import { toMember, type MemberRow } from './mappers';

export interface NewMember {
  name: string;
  email: string;
  tier: MemberTier;
  joinedAt: string;
  membershipExpiresAt: string;
}

export interface MemberFilters {
  status?: MemberStatus | undefined;
  tier?: MemberTier | undefined;
  search?: string | undefined;
}

export interface MemberRepository {
  insert(input: NewMember): Member;
  findById(id: number): Member | null;
  findByEmail(email: string): Member | null;
  list(filters: MemberFilters, pagination: Pagination): { rows: Member[]; total: number };
  setStatus(id: number, status: MemberStatus): Member | null;
  setTier(id: number, tier: MemberTier): Member | null;
  setMembershipExpiry(id: number, expiresAt: string): Member | null;
}

function buildFilterClause(filters: MemberFilters): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.tier) {
    conditions.push('tier = ?');
    params.push(filters.tier);
  }
  if (filters.search && filters.search.trim() !== '') {
    conditions.push('(name LIKE ? OR email LIKE ?)');
    const pattern = `%${filters.search.trim()}%`;
    params.push(pattern, pattern);
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export function createMemberRepository(db: Db): MemberRepository {
  return {
    insert(input) {
      const result = db
        .prepare(
          `INSERT INTO members (name, email, tier, status, joined_at, membership_expires_at)
           VALUES (?, ?, ?, 'ACTIVE', ?, ?)`,
        )
        .run(input.name, input.email, input.tier, input.joinedAt, input.membershipExpiresAt);

      return this.findById(Number(result.lastInsertRowid)) as Member;
    },

    findById(id) {
      const row = db.prepare('SELECT * FROM members WHERE id = ?').get(id) as MemberRow | undefined;
      return row ? toMember(row) : null;
    },

    findByEmail(email) {
      const row = db.prepare('SELECT * FROM members WHERE email = ?').get(email.toLowerCase()) as
        | MemberRow
        | undefined;
      return row ? toMember(row) : null;
    },

    list(filters, pagination) {
      const { clause, params } = buildFilterClause(filters);

      const rows = db
        .prepare(`SELECT * FROM members ${clause} ORDER BY id ASC LIMIT ? OFFSET ?`)
        .all(...params, pagination.limit, pagination.offset) as MemberRow[];

      const { total } = db.prepare(`SELECT COUNT(*) AS total FROM members ${clause}`).get(...params) as {
        total: number;
      };

      return { rows: rows.map(toMember), total };
    },

    setStatus(id, status) {
      db.prepare('UPDATE members SET status = ? WHERE id = ?').run(status, id);
      return this.findById(id);
    },

    setTier(id, tier) {
      db.prepare('UPDATE members SET tier = ? WHERE id = ?').run(tier, id);
      return this.findById(id);
    },

    setMembershipExpiry(id, expiresAt) {
      db.prepare('UPDATE members SET membership_expires_at = ? WHERE id = ?').run(expiresAt, id);
      return this.findById(id);
    },
  };
}
