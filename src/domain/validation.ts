import { isValidIsbn, normalizeIsbn } from './isbn';
import { MEMBER_TIERS, type MemberTier } from './types';

export interface FieldError {
  field: string;
  message: string;
}

export type ValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; errors: FieldError[] };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const MIN_TITLE_LENGTH = 2;
const MAX_TITLE_LENGTH = 200;
const EARLIEST_PUBLICATION_YEAR = 1450;

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value.trim());
}

export function isMemberTier(value: unknown): value is MemberTier {
  return typeof value === 'string' && (MEMBER_TIERS as readonly string[]).includes(value);
}

/** Accepts a number or a numeric string; rejects anything that is not a positive integer. */
export function toPositiveInt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return parsed > 0 ? parsed : null;
  }
  return null;
}

export function toNonNegativeInt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export interface CreateBookInput {
  isbn: string;
  title: string;
  author: string;
  publishedYear: number;
  totalCopies: number;
}

export function validateCreateBook(
  input: unknown,
  currentYear = new Date().getUTCFullYear(),
): ValidationResult<CreateBookInput> {
  const body = asRecord(input);
  const errors: FieldError[] = [];

  if (!isNonEmptyString(body.isbn)) {
    errors.push({ field: 'isbn', message: 'isbn is required' });
  } else if (!isValidIsbn(body.isbn)) {
    errors.push({ field: 'isbn', message: 'isbn must be a valid ISBN-10 or ISBN-13' });
  }

  if (!isNonEmptyString(body.title)) {
    errors.push({ field: 'title', message: 'title is required' });
  } else if (body.title.trim().length < MIN_TITLE_LENGTH) {
    errors.push({ field: 'title', message: 'title must be at least 2 characters' });
  } else if (body.title.trim().length > MAX_TITLE_LENGTH) {
    errors.push({ field: 'title', message: 'title must be at most 200 characters' });
  }

  if (!isNonEmptyString(body.author)) {
    errors.push({ field: 'author', message: 'author is required' });
  }

  const publishedYear = toPositiveInt(body.publishedYear);
  if (publishedYear === null) {
    errors.push({ field: 'publishedYear', message: 'publishedYear must be a positive integer' });
  } else if (publishedYear < EARLIEST_PUBLICATION_YEAR || publishedYear > currentYear) {
    errors.push({
      field: 'publishedYear',
      message: `publishedYear must be between ${EARLIEST_PUBLICATION_YEAR} and ${currentYear}`,
    });
  }

  const totalCopies = toPositiveInt(body.totalCopies);
  if (totalCopies === null) {
    errors.push({ field: 'totalCopies', message: 'totalCopies must be a positive integer' });
  } else if (totalCopies > 1000) {
    errors.push({ field: 'totalCopies', message: 'totalCopies must be at most 1000' });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      isbn: normalizeIsbn(body.isbn as string),
      title: (body.title as string).trim(),
      author: (body.author as string).trim(),
      publishedYear: publishedYear as number,
      totalCopies: totalCopies as number,
    },
  };
}

export interface UpdateBookInput {
  title?: string;
  author?: string;
  totalCopies?: number;
}

export function validateUpdateBook(input: unknown): ValidationResult<UpdateBookInput> {
  const body = asRecord(input);
  const errors: FieldError[] = [];
  const value: UpdateBookInput = {};

  if (body.title !== undefined) {
    if (!isNonEmptyString(body.title) || body.title.trim().length < MIN_TITLE_LENGTH) {
      errors.push({ field: 'title', message: 'title must be at least 2 characters' });
    } else {
      value.title = body.title.trim();
    }
  }

  if (body.author !== undefined) {
    if (!isNonEmptyString(body.author)) {
      errors.push({ field: 'author', message: 'author must be a non-empty string' });
    } else {
      value.author = body.author.trim();
    }
  }

  if (body.totalCopies !== undefined) {
    const totalCopies = toPositiveInt(body.totalCopies);
    if (totalCopies === null) {
      errors.push({ field: 'totalCopies', message: 'totalCopies must be a positive integer' });
    } else {
      value.totalCopies = totalCopies;
    }
  }

  if (Object.keys(value).length === 0 && errors.length === 0) {
    errors.push({ field: 'body', message: 'at least one updatable field must be provided' });
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true, value };
}

export interface CreateMemberInput {
  name: string;
  email: string;
  tier: MemberTier;
  membershipMonths: number;
}

export function validateCreateMember(input: unknown): ValidationResult<CreateMemberInput> {
  const body = asRecord(input);
  const errors: FieldError[] = [];

  if (!isNonEmptyString(body.name)) {
    errors.push({ field: 'name', message: 'name is required' });
  } else if (body.name.trim().length < 2) {
    errors.push({ field: 'name', message: 'name must be at least 2 characters' });
  }

  if (!isValidEmail(body.email)) {
    errors.push({ field: 'email', message: 'email must be a valid email address' });
  }

  const tier = body.tier === undefined ? 'STANDARD' : body.tier;
  if (!isMemberTier(tier)) {
    errors.push({ field: 'tier', message: `tier must be one of ${MEMBER_TIERS.join(', ')}` });
  }

  const membershipMonths =
    body.membershipMonths === undefined ? 12 : toPositiveInt(body.membershipMonths);
  if (membershipMonths === null) {
    errors.push({ field: 'membershipMonths', message: 'membershipMonths must be a positive integer' });
  } else if (membershipMonths > 60) {
    errors.push({ field: 'membershipMonths', message: 'membershipMonths must be at most 60' });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      name: (body.name as string).trim(),
      email: (body.email as string).trim().toLowerCase(),
      tier: tier as MemberTier,
      membershipMonths: membershipMonths as number,
    },
  };
}

export interface BorrowInput {
  bookId: number;
  memberId: number;
}

export function validateBorrowInput(input: unknown): ValidationResult<BorrowInput> {
  const body = asRecord(input);
  const errors: FieldError[] = [];

  const bookId = toPositiveInt(body.bookId);
  if (bookId === null) {
    errors.push({ field: 'bookId', message: 'bookId must be a positive integer' });
  }

  const memberId = toPositiveInt(body.memberId);
  if (memberId === null) {
    errors.push({ field: 'memberId', message: 'memberId must be a positive integer' });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value: { bookId: bookId as number, memberId: memberId as number } };
}
