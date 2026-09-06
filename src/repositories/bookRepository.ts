import type { Db } from '../db/connection';
import type { Pagination } from '../domain/pagination';
import type { Book } from '../domain/types';
import { toBook, type BookRow } from './mappers';

export interface NewBook {
  isbn: string;
  title: string;
  author: string;
  publishedYear: number;
  totalCopies: number;
}

export interface BookFilters {
  search?: string | undefined;
  author?: string | undefined;
  availableOnly?: boolean | undefined;
}

export interface BookRepository {
  insert(input: NewBook, now: string): Book;
  findById(id: number): Book | null;
  findByIsbn(isbn: string): Book | null;
  list(filters: BookFilters, pagination: Pagination): { rows: Book[]; total: number };
  update(id: number, changes: { title?: string; author?: string; totalCopies?: number }): Book | null;
  remove(id: number): boolean;
  reserveCopy(id: number): boolean;
  releaseCopy(id: number): boolean;
}

/**
 * Builds the WHERE fragment shared by list() and the matching COUNT query so the
 * two can never drift apart.
 */
function buildFilterClause(filters: BookFilters): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.search && filters.search.trim() !== '') {
    conditions.push('(title LIKE ? OR author LIKE ? OR isbn LIKE ?)');
    const pattern = `%${filters.search.trim()}%`;
    params.push(pattern, pattern, pattern);
  }

  if (filters.author && filters.author.trim() !== '') {
    conditions.push('author = ?');
    params.push(filters.author.trim());
  }

  if (filters.availableOnly) {
    conditions.push('available_copies > 0');
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export function createBookRepository(db: Db): BookRepository {
  return {
    insert(input, now) {
      const result = db
        .prepare(
          `INSERT INTO books (isbn, title, author, published_year, total_copies, available_copies, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.isbn, input.title, input.author, input.publishedYear, input.totalCopies, input.totalCopies, now);

      return this.findById(Number(result.lastInsertRowid)) as Book;
    },

    findById(id) {
      const row = db.prepare('SELECT * FROM books WHERE id = ?').get(id) as BookRow | undefined;
      return row ? toBook(row) : null;
    },

    findByIsbn(isbn) {
      const row = db.prepare('SELECT * FROM books WHERE isbn = ?').get(isbn) as BookRow | undefined;
      return row ? toBook(row) : null;
    },

    list(filters, pagination) {
      const { clause, params } = buildFilterClause(filters);

      const rows = db
        .prepare(`SELECT * FROM books ${clause} ORDER BY id ASC LIMIT ? OFFSET ?`)
        .all(...params, pagination.limit, pagination.offset) as BookRow[];

      const { total } = db.prepare(`SELECT COUNT(*) AS total FROM books ${clause}`).get(...params) as {
        total: number;
      };

      return { rows: rows.map(toBook), total };
    },

    update(id, changes) {
      const current = this.findById(id);
      if (!current) {
        return null;
      }

      const title = changes.title ?? current.title;
      const author = changes.author ?? current.author;
      const totalCopies = changes.totalCopies ?? current.totalCopies;

      // Shrinking the collection must not push available below zero, and the
      // copies that are currently on loan stay on loan.
      const onLoan = current.totalCopies - current.availableCopies;
      const availableCopies = Math.max(0, totalCopies - onLoan);

      db.prepare(
        `UPDATE books SET title = ?, author = ?, total_copies = ?, available_copies = ? WHERE id = ?`,
      ).run(title, author, totalCopies, availableCopies, id);

      return this.findById(id);
    },

    remove(id) {
      const result = db.prepare('DELETE FROM books WHERE id = ?').run(id);
      return result.changes > 0;
    },

    /**
     * Takes one copy off the shelf. The `available_copies > 0` guard lives in
     * the SQL itself, so two concurrent borrows can never both succeed.
     */
    reserveCopy(id) {
      const result = db
        .prepare('UPDATE books SET available_copies = available_copies - 1 WHERE id = ? AND available_copies > 0')
        .run(id);
      return result.changes > 0;
    },

    releaseCopy(id) {
      const result = db
        .prepare(
          'UPDATE books SET available_copies = available_copies + 1 WHERE id = ? AND available_copies < total_copies',
        )
        .run(id);
      return result.changes > 0;
    },
  };
}
