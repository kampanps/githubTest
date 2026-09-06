import { ConflictError, NotFoundError } from '../domain/errors';
import { formatCents } from '../domain/fines';
import type { Fine, FineStatus } from '../domain/types';
import type { ServiceContext } from './types';

export interface FineStatement {
  memberId: number;
  fines: Fine[];
  unpaidCents: number;
  unpaidFormatted: string;
}

export interface FineService {
  statement(memberId: number, status?: FineStatus): FineStatement;
  pay(fineId: number): Fine;
  waive(fineId: number): Fine;
}

export function createFineService({ repos, clock }: ServiceContext): FineService {
  function settle(fineId: number, status: 'PAID' | 'WAIVED'): Fine {
    const fine = repos.fines.findById(fineId);
    if (!fine) {
      throw new NotFoundError('Fine', fineId);
    }
    if (fine.status !== 'UNPAID') {
      throw new ConflictError('FINE_ALREADY_SETTLED', `This fine is already ${fine.status}`);
    }
    return repos.fines.settle(fineId, status, clock().toISOString()) as Fine;
  }

  return {
    statement(memberId, status) {
      if (!repos.members.findById(memberId)) {
        throw new NotFoundError('Member', memberId);
      }

      const unpaidCents = repos.fines.sumUnpaidByMember(memberId);
      return {
        memberId,
        fines: repos.fines.listByMember(memberId, status),
        unpaidCents,
        unpaidFormatted: formatCents(unpaidCents),
      };
    },

    pay(fineId) {
      return settle(fineId, 'PAID');
    },

    waive(fineId) {
      return settle(fineId, 'WAIVED');
    },
  };
}
