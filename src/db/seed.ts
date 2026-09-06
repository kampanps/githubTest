import { loadConfig } from '../config';
import { createContainer } from '../container';
import { addDays } from '../domain/dates';
import { createDatabase } from './connection';
import { runMigrations } from './migrate';

const BOOKS = [
  { isbn: '9780132350884', title: 'Clean Code', author: 'Robert C. Martin', publishedYear: 2008, totalCopies: 3 },
  { isbn: '9780201616224', title: 'The Pragmatic Programmer', author: 'Andrew Hunt', publishedYear: 1999, totalCopies: 2 },
  { isbn: '9780134757599', title: 'Refactoring', author: 'Martin Fowler', publishedYear: 2018, totalCopies: 4 },
  { isbn: '9781449373320', title: 'Designing Data-Intensive Applications', author: 'Martin Kleppmann', publishedYear: 2017, totalCopies: 2 },
  { isbn: '0132350882', title: 'Working Effectively with Legacy Code', author: 'Michael Feathers', publishedYear: 2004, totalCopies: 1 },
];

const MEMBERS = [
  { name: 'Somchai Jaidee', email: 'somchai@example.com', tier: 'STANDARD' as const },
  { name: 'Napat Wong', email: 'napat@example.com', tier: 'PREMIUM' as const },
  { name: 'Library Staff', email: 'staff@example.com', tier: 'STAFF' as const },
];

export function seed(): void {
  const config = loadConfig();
  const db = createDatabase(config.databasePath);
  runMigrations(db);

  const container = createContainer({ db, config });
  const now = new Date();

  for (const book of BOOKS) {
    if (!container.repos.books.findByIsbn(book.isbn)) {
      container.repos.books.insert(book, now.toISOString());
    }
  }

  for (const member of MEMBERS) {
    if (!container.repos.members.findByEmail(member.email)) {
      container.repos.members.insert({
        ...member,
        joinedAt: now.toISOString(),
        membershipExpiresAt: addDays(now, 365).toISOString(),
      });
    }
  }

  console.log(`Seeded ${BOOKS.length} books and ${MEMBERS.length} members into ${config.databasePath}`);
  db.close();
}

if (require.main === module) {
  seed();
}
