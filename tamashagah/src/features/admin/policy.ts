/**
 * Authorization rules of the staff panel — pure functions, no I/O, unit-tested.
 *
 * THE MATRIX (enforced by the server in every action; the UI only mirrors it to hide controls)
 *
 *   MODERATOR  handle reports · take down / restore videos · delete / restore comments · suspend / restore channels
 *              · verify / unverify channels (verification requests) · block commenters · warn creators
 *              · answer support tickets · read the user directory · see own + content-moderation audit rows
 *   ADMIN      everything a moderator can, plus: change roles · suspend / restore users · decide monetization
 *              applications · force-delete videos · see the full audit log
 *
 * TARGET RULES (apply to the *user* who owns the affected content / account)
 *   - nobody can act on themselves (own videos, own channel, own account, own comments)
 *   - a moderator can never act on an administrator
 *   - the last active ADMIN can neither be demoted nor suspended
 *   - a moderator cannot grant roles at all
 */
import type {
  ModerationActionType,
  MonetizationStatus,
  ReportStatus,
  TicketStatus,
  UserRole,
  UserStatus,
  VerificationStatus,
} from '@/generated/prisma/enums';

export type StaffRole = Extract<UserRole, 'MODERATOR' | 'ADMIN'>;

const RANK: Record<UserRole, number> = { USER: 0, CREATOR: 1, MODERATOR: 2, ADMIN: 3 };

export const isStaffRole = (role: UserRole | null | undefined): role is StaffRole => role === 'MODERATOR' || role === 'ADMIN';

// ---------------------------------------------------------------------------
// Capability matrix
// ---------------------------------------------------------------------------

export type Capability =
  | 'panel.access'
  | 'reports.handle'
  | 'video.takedown'
  | 'video.restore'
  | 'video.delete'
  | 'comment.delete'
  | 'comment.restore'
  | 'commenter.block'
  | 'channel.suspend'
  | 'channel.restore'
  | 'channel.verify'
  | 'creator.warn'
  | 'user.view'
  | 'user.role.change'
  | 'user.suspend'
  | 'user.restore'
  | 'monetization.review'
  | 'verification.review'
  | 'ticket.handle'
  | 'audit.view.all'
  | 'audit.view.scoped';

/** Lowest role that may use each capability. */
export const CAPABILITY_MIN_ROLE: Record<Capability, StaffRole> = {
  'panel.access': 'MODERATOR',
  'reports.handle': 'MODERATOR',
  'video.takedown': 'MODERATOR',
  'video.restore': 'MODERATOR',
  'video.delete': 'ADMIN',
  'comment.delete': 'MODERATOR',
  'comment.restore': 'MODERATOR',
  'commenter.block': 'MODERATOR',
  'channel.suspend': 'MODERATOR',
  'channel.restore': 'MODERATOR',
  'channel.verify': 'MODERATOR',
  'creator.warn': 'MODERATOR',
  'user.view': 'MODERATOR',
  'user.role.change': 'ADMIN',
  'user.suspend': 'ADMIN',
  'user.restore': 'ADMIN',
  'monetization.review': 'ADMIN',
  'verification.review': 'MODERATOR',
  'ticket.handle': 'MODERATOR',
  'audit.view.all': 'ADMIN',
  'audit.view.scoped': 'MODERATOR',
};

export function roleCan(role: UserRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[CAPABILITY_MIN_ROLE[capability]];
}

/** Capabilities of a role (used by the UI to hide controls and by tests to snapshot the matrix). */
export function capabilitiesOf(role: UserRole | null | undefined): Capability[] {
  return (Object.keys(CAPABILITY_MIN_ROLE) as Capability[]).filter((c) => roleCan(role, c));
}

// ---------------------------------------------------------------------------
// Target rules
// ---------------------------------------------------------------------------

export type PolicyDenial = 'ROLE' | 'SELF' | 'MODERATOR_ON_ADMIN' | 'LAST_ADMIN' | 'NO_CHANGE';
export type PolicyResult = { ok: true } | { ok: false; reason: PolicyDenial; message: string };

export const POLICY_MESSAGES: Record<PolicyDenial, string> = {
  ROLE: 'شما اجازه‌ی انجام این کار را ندارید.',
  SELF: 'نمی‌توانید روی حساب یا محتوای خودتان اقدام مدیریتی انجام دهید.',
  MODERATOR_ON_ADMIN: 'ناظران نمی‌توانند روی حساب یا محتوای مدیران اقدام کنند.',
  LAST_ADMIN: 'این حساب آخرین مدیر فعال سامانه است؛ نقش یا وضعیت آن را نمی‌توان تغییر داد.',
  NO_CHANGE: 'وضعیت موردنظر از قبل همین است.',
};

const deny = (reason: PolicyDenial, message = POLICY_MESSAGES[reason]): PolicyResult => ({ ok: false, reason, message });
const OK: PolicyResult = { ok: true };

export type PolicyActor = { id: string; role: UserRole };
export type PolicyUser = { id: string; role: UserRole };

/**
 * May `actor` perform `capability` on content / an account that belongs to `owner`?
 * `owner` is the USER affected (video → channel owner, comment → its author, channel → its owner, ...).
 */
export function checkTargetUser(actor: PolicyActor, owner: PolicyUser | null, capability: Capability): PolicyResult {
  if (!roleCan(actor.role, capability)) return deny('ROLE');
  if (!owner) return OK; // orphaned content (owner deleted): nothing to protect
  if (owner.id === actor.id) return deny('SELF');
  if (actor.role !== 'ADMIN' && owner.role === 'ADMIN') return deny('MODERATOR_ON_ADMIN');
  return OK;
}

/** Roles a staff member can be given; USER/CREATOR are derived from channel ownership (see `resolveMemberRole`). */
export const ASSIGNABLE_ROLES = ['USER', 'CREATOR', 'MODERATOR', 'ADMIN'] as const satisfies readonly UserRole[];

/** USER and CREATOR only differ by owning a channel: whichever the caller asks for, the consistent one is stored. */
export function resolveMemberRole(requested: UserRole, hasChannel: boolean): UserRole {
  if (requested === 'USER' || requested === 'CREATOR') return hasChannel ? 'CREATOR' : 'USER';
  return requested;
}

export type RoleChangeInput = {
  actor: PolicyActor;
  target: { id: string; role: UserRole; status: UserStatus; hasChannel: boolean };
  requestedRole: UserRole;
  /** ACTIVE administrators other than the target (the actor counts when they are an admin). */
  activeAdminsExcludingTarget: number;
};

export function evaluateRoleChange(input: RoleChangeInput): PolicyResult & { role?: UserRole } {
  const { actor, target, requestedRole, activeAdminsExcludingTarget } = input;
  if (!roleCan(actor.role, 'user.role.change')) return deny('ROLE', 'فقط مدیران می‌توانند نقش کاربران را تغییر دهند.');
  const nextRole = resolveMemberRole(requestedRole, target.hasChannel);
  const losesAdmin = target.role === 'ADMIN' && nextRole !== 'ADMIN';
  // Checked before SELF so that the only administrator gets the precise explanation.
  if (losesAdmin && target.status === 'ACTIVE' && activeAdminsExcludingTarget <= 0) return deny('LAST_ADMIN');
  if (actor.id === target.id) return deny('SELF');
  if (nextRole === target.role) return deny('NO_CHANGE', 'نقش کاربر از قبل همین است.');
  return { ok: true, role: nextRole };
}

export type UserSuspensionInput = {
  actor: PolicyActor;
  target: { id: string; role: UserRole; status: UserStatus };
  activeAdminsExcludingTarget: number;
};

export function evaluateUserSuspension(input: UserSuspensionInput): PolicyResult {
  const { actor, target, activeAdminsExcludingTarget } = input;
  if (!roleCan(actor.role, 'user.suspend')) return deny('ROLE', 'فقط مدیران می‌توانند حساب کاربران را تعلیق کنند.');
  if (target.role === 'ADMIN' && target.status === 'ACTIVE' && activeAdminsExcludingTarget <= 0) return deny('LAST_ADMIN');
  if (actor.id === target.id) return deny('SELF');
  if (target.status === 'SUSPENDED') return deny('NO_CHANGE', 'این حساب از قبل تعلیق شده است.');
  return OK;
}

export function evaluateUserRestore(input: Pick<UserSuspensionInput, 'actor' | 'target'>): PolicyResult {
  const { actor, target } = input;
  if (!roleCan(actor.role, 'user.restore')) return deny('ROLE', 'فقط مدیران می‌توانند تعلیق حساب کاربران را بردارند.');
  if (actor.id === target.id) return deny('SELF');
  if (target.status !== 'SUSPENDED') return deny('NO_CHANGE', 'این حساب تعلیق نشده است.');
  return OK;
}

// ---------------------------------------------------------------------------
// State machines (staff side)
// ---------------------------------------------------------------------------

type Table<S extends string> = Partial<Record<S, readonly S[]>>;

const canMove = <S extends string>(table: Table<S>, from: S, to: S): boolean => !!table[from]?.includes(to);

/** OPEN → REVIEWING → ACTIONED | DISMISSED (a report can also be decided straight from OPEN). Decisions are final. */
export const REPORT_TRANSITIONS: Table<ReportStatus> = {
  OPEN: ['REVIEWING', 'ACTIONED', 'DISMISSED'],
  REVIEWING: ['ACTIONED', 'DISMISSED'],
};
export const OPEN_REPORT_STATUSES = ['OPEN', 'REVIEWING'] as const satisfies readonly ReportStatus[];
export const canTransitionReport = (from: ReportStatus, to: ReportStatus) => canMove(REPORT_TRANSITIONS, from, to);
export const isReportOpen = (status: ReportStatus) => (OPEN_REPORT_STATUSES as readonly string[]).includes(status);

/**
 * Staff-side monetization workflow. DRAFT belongs to the creator. Only SUBMITTED / UNDER_REVIEW can be decided;
 * an approved program can be suspended, a suspended one reinstated.
 */
export const MONETIZATION_TRANSITIONS: Table<MonetizationStatus> = {
  SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['SUSPENDED'],
  SUSPENDED: ['APPROVED'],
};
export const PENDING_MONETIZATION_STATUSES = ['SUBMITTED', 'UNDER_REVIEW'] as const satisfies readonly MonetizationStatus[];
export const canTransitionMonetization = (from: MonetizationStatus, to: MonetizationStatus) => canMove(MONETIZATION_TRANSITIONS, from, to);

export type MonetizationDecision = 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REINSTATE';
export const MONETIZATION_DECISION_TARGET: Record<MonetizationDecision, MonetizationStatus> = {
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  SUSPEND: 'SUSPENDED',
  REINSTATE: 'APPROVED',
};
/** Decisions available from a status (used by the UI and validated again by the server). */
export function monetizationDecisionsFrom(status: MonetizationStatus): MonetizationDecision[] {
  return (Object.keys(MONETIZATION_DECISION_TARGET) as MonetizationDecision[]).filter(
    (d) =>
      canTransitionMonetization(status, MONETIZATION_DECISION_TARGET[d]) &&
      // APPROVED→APPROVED never exists; REINSTATE is only valid from SUSPENDED, APPROVE only from the pending states.
      (d === 'REINSTATE' ? status === 'SUSPENDED' : d === 'APPROVE' ? status !== 'SUSPENDED' : true),
  );
}

export const VERIFICATION_TRANSITIONS: Table<VerificationStatus> = {
  SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED'],
};
export const PENDING_VERIFICATION_STATUSES = ['SUBMITTED', 'UNDER_REVIEW'] as const satisfies readonly VerificationStatus[];
export const canTransitionVerification = (from: VerificationStatus, to: VerificationStatus) => canMove(VERIFICATION_TRANSITIONS, from, to);

/**
 * Staff side of the ticket workflow. (The user side — a user reply re-opens the ticket — lives in the support feature.)
 *   reply : OPEN | ANSWERED → ANSWERED     close : OPEN | ANSWERED → CLOSED     reopen : CLOSED → OPEN
 */
export const TICKET_TRANSITIONS: Table<TicketStatus> = {
  OPEN: ['ANSWERED', 'CLOSED'],
  ANSWERED: ['ANSWERED', 'CLOSED'],
  CLOSED: ['OPEN'],
};
export const canTransitionTicket = (from: TicketStatus, to: TicketStatus) => canMove(TICKET_TRANSITIONS, from, to);

// ---------------------------------------------------------------------------
// Audit-log visibility
// ---------------------------------------------------------------------------

/** Actions only administrators are meant to see (account / role / money decisions). */
export const ADMIN_ONLY_ACTION_TYPES = [
  'USER_ROLE_CHANGE',
  'USER_SUSPEND',
  'USER_RESTORE',
  'MONETIZATION_APPROVE',
  'MONETIZATION_REJECT',
] as const satisfies readonly ModerationActionType[];

export type AuditScope = { kind: 'all' } | { kind: 'scoped'; actorId: string };

/** Administrators see everything; moderators see their own actions plus content moderation (everything but ADMIN_ONLY_ACTION_TYPES). */
export function auditScopeFor(user: { id: string; role: UserRole }): AuditScope | null {
  if (roleCan(user.role, 'audit.view.all')) return { kind: 'all' };
  if (roleCan(user.role, 'audit.view.scoped')) return { kind: 'scoped', actorId: user.id };
  return null;
}

/** Can a viewer with this scope see a row? (Mirrors the database filter built by the activity query.) */
export function canSeeAuditRow(scope: AuditScope, row: { actorId: string | null; type: ModerationActionType }): boolean {
  if (scope.kind === 'all') return true;
  return row.actorId === scope.actorId || !(ADMIN_ONLY_ACTION_TYPES as readonly string[]).includes(row.type);
}
