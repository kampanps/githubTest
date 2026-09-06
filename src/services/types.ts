import type { Db } from '../db/connection';
import type { Clock } from '../domain/types';
import type { BookRepository } from '../repositories/bookRepository';
import type { FineRepository } from '../repositories/fineRepository';
import type { LoanRepository } from '../repositories/loanRepository';
import type { MemberRepository } from '../repositories/memberRepository';
import type { ReservationRepository } from '../repositories/reservationRepository';

export interface Repositories {
  books: BookRepository;
  members: MemberRepository;
  loans: LoanRepository;
  reservations: ReservationRepository;
  fines: FineRepository;
}

export interface ServiceContext {
  db: Db;
  repos: Repositories;
  clock: Clock;
}
