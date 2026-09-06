import { addDays } from '../domain/dates';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors';
import { buildPage, parsePagination, type Page } from '../domain/pagination';
import { getTierPolicy } from '../domain/policy';
import type { Loan, Member, MemberStatus, MemberTier } from '../domain/types';
import { isMemberTier, validateCreateMember } from '../domain/validation';
import type { ServiceContext } from './types';

const DAYS_PER_MONTH = 30;

export interface MemberSummary {
  member: Member;
  activeLoans: Loan[];
  loanAllowance: { used: number; max: number; remaining: number };
  unpaidFineCents: number;
}

export interface MemberService {
  create(input: unknown): Member;
  getById(id: number): Member;
  list(query: Record<string, unknown>): Page<Member>;
  setStatus(id: number, status: MemberStatus): Member;
  renewMembership(id: number, months: number): Member;
  summary(id: number): MemberSummary;
}

export function createMemberService({ repos, clock }: ServiceContext): MemberService {
  function requireMember(id: number): Member {
    const member = repos.members.findById(id);
    if (!member) {
      throw new NotFoundError('Member', id);
    }
    return member;
  }

  return {
    create(input) {
      const result = validateCreateMember(input);
      if (!result.valid) {
        throw new ValidationError(result.errors);
      }

      if (repos.members.findByEmail(result.value.email)) {
        throw new ConflictError('EMAIL_ALREADY_REGISTERED', `${result.value.email} is already registered`);
      }

      const now = clock();
      return repos.members.insert({
        name: result.value.name,
        email: result.value.email,
        tier: result.value.tier,
        joinedAt: now.toISOString(),
        membershipExpiresAt: addDays(now, result.value.membershipMonths * DAYS_PER_MONTH).toISOString(),
      });
    },

    getById(id) {
      return requireMember(id);
    },

    list(query) {
      const pagination = parsePagination(query);
      const tier = isMemberTier(query.tier) ? (query.tier as MemberTier) : undefined;
      const status =
        query.status === 'ACTIVE' || query.status === 'SUSPENDED' ? (query.status as MemberStatus) : undefined;

      const { rows, total } = repos.members.list(
        {
          tier,
          status,
          search: typeof query.search === 'string' ? query.search : undefined,
        },
        pagination,
      );

      return buildPage(rows, total, pagination);
    },

    setStatus(id, status) {
      const member = requireMember(id);
      if (member.status === status) {
        throw new ConflictError('STATUS_UNCHANGED', `Member is already ${status}`);
      }
      return repos.members.setStatus(id, status) as Member;
    },

    renewMembership(id, months) {
      requireMember(id);
      if (!Number.isInteger(months) || months <= 0 || months > 60) {
        throw new ValidationError([{ field: 'months', message: 'months must be an integer between 1 and 60' }]);
      }

      // Renewals always extend from today - a lapsed membership does not get
      // back-dated credit for the time it was expired.
      const expiresAt = addDays(clock(), months * DAYS_PER_MONTH);
      return repos.members.setMembershipExpiry(id, expiresAt.toISOString()) as Member;
    },

    summary(id) {
      const member = requireMember(id);
      const { rows: activeLoans } = repos.loans.list(
        { memberId: id, status: 'ACTIVE' },
        { page: 1, limit: 100, offset: 0 },
      );
      const max = getTierPolicy(member.tier).maxActiveLoans;

      return {
        member,
        activeLoans,
        loanAllowance: {
          used: activeLoans.length,
          max,
          remaining: Math.max(0, max - activeLoans.length),
        },
        unpaidFineCents: repos.fines.sumUnpaidByMember(id),
      };
    },
  };
}
