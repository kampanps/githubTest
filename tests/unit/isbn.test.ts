import { isValidIsbn, isValidIsbn10, isValidIsbn13, normalizeIsbn } from '../../src/domain/isbn';

describe('normalizeIsbn', () => {
  it('strips hyphens and spaces', () => {
    expect(normalizeIsbn('978-0-13-235088-4')).toBe('9780132350884');
    expect(normalizeIsbn(' 0 306 40615 2 ')).toBe('0306406152');
  });

  it('uppercases the check character', () => {
    expect(normalizeIsbn('043942089x')).toBe('043942089X');
  });

  it('rejects a non-string', () => {
    expect(() => normalizeIsbn(12345 as unknown as string)).toThrow(TypeError);
  });
});

describe('isValidIsbn10', () => {
  it.each(['0306406152', '0-306-40615-2', '043942089X'])('accepts %s', (isbn) => {
    expect(isValidIsbn10(isbn)).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    expect(isValidIsbn10('0306406153')).toBe(false);
  });

  it('rejects the wrong length', () => {
    expect(isValidIsbn10('030640615')).toBe(false);
    expect(isValidIsbn10('03064061522')).toBe(false);
  });

  it('rejects an X anywhere but the last position', () => {
    expect(isValidIsbn10('X306406152')).toBe(false);
  });

  it('rejects letters', () => {
    expect(isValidIsbn10('abcdefghij')).toBe(false);
  });
});

describe('isValidIsbn13', () => {
  it.each(['9780132350884', '978-0-13-235088-4', '9780201616224'])('accepts %s', (isbn) => {
    expect(isValidIsbn13(isbn)).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    expect(isValidIsbn13('9780132350885')).toBe(false);
  });

  it('rejects an X check character (ISBN-13 is digits only)', () => {
    expect(isValidIsbn13('978013235088X')).toBe(false);
  });

  it('rejects the wrong length', () => {
    expect(isValidIsbn13('978013235088')).toBe(false);
  });

  it('handles the modulo-10 wrap in the check digit', () => {
    // 9*1 + 7*3 + 8*1 = 38, so the check digit must be (10 - 8) % 10 = 2.
    expect(isValidIsbn13('9780000000002')).toBe(true);
    expect(isValidIsbn13('9780000000000')).toBe(false);
  });
});

describe('isValidIsbn', () => {
  it('dispatches on length', () => {
    expect(isValidIsbn('0306406152')).toBe(true);
    expect(isValidIsbn('9780132350884')).toBe(true);
  });

  it('rejects lengths that are neither 10 nor 13', () => {
    expect(isValidIsbn('12345678901')).toBe(false);
  });

  it.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('rejects %s', (_label, value) => {
    expect(isValidIsbn(value)).toBe(false);
  });

  it.each([
    ['a number', 9780132350884 as unknown as string],
    ['null', null as unknown as string],
    ['undefined', undefined as unknown as string],
  ])('rejects %s without throwing', (_label, value) => {
    expect(isValidIsbn(value)).toBe(false);
  });
});
