/**
 * ISBN-10 / ISBN-13 validation.
 * Self-contained and branch-heavy, which makes it a good unit-test target.
 */

export function normalizeIsbn(raw: string): string {
  if (typeof raw !== 'string') {
    throw new TypeError('isbn must be a string');
  }
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

export function isValidIsbn10(raw: string): boolean {
  const isbn = normalizeIsbn(raw);
  if (!/^\d{9}[\dX]$/.test(isbn)) {
    return false;
  }
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(isbn[i]) * (10 - i);
  }
  const checkChar = isbn[9];
  sum += checkChar === 'X' ? 10 : Number(checkChar);
  return sum % 11 === 0;
}

export function isValidIsbn13(raw: string): boolean {
  const isbn = normalizeIsbn(raw);
  if (!/^\d{13}$/.test(isbn)) {
    return false;
  }
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === Number(isbn[12]);
}

export function isValidIsbn(raw: string): boolean {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return false;
  }
  const isbn = normalizeIsbn(raw);
  if (isbn.length === 10) {
    return isValidIsbn10(isbn);
  }
  if (isbn.length === 13) {
    return isValidIsbn13(isbn);
  }
  return false;
}
