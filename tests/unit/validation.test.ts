import {
  isMemberTier,
  isNonEmptyString,
  isValidEmail,
  toNonNegativeInt,
  toPositiveInt,
  validateBorrowInput,
  validateCreateBook,
  validateCreateMember,
  validateUpdateBook,
} from '../../src/domain/validation';

function fieldsIn(result: ReturnType<typeof validateCreateBook>): string[] {
  return result.valid ? [] : result.errors.map((e) => e.field);
}

describe('isNonEmptyString', () => {
  it.each([
    ['a word', 'hello', true],
    ['a padded word', '  hello  ', true],
    ['an empty string', '', false],
    ['whitespace only', '   ', false],
  ])('%s -> %s', (_label, value, expected) => {
    expect(isNonEmptyString(value)).toBe(expected);
  });

  it.each([[0], [null], [undefined], [{}], [[]]])('rejects the non-string %p', (value) => {
    expect(isNonEmptyString(value)).toBe(false);
  });
});

describe('isValidEmail', () => {
  it.each(['a@b.co', 'first.last@example.com', 'user+tag@sub.domain.org'])('accepts %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each(['', 'no-at-sign', 'a@b', 'a@b.c', 'spaces in@example.com', '@example.com', 'a@@b.com'])(
    'rejects %p',
    (email) => {
      expect(isValidEmail(email)).toBe(false);
    },
  );

  it('rejects an address longer than 254 characters', () => {
    expect(isValidEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(isValidEmail(42)).toBe(false);
  });
});

describe('isMemberTier', () => {
  it.each(['STANDARD', 'PREMIUM', 'STAFF'])('accepts %s', (tier) => {
    expect(isMemberTier(tier)).toBe(true);
  });

  it.each(['standard', 'GOLD', '', null, 1])('rejects %p', (tier) => {
    expect(isMemberTier(tier)).toBe(false);
  });
});

describe('toPositiveInt', () => {
  it.each([
    [1, 1],
    [999, 999],
    ['1', 1],
    ['  42  ', 42],
  ])('converts %p to %i', (input, expected) => {
    expect(toPositiveInt(input)).toBe(expected);
  });

  it.each([[0], ['0'], [-1], ['-1'], [1.5], ['1.5'], ['abc'], [''], [null], [undefined], [{}], [Number.NaN]])(
    'rejects %p',
    (input) => {
      expect(toPositiveInt(input)).toBeNull();
    },
  );
});

describe('toNonNegativeInt', () => {
  it('accepts zero, unlike toPositiveInt', () => {
    expect(toNonNegativeInt(0)).toBe(0);
    expect(toNonNegativeInt('0')).toBe(0);
    expect(toPositiveInt(0)).toBeNull();
  });

  it('rejects a negative number', () => {
    expect(toNonNegativeInt(-5)).toBeNull();
  });

  it('rejects a non-numeric string', () => {
    expect(toNonNegativeInt('five')).toBeNull();
  });
});

describe('validateCreateBook', () => {
  const valid = {
    isbn: '9780132350884',
    title: 'Clean Code',
    author: 'Robert C. Martin',
    publishedYear: 2008,
    totalCopies: 3,
  };

  it('accepts a complete payload', () => {
    const result = validateCreateBook(valid, 2025);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual(valid);
    }
  });

  it('normalizes the ISBN and trims text', () => {
    const result = validateCreateBook({ ...valid, isbn: '978-0-13-235088-4', title: '  Clean Code  ' }, 2025);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.isbn).toBe('9780132350884');
      expect(result.value.title).toBe('Clean Code');
    }
  });

  it('reports every problem at once rather than the first', () => {
    const result = validateCreateBook({}, 2025);
    expect(fieldsIn(result)).toEqual(
      expect.arrayContaining(['isbn', 'title', 'author', 'publishedYear', 'totalCopies']),
    );
  });

  it('rejects a malformed ISBN', () => {
    expect(fieldsIn(validateCreateBook({ ...valid, isbn: '1234567890' }, 2025))).toContain('isbn');
  });

  it('rejects a one-character title', () => {
    expect(fieldsIn(validateCreateBook({ ...valid, title: 'A' }, 2025))).toContain('title');
  });

  it('rejects an over-long title', () => {
    expect(fieldsIn(validateCreateBook({ ...valid, title: 'x'.repeat(201) }, 2025))).toContain('title');
  });

  it('rejects a publication year in the future', () => {
    expect(fieldsIn(validateCreateBook({ ...valid, publishedYear: 2026 }, 2025))).toContain('publishedYear');
  });

  it('accepts the current year', () => {
    expect(validateCreateBook({ ...valid, publishedYear: 2025 }, 2025).valid).toBe(true);
  });

  it('rejects a year before printing existed', () => {
    expect(fieldsIn(validateCreateBook({ ...valid, publishedYear: 1200 }, 2025))).toContain('publishedYear');
  });

  it.each([[0], [-1], ['three'], [2.5]])('rejects totalCopies %p', (totalCopies) => {
    expect(fieldsIn(validateCreateBook({ ...valid, totalCopies }, 2025))).toContain('totalCopies');
  });

  it('rejects an absurd number of copies', () => {
    expect(fieldsIn(validateCreateBook({ ...valid, totalCopies: 1001 }, 2025))).toContain('totalCopies');
  });

  it.each([[null], [undefined], ['a string'], [[]], [42]])('treats %p as an empty body', (input) => {
    expect(validateCreateBook(input, 2025).valid).toBe(false);
  });
});

describe('validateUpdateBook', () => {
  it('accepts a single field', () => {
    const result = validateUpdateBook({ title: 'New Title' });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({ title: 'New Title' });
    }
  });

  it('ignores fields that were not supplied', () => {
    const result = validateUpdateBook({ totalCopies: 5 });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.title).toBeUndefined();
      expect(result.value.author).toBeUndefined();
    }
  });

  it('rejects an empty body', () => {
    const result = validateUpdateBook({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.field).toBe('body');
    }
  });

  it('rejects a bad value even when other fields are fine', () => {
    const result = validateUpdateBook({ title: 'Fine', totalCopies: -2 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((e) => e.field)).toEqual(['totalCopies']);
    }
  });

  it('rejects a blank author', () => {
    expect(validateUpdateBook({ author: '   ' }).valid).toBe(false);
  });
});

describe('validateCreateMember', () => {
  const valid = { name: 'Somchai', email: 'somchai@example.com' };

  it('defaults tier to STANDARD and membership to 12 months', () => {
    const result = validateCreateMember(valid);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.tier).toBe('STANDARD');
      expect(result.value.membershipMonths).toBe(12);
    }
  });

  it('lowercases the email', () => {
    const result = validateCreateMember({ ...valid, email: 'Somchai@Example.COM' });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.email).toBe('somchai@example.com');
    }
  });

  it('rejects a one-character name', () => {
    const result = validateCreateMember({ ...valid, name: 'S' });
    expect(result.valid).toBe(false);
  });

  it('rejects an unknown tier', () => {
    const result = validateCreateMember({ ...valid, tier: 'GOLD' });
    expect(result.valid).toBe(false);
  });

  it('rejects a membership longer than 60 months', () => {
    expect(validateCreateMember({ ...valid, membershipMonths: 61 }).valid).toBe(false);
  });

  it('accepts exactly 60 months', () => {
    expect(validateCreateMember({ ...valid, membershipMonths: 60 }).valid).toBe(true);
  });
});

describe('validateBorrowInput', () => {
  it('accepts numeric ids', () => {
    const result = validateBorrowInput({ bookId: 1, memberId: 2 });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({ bookId: 1, memberId: 2 });
    }
  });

  it('accepts numeric strings', () => {
    const result = validateBorrowInput({ bookId: '10', memberId: '20' });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({ bookId: 10, memberId: 20 });
    }
  });

  it('reports both missing ids', () => {
    const result = validateBorrowInput({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((e) => e.field)).toEqual(['bookId', 'memberId']);
    }
  });

  it('rejects a zero id', () => {
    expect(validateBorrowInput({ bookId: 0, memberId: 1 }).valid).toBe(false);
  });
});
