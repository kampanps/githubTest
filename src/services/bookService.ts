import { ConflictError, NotFoundError, ValidationError } from '../domain/errors';
import { buildPage, parsePagination, type Page } from '../domain/pagination';
import type { Book } from '../domain/types';
import { validateCreateBook, validateUpdateBook } from '../domain/validation';
import type { ServiceContext } from './types';

export interface BookService {
  create(input: unknown): Book;
  getById(id: number): Book;
  list(query: Record<string, unknown>): Page<Book>;
  update(id: number, input: unknown): Book;
  remove(id: number): void;
}

export function createBookService({ repos, clock }: ServiceContext): BookService {
  return {
    create(input) {
      const result = validateCreateBook(input, clock().getUTCFullYear());
      if (!result.valid) {
        throw new ValidationError(result.errors);
      }

      if (repos.books.findByIsbn(result.value.isbn)) {
        throw new ConflictError('ISBN_ALREADY_EXISTS', `A book with ISBN ${result.value.isbn} already exists`);
      }

      return repos.books.insert(result.value, clock().toISOString());
    },

    getById(id) {
      const book = repos.books.findById(id);
      if (!book) {
        throw new NotFoundError('Book', id);
      }
      return book;
    },

    list(query) {
      const pagination = parsePagination(query);
      const { rows, total } = repos.books.list(
        {
          search: typeof query.search === 'string' ? query.search : undefined,
          author: typeof query.author === 'string' ? query.author : undefined,
          availableOnly: query.available === 'true' || query.available === true,
        },
        pagination,
      );

      return buildPage(rows, total, pagination);
    },

    update(id, input) {
      const existing = repos.books.findById(id);
      if (!existing) {
        throw new NotFoundError('Book', id);
      }

      const result = validateUpdateBook(input);
      if (!result.valid) {
        throw new ValidationError(result.errors);
      }

      const onLoan = existing.totalCopies - existing.availableCopies;
      if (result.value.totalCopies !== undefined && result.value.totalCopies < onLoan) {
        throw new ConflictError(
          'COPIES_ON_LOAN',
          `Cannot reduce totalCopies to ${result.value.totalCopies}; ${onLoan} copies are currently on loan`,
        );
      }

      return repos.books.update(id, result.value) as Book;
    },

    remove(id) {
      const existing = repos.books.findById(id);
      if (!existing) {
        throw new NotFoundError('Book', id);
      }

      if (existing.availableCopies < existing.totalCopies) {
        throw new ConflictError('COPIES_ON_LOAN', 'Cannot delete a book while copies are on loan');
      }

      repos.books.remove(id);
    },
  };
}
