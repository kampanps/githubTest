import { toNonNegativeInt, toPositiveInt } from './validation';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface Pagination {
  page: number;
  limit: number;
  offset: number;
}

export interface Page<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

/**
 * Turns raw query params into a safe page/limit pair.
 * Anything unusable falls back to the default instead of erroring - list
 * endpoints should not 400 because someone typed `?page=abc`.
 */
export function parsePagination(query: Record<string, unknown> = {}): Pagination {
  const page = toPositiveInt(query.page) ?? 1;
  const requestedLimit = toPositiveInt(query.limit) ?? DEFAULT_PAGE_SIZE;
  const limit = Math.min(requestedLimit, MAX_PAGE_SIZE);

  return { page, limit, offset: (page - 1) * limit };
}

export function buildPage<T>(data: T[], total: number, pagination: Pagination): Page<T> {
  const safeTotal = toNonNegativeInt(total) ?? 0;
  const totalPages = pagination.limit > 0 ? Math.ceil(safeTotal / pagination.limit) : 0;

  return {
    data,
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total: safeTotal,
      totalPages,
      hasNext: pagination.page < totalPages,
      hasPrevious: pagination.page > 1 && safeTotal > 0,
    },
  };
}
