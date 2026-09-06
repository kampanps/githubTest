import { ValidationError } from '../domain/errors';
import { toPositiveInt } from '../domain/validation';

/** Route params arrive as strings; anything that is not a positive integer is a 400, not a 404. */
export function requireIdParam(raw: unknown, field = 'id'): number {
  const id = toPositiveInt(raw);
  if (id === null) {
    throw new ValidationError([{ field, message: `${field} must be a positive integer` }]);
  }
  return id;
}
