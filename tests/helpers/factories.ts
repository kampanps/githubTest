import type { Book, Member, MemberTier } from '../../src/domain/types';
import type { TestHarness } from './testApp';

let isbnCounter = 0;

/** Builds a structurally valid ISBN-13 so factories never trip validation. */
export function nextIsbn13(): string {
  isbnCounter += 1;
  const base = `978${String(isbnCounter).padStart(9, '0')}`;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return `${base}${check}`;
}

export function resetIsbnCounter(): void {
  isbnCounter = 0;
}

export interface BookOverrides {
  isbn?: string;
  title?: string;
  author?: string;
  publishedYear?: number;
  totalCopies?: number;
}

export function makeBook(harness: TestHarness, overrides: BookOverrides = {}): Book {
  return harness.container.repos.books.insert(
    {
      isbn: overrides.isbn ?? nextIsbn13(),
      title: overrides.title ?? 'A Test Book',
      author: overrides.author ?? 'Test Author',
      publishedYear: overrides.publishedYear ?? 2020,
      totalCopies: overrides.totalCopies ?? 1,
    },
    harness.now().toISOString(),
  );
}

let memberCounter = 0;

export interface MemberOverrides {
  name?: string;
  email?: string;
  tier?: MemberTier;
  /** Days from "now" until the membership lapses. Negative means already expired. */
  membershipDays?: number;
}

export function makeMember(harness: TestHarness, overrides: MemberOverrides = {}): Member {
  memberCounter += 1;
  const now = harness.now();
  const membershipDays = overrides.membershipDays ?? 365;

  return harness.container.repos.members.insert({
    name: overrides.name ?? `Member ${memberCounter}`,
    email: overrides.email ?? `member${memberCounter}@example.com`,
    tier: overrides.tier ?? 'STANDARD',
    joinedAt: now.toISOString(),
    membershipExpiresAt: new Date(now.getTime() + membershipDays * 24 * 60 * 60 * 1000).toISOString(),
  });
}

export function resetMemberCounter(): void {
  memberCounter = 0;
}
