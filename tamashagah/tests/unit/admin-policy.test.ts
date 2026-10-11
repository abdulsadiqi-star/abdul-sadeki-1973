import { describe, expect, it } from 'vitest';
import {
  ADMIN_ONLY_ACTION_TYPES,
  CAPABILITY_MIN_ROLE,
  MONETIZATION_DECISION_TARGET,
  auditScopeFor,
  canSeeAuditRow,
  canTransitionMonetization,
  canTransitionReport,
  canTransitionTicket,
  canTransitionVerification,
  capabilitiesOf,
  checkTargetUser,
  evaluateRoleChange,
  evaluateUserRestore,
  evaluateUserSuspension,
  isReportOpen,
  monetizationDecisionsFrom,
  resolveMemberRole,
  roleCan,
  type Capability,
} from '@/features/admin/policy';
import {
  ModerationActionType,
  MonetizationStatus,
  ReportStatus,
  TicketStatus,
  UserRole,
  VerificationStatus,
} from '@/generated/prisma/enums';

const roles = Object.values(UserRole);
const capabilities = Object.keys(CAPABILITY_MIN_ROLE) as Capability[];

const MODERATOR_CAPABILITIES: Capability[] = [
  'panel.access',
  'reports.handle',
  'video.takedown',
  'video.restore',
  'comment.delete',
  'comment.restore',
  'commenter.block',
  'channel.suspend',
  'channel.restore',
  'channel.verify',
  'creator.warn',
  'user.view',
  'verification.review',
  'ticket.handle',
  'audit.view.scoped',
];
const ADMIN_ONLY_CAPABILITIES: Capability[] = [
  'video.delete',
  'user.role.change',
  'user.suspend',
  'user.restore',
  'monetization.review',
  'audit.view.all',
];

describe('capability matrix', () => {
  it('covers every capability exactly once (moderator set + admin-only set)', () => {
    expect([...MODERATOR_CAPABILITIES, ...ADMIN_ONLY_CAPABILITIES].sort()).toEqual([...capabilities].sort());
  });

  it('visitors, users and creators can do nothing in the panel', () => {
    for (const cap of capabilities) {
      expect(roleCan(null, cap)).toBe(false);
      expect(roleCan(undefined, cap)).toBe(false);
      expect(roleCan('USER', cap)).toBe(false);
      expect(roleCan('CREATOR', cap)).toBe(false);
    }
  });

  it('moderators get exactly the moderator capabilities', () => {
    expect(capabilitiesOf('MODERATOR').sort()).toEqual([...MODERATOR_CAPABILITIES].sort());
  });

  it('administrators get everything', () => {
    expect(capabilitiesOf('ADMIN').sort()).toEqual([...capabilities].sort());
  });

  it.each(ADMIN_ONLY_CAPABILITIES)('%s is administrator-only', (cap) => {
    expect(roleCan('MODERATOR', cap)).toBe(false);
    expect(roleCan('ADMIN', cap)).toBe(true);
  });
});

describe('checkTargetUser (self / moderator-on-admin rules)', () => {
  const mod = { id: 'm1', role: 'MODERATOR' as const };
  const admin = { id: 'a1', role: 'ADMIN' as const };

  it('denies roles without the capability before anything else', () => {
    expect(checkTargetUser({ id: 'u1', role: 'CREATOR' }, { id: 'x', role: 'USER' }, 'video.takedown')).toMatchObject({ ok: false, reason: 'ROLE' });
    expect(checkTargetUser(mod, { id: 'x', role: 'USER' }, 'video.delete')).toMatchObject({ ok: false, reason: 'ROLE' });
  });

  it('nobody can act on their own content or account', () => {
    expect(checkTargetUser(mod, { id: 'm1', role: 'MODERATOR' }, 'video.takedown')).toMatchObject({ ok: false, reason: 'SELF' });
    expect(checkTargetUser(admin, { id: 'a1', role: 'ADMIN' }, 'channel.suspend')).toMatchObject({ ok: false, reason: 'SELF' });
  });

  it('moderators cannot touch administrators, administrators can touch each other and moderators', () => {
    expect(checkTargetUser(mod, { id: 'a1', role: 'ADMIN' }, 'comment.delete')).toMatchObject({ ok: false, reason: 'MODERATOR_ON_ADMIN' });
    expect(checkTargetUser(admin, { id: 'a2', role: 'ADMIN' }, 'channel.suspend')).toEqual({ ok: true });
    expect(checkTargetUser(admin, { id: 'm1', role: 'MODERATOR' }, 'channel.suspend')).toEqual({ ok: true });
  });

  it('moderators may act on other moderators, creators and users', () => {
    for (const role of ['MODERATOR', 'CREATOR', 'USER'] as const) {
      expect(checkTargetUser(mod, { id: 'someone', role }, 'video.takedown')).toEqual({ ok: true });
    }
  });

  it('content without an owner (account deleted) can still be handled', () => {
    expect(checkTargetUser(mod, null, 'video.takedown')).toEqual({ ok: true });
  });

  it('gives Persian reasons', () => {
    const verdict = checkTargetUser(mod, { id: 'a1', role: 'ADMIN' }, 'video.takedown');
    expect(verdict.ok === false && verdict.message).toMatch(/مدیران/);
  });
});

describe('role changes', () => {
  const admin = { id: 'a1', role: 'ADMIN' as const };
  const mod = { id: 'm1', role: 'MODERATOR' as const };
  const user = (over: Partial<{ id: string; role: UserRole; status: 'ACTIVE' | 'SUSPENDED'; hasChannel: boolean }> = {}) => ({
    id: 'u1',
    role: 'USER' as UserRole,
    status: 'ACTIVE' as const,
    hasChannel: false,
    ...over,
  });

  it('a moderator can never grant roles', () => {
    for (const requestedRole of roles) {
      const verdict = evaluateRoleChange({ actor: mod, target: user(), requestedRole, activeAdminsExcludingTarget: 3 });
      expect(verdict).toMatchObject({ ok: false, reason: 'ROLE' });
    }
  });

  it('an administrator can promote and demote', () => {
    expect(evaluateRoleChange({ actor: admin, target: user(), requestedRole: 'MODERATOR', activeAdminsExcludingTarget: 1 })).toEqual({ ok: true, role: 'MODERATOR' });
    expect(evaluateRoleChange({ actor: admin, target: user({ id: 'm2', role: 'MODERATOR' }), requestedRole: 'ADMIN', activeAdminsExcludingTarget: 1 })).toEqual({ ok: true, role: 'ADMIN' });
    expect(evaluateRoleChange({ actor: admin, target: user({ id: 'a2', role: 'ADMIN' }), requestedRole: 'MODERATOR', activeAdminsExcludingTarget: 1 })).toEqual({ ok: true, role: 'MODERATOR' });
  });

  it('nobody changes their own role', () => {
    const verdict = evaluateRoleChange({ actor: admin, target: user({ id: 'a1', role: 'ADMIN' }), requestedRole: 'MODERATOR', activeAdminsExcludingTarget: 2 });
    expect(verdict).toMatchObject({ ok: false, reason: 'SELF' });
  });

  it('the last active administrator cannot be demoted (and gets the precise explanation even when acting on themselves)', () => {
    const lastAdmin = user({ id: 'a1', role: 'ADMIN' });
    expect(evaluateRoleChange({ actor: admin, target: lastAdmin, requestedRole: 'USER', activeAdminsExcludingTarget: 0 })).toMatchObject({ ok: false, reason: 'LAST_ADMIN' });
    // defensive: also when someone else somehow tries it
    expect(evaluateRoleChange({ actor: { id: 'zz', role: 'ADMIN' }, target: lastAdmin, requestedRole: 'MODERATOR', activeAdminsExcludingTarget: 0 })).toMatchObject({ ok: false, reason: 'LAST_ADMIN' });
  });

  it('USER and CREATOR are derived from channel ownership', () => {
    expect(resolveMemberRole('USER', true)).toBe('CREATOR');
    expect(resolveMemberRole('CREATOR', false)).toBe('USER');
    expect(resolveMemberRole('MODERATOR', true)).toBe('MODERATOR');
    // demoting a moderator who owns a channel lands on CREATOR whichever "member" role was asked for
    const demote = evaluateRoleChange({ actor: admin, target: user({ id: 'm2', role: 'MODERATOR', hasChannel: true }), requestedRole: 'USER', activeAdminsExcludingTarget: 1 });
    expect(demote).toEqual({ ok: true, role: 'CREATOR' });
  });

  it('rejects no-op changes', () => {
    expect(evaluateRoleChange({ actor: admin, target: user({ role: 'USER' }), requestedRole: 'CREATOR', activeAdminsExcludingTarget: 1 })).toMatchObject({ ok: false, reason: 'NO_CHANGE' });
    expect(evaluateRoleChange({ actor: admin, target: user({ role: 'MODERATOR' }), requestedRole: 'MODERATOR', activeAdminsExcludingTarget: 1 })).toMatchObject({ ok: false, reason: 'NO_CHANGE' });
  });
});

describe('user suspension', () => {
  const admin = { id: 'a1', role: 'ADMIN' as const };
  const target = (over: Partial<{ id: string; role: UserRole; status: 'ACTIVE' | 'SUSPENDED' }> = {}) => ({ id: 'u1', role: 'USER' as UserRole, status: 'ACTIVE' as const, ...over });

  it('moderators can neither suspend nor restore users', () => {
    const mod = { id: 'm1', role: 'MODERATOR' as const };
    expect(evaluateUserSuspension({ actor: mod, target: target(), activeAdminsExcludingTarget: 2 })).toMatchObject({ ok: false, reason: 'ROLE' });
    expect(evaluateUserRestore({ actor: mod, target: target({ status: 'SUSPENDED' }) })).toMatchObject({ ok: false, reason: 'ROLE' });
  });

  it('administrators can suspend and restore', () => {
    expect(evaluateUserSuspension({ actor: admin, target: target(), activeAdminsExcludingTarget: 2 })).toEqual({ ok: true });
    expect(evaluateUserRestore({ actor: admin, target: target({ status: 'SUSPENDED' }) })).toEqual({ ok: true });
  });

  it('is not repeatable', () => {
    expect(evaluateUserSuspension({ actor: admin, target: target({ status: 'SUSPENDED' }), activeAdminsExcludingTarget: 2 })).toMatchObject({ ok: false, reason: 'NO_CHANGE' });
    expect(evaluateUserRestore({ actor: admin, target: target() })).toMatchObject({ ok: false, reason: 'NO_CHANGE' });
  });

  it('protects the last administrator and the actor themselves', () => {
    expect(evaluateUserSuspension({ actor: admin, target: target({ id: 'a1', role: 'ADMIN' }), activeAdminsExcludingTarget: 0 })).toMatchObject({ ok: false, reason: 'LAST_ADMIN' });
    expect(evaluateUserSuspension({ actor: admin, target: target({ id: 'a1', role: 'ADMIN' }), activeAdminsExcludingTarget: 1 })).toMatchObject({ ok: false, reason: 'SELF' });
    // another admin can be suspended while at least one other stays active
    expect(evaluateUserSuspension({ actor: admin, target: target({ id: 'a2', role: 'ADMIN' }), activeAdminsExcludingTarget: 1 })).toEqual({ ok: true });
    // a suspended admin no longer counts as "the last admin"
    expect(evaluateUserSuspension({ actor: admin, target: target({ id: 'a2', role: 'ADMIN', status: 'SUSPENDED' }), activeAdminsExcludingTarget: 0 })).toMatchObject({ ok: false, reason: 'NO_CHANGE' });
  });
});

/** Every (from, to) pair of an enum, so each state machine is tested exhaustively against a hand-written table. */
function pairs<S extends string>(values: readonly S[]): [S, S][] {
  return values.flatMap((from) => values.map((to) => [from, to] as [S, S]));
}

function expectTable<S extends string>(values: readonly S[], allowed: readonly [S, S][], can: (from: S, to: S) => boolean) {
  const allowedKeys = new Set(allowed.map(([a, b]) => `${a}>${b}`));
  for (const [from, to] of pairs(values)) {
    expect(can(from, to), `${from} → ${to}`).toBe(allowedKeys.has(`${from}>${to}`));
  }
}

describe('state machines', () => {
  it('reports: OPEN → REVIEWING → ACTIONED | DISMISSED, decisions are final', () => {
    expectTable(
      Object.values(ReportStatus),
      [
        ['OPEN', 'REVIEWING'],
        ['OPEN', 'ACTIONED'],
        ['OPEN', 'DISMISSED'],
        ['REVIEWING', 'ACTIONED'],
        ['REVIEWING', 'DISMISSED'],
      ],
      canTransitionReport,
    );
    expect(isReportOpen('OPEN')).toBe(true);
    expect(isReportOpen('REVIEWING')).toBe(true);
    expect(isReportOpen('ACTIONED')).toBe(false);
    expect(isReportOpen('DISMISSED')).toBe(false);
  });

  it('monetization: only SUBMITTED / UNDER_REVIEW can be decided; APPROVED ⇄ SUSPENDED; DRAFT is the creator’s', () => {
    expectTable(
      Object.values(MonetizationStatus),
      [
        ['SUBMITTED', 'UNDER_REVIEW'],
        ['SUBMITTED', 'APPROVED'],
        ['SUBMITTED', 'REJECTED'],
        ['UNDER_REVIEW', 'APPROVED'],
        ['UNDER_REVIEW', 'REJECTED'],
        ['APPROVED', 'SUSPENDED'],
        ['SUSPENDED', 'APPROVED'],
      ],
      canTransitionMonetization,
    );
  });

  it.each([
    ['DRAFT', []],
    ['SUBMITTED', ['APPROVE', 'REJECT']],
    ['UNDER_REVIEW', ['APPROVE', 'REJECT']],
    ['APPROVED', ['SUSPEND']],
    ['REJECTED', []],
    ['SUSPENDED', ['REINSTATE']],
  ] as const)('monetization decisions available from %s', (status, expected) => {
    expect(monetizationDecisionsFrom(status).sort()).toEqual([...expected].sort());
  });

  it('monetization decisions map to the right target status', () => {
    expect(MONETIZATION_DECISION_TARGET).toEqual({ APPROVE: 'APPROVED', REJECT: 'REJECTED', SUSPEND: 'SUSPENDED', REINSTATE: 'APPROVED' });
  });

  it('verification: SUBMITTED / UNDER_REVIEW can be decided, then final', () => {
    expectTable(
      Object.values(VerificationStatus),
      [
        ['SUBMITTED', 'UNDER_REVIEW'],
        ['SUBMITTED', 'APPROVED'],
        ['SUBMITTED', 'REJECTED'],
        ['UNDER_REVIEW', 'APPROVED'],
        ['UNDER_REVIEW', 'REJECTED'],
      ],
      canTransitionVerification,
    );
  });

  it('tickets: reply keeps ANSWERED, close from OPEN/ANSWERED, reopen only from CLOSED', () => {
    expectTable(
      Object.values(TicketStatus),
      [
        ['OPEN', 'ANSWERED'],
        ['OPEN', 'CLOSED'],
        ['ANSWERED', 'ANSWERED'],
        ['ANSWERED', 'CLOSED'],
        ['CLOSED', 'OPEN'],
      ],
      canTransitionTicket,
    );
  });
});

describe('audit-log visibility', () => {
  it('administrators see everything, moderators are scoped to themselves, nobody else sees anything', () => {
    expect(auditScopeFor({ id: 'a', role: 'ADMIN' })).toEqual({ kind: 'all' });
    expect(auditScopeFor({ id: 'm', role: 'MODERATOR' })).toEqual({ kind: 'scoped', actorId: 'm' });
    expect(auditScopeFor({ id: 'c', role: 'CREATOR' })).toBeNull();
    expect(auditScopeFor({ id: 'u', role: 'USER' })).toBeNull();
  });

  it('moderators see content moderation by anybody but not account / money decisions of others', () => {
    const scope = { kind: 'scoped', actorId: 'm1' } as const;
    for (const type of Object.values(ModerationActionType)) {
      const adminOnly = (ADMIN_ONLY_ACTION_TYPES as readonly string[]).includes(type);
      expect(canSeeAuditRow(scope, { actorId: 'other', type }), `${type} by someone else`).toBe(!adminOnly);
      expect(canSeeAuditRow(scope, { actorId: 'm1', type }), `${type} by themselves`).toBe(true);
    }
    expect(canSeeAuditRow({ kind: 'all' }, { actorId: 'x', type: 'USER_ROLE_CHANGE' })).toBe(true);
  });

  it('the creators’ studio moderation rows (actor = channel owner) count as content moderation', () => {
    expect(canSeeAuditRow({ kind: 'scoped', actorId: 'm1' }, { actorId: 'creator-1', type: 'COMMENT_SPAM' })).toBe(true);
  });
});
