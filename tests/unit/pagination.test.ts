import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildPage,
  parsePagination,
} from '../../src/domain/pagination';

describe('parsePagination', () => {
  it('defaults to the first page', () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: DEFAULT_PAGE_SIZE, offset: 0 });
  });

  it('defaults when called with no argument at all', () => {
    expect(parsePagination().page).toBe(1);
  });

  it('accepts numeric strings from a query string', () => {
    expect(parsePagination({ page: '3', limit: '10' })).toEqual({ page: 3, limit: 10, offset: 20 });
  });

  it('computes the offset from page and limit', () => {
    expect(parsePagination({ page: 5, limit: 25 }).offset).toBe(100);
  });

  it('clamps the limit to the maximum', () => {
    expect(parsePagination({ limit: 5000 }).limit).toBe(MAX_PAGE_SIZE);
  });

  it.each([['abc'], [''], [0], [-3], [1.5], [null], [undefined]])(
    'falls back to defaults for the unusable page value %p',
    (page) => {
      expect(parsePagination({ page }).page).toBe(1);
    },
  );

  it('falls back to the default limit for junk input', () => {
    expect(parsePagination({ limit: 'lots' }).limit).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe('buildPage', () => {
  const pagination = { page: 2, limit: 10, offset: 10 };

  it('describes a middle page', () => {
    const page = buildPage(['a', 'b'], 35, pagination);
    expect(page.meta).toEqual({
      page: 2,
      limit: 10,
      total: 35,
      totalPages: 4,
      hasNext: true,
      hasPrevious: true,
    });
  });

  it('marks the last page as having no next', () => {
    expect(buildPage(['a'], 15, { page: 2, limit: 10, offset: 10 }).meta.hasNext).toBe(false);
  });

  it('marks the first page as having no previous', () => {
    expect(buildPage(['a'], 15, { page: 1, limit: 10, offset: 0 }).meta.hasPrevious).toBe(false);
  });

  it('handles an empty result set', () => {
    const page = buildPage([], 0, { page: 1, limit: 10, offset: 0 });
    expect(page.data).toEqual([]);
    expect(page.meta).toMatchObject({ total: 0, totalPages: 0, hasNext: false, hasPrevious: false });
  });

  it('rounds the page count up for a partial last page', () => {
    expect(buildPage([], 21, { page: 1, limit: 10, offset: 0 }).meta.totalPages).toBe(3);
  });

  it('coerces a nonsense total to zero rather than producing NaN', () => {
    const page = buildPage([], -5, { page: 1, limit: 10, offset: 0 });
    expect(page.meta.total).toBe(0);
    expect(page.meta.totalPages).toBe(0);
  });

  it('does not divide by zero when the limit is zero', () => {
    expect(buildPage([], 10, { page: 1, limit: 0, offset: 0 }).meta.totalPages).toBe(0);
  });

  it('passes the data through untouched', () => {
    const data = [{ id: 1 }, { id: 2 }];
    expect(buildPage(data, 2, { page: 1, limit: 10, offset: 0 }).data).toBe(data);
  });
});
