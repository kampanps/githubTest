import { loadConfig } from '../../src/config';
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  isAppError,
} from '../../src/domain/errors';

describe('AppError', () => {
  it('carries a status, a code and a message', () => {
    const error = new AppError(418, 'TEAPOT', 'I am a teapot');
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(418);
    expect(error.code).toBe('TEAPOT');
    expect(error.message).toBe('I am a teapot');
  });

  it('defaults details to null instead of undefined', () => {
    expect(new AppError(500, 'X', 'y').details).toBeNull();
  });

  it('keeps details when supplied', () => {
    expect(new AppError(400, 'X', 'y', { field: 'isbn' }).details).toEqual({ field: 'isbn' });
  });
});

describe('error subclasses', () => {
  it.each([
    [new ValidationError([{ field: 'a', message: 'bad' }]), 400, 'VALIDATION_ERROR'],
    [new UnauthorizedError(), 401, 'UNAUTHORIZED'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
    [new NotFoundError('Book', 7), 404, 'NOT_FOUND'],
    [new ConflictError('ISBN_ALREADY_EXISTS', 'duplicate'), 409, 'ISBN_ALREADY_EXISTS'],
    [new BusinessRuleError('LOAN_LIMIT_REACHED', 'too many'), 422, 'LOAN_LIMIT_REACHED'],
  ])('%s maps to %i / %s', (error, status, code) => {
    expect(error.statusCode).toBe(status);
    expect(error.code).toBe(code);
    expect(isAppError(error)).toBe(true);
  });

  it('names the missing resource in a NotFoundError', () => {
    expect(new NotFoundError('Member', 42).message).toBe('Member with id 42 was not found');
  });

  it('attaches the field errors to a ValidationError', () => {
    const error = new ValidationError([{ field: 'isbn', message: 'required' }]);
    expect(error.details).toEqual([{ field: 'isbn', message: 'required' }]);
  });
});

describe('isAppError', () => {
  it.each([
    ['a plain Error', new Error('boom')],
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
    ['an object that looks like one', { statusCode: 400, code: 'X' }],
  ])('is false for %s', (_label, value) => {
    expect(isAppError(value)).toBe(false);
  });
});

describe('loadConfig', () => {
  it('applies defaults for an empty environment', () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('development');
    expect(config.databasePath).toBe('./library.db');
  });

  it('reads values from the environment', () => {
    const config = loadConfig({
      PORT: '8080',
      NODE_ENV: 'production',
      DATABASE_PATH: '/data/library.db',
    } as NodeJS.ProcessEnv);
    expect(config.port).toBe(8080);
    expect(config.nodeEnv).toBe('production');
    expect(config.databasePath).toBe('/data/library.db');
  });

  it.each([['not-a-number'], ['0'], ['70000'], ['-1'], ['80.5']])(
    'falls back to 3000 for the invalid port %p',
    (port) => {
      expect(loadConfig({ PORT: port } as NodeJS.ProcessEnv).port).toBe(3000);
    },
  );

  it('maps each configured key to its role', () => {
    const config = loadConfig({
      API_KEY_ADMIN: 'a',
      API_KEY_LIBRARIAN: 'l',
      API_KEY_MEMBER: 'm',
    } as NodeJS.ProcessEnv);

    expect(config.apiKeys).toEqual({ a: 'ADMIN', l: 'LIBRARIAN', m: 'MEMBER' });
  });

  it('provides development defaults when no keys are set', () => {
    expect(Object.values(loadConfig({} as NodeJS.ProcessEnv).apiKeys).sort()).toEqual([
      'ADMIN',
      'LIBRARIAN',
      'MEMBER',
    ]);
  });
});
