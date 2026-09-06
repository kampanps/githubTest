import type { AppConfig } from './config';
import type { Db } from './db/connection';
import type { Clock } from './domain/types';
import { createBookRepository } from './repositories/bookRepository';
import { createFineRepository } from './repositories/fineRepository';
import { createLoanRepository } from './repositories/loanRepository';
import { createMemberRepository } from './repositories/memberRepository';
import { createReservationRepository } from './repositories/reservationRepository';
import { createBookService, type BookService } from './services/bookService';
import { createFineService, type FineService } from './services/fineService';
import { createLoanService, type LoanService } from './services/loanService';
import { createMemberService, type MemberService } from './services/memberService';
import { createReservationService, type ReservationService } from './services/reservationService';
import type { Repositories, ServiceContext } from './services/types';

export interface Services {
  books: BookService;
  members: MemberService;
  loans: LoanService;
  reservations: ReservationService;
  fines: FineService;
}

export interface Container {
  config: AppConfig;
  db: Db;
  clock: Clock;
  repos: Repositories;
  services: Services;
}

export interface ContainerOptions {
  db: Db;
  config: AppConfig;
  /** Tests pass a frozen clock so that due dates and fines are deterministic. */
  clock?: Clock;
}

export function createContainer({ db, config, clock = () => new Date() }: ContainerOptions): Container {
  const repos: Repositories = {
    books: createBookRepository(db),
    members: createMemberRepository(db),
    loans: createLoanRepository(db),
    reservations: createReservationRepository(db),
    fines: createFineRepository(db),
  };

  const context: ServiceContext = { db, repos, clock };

  return {
    config,
    db,
    clock,
    repos,
    services: {
      books: createBookService(context),
      members: createMemberService(context),
      loans: createLoanService(context),
      reservations: createReservationService(context),
      fines: createFineService(context),
    },
  };
}
