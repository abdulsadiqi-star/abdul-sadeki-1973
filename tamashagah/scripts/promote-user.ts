/**
 * Staff bootstrap — the only way to create the FIRST administrator (the admin panel can only be opened by staff).
 *
 *   pnpm user:promote you@example.com admin        # full access to /admin
 *   pnpm user:promote you@example.com moderator    # reports, takedowns, comment moderation
 *   pnpm user:promote you@example.com --demote     # back to creator (owns a channel) or plain user
 *   pnpm user:promote --list                       # list current staff
 *
 * The person must have registered through the normal sign-up form first (so no password ever passes through here).
 * Every change is written to the moderation audit log (actor = none, meta.via = "cli").
 * The last administrator cannot be demoted unless you add --force.
 */
import { db } from '../src/lib/db';

const STAFF = ['ADMIN', 'MODERATOR'] as const;
type StaffRole = (typeof STAFF)[number];

function usage(): never {
  console.error(
    [
      'Usage:',
      '  pnpm user:promote <email> admin|moderator',
      '  pnpm user:promote <email> --demote [--force]',
      '  pnpm user:promote --list',
    ].join('\n'),
  );
  process.exit(2);
}

async function listStaff() {
  const staff = await db.user.findMany({
    where: { role: { in: [...STAFF] } },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: { email: true, displayName: true, role: true, status: true, emailVerifiedAt: true },
  });
  if (staff.length === 0) {
    console.log('No staff accounts yet. Register on the site, then run: pnpm user:promote <email> admin');
    return;
  }
  for (const u of staff) {
    console.log(`${u.role.padEnd(10)} ${u.email.padEnd(36)} ${u.displayName}${u.status === 'SUSPENDED' ? '  [suspended]' : ''}${u.emailVerifiedAt ? '' : '  [e-mail not verified]'}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) return listStaff();

  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const positional = args.filter((a) => !a.startsWith('--'));
  const email = positional[0]?.trim().toLowerCase();
  if (!email) usage();
  const demote = flags.has('--demote');
  const wanted = positional[1]?.toUpperCase();
  if (!demote && !(STAFF as readonly string[]).includes(wanted ?? '')) usage();

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, status: true, channel: { select: { id: true } } },
  });
  if (!user) {
    console.error(`No account with the e-mail ${email}. Register on the site first.`);
    process.exit(1);
  }

  const nextRole = demote ? (user.channel ? 'CREATOR' : 'USER') : (wanted as StaffRole);
  if (user.role === nextRole) {
    console.log(`${user.email} already has the role ${nextRole}. Nothing to do.`);
    return;
  }

  if (user.role === 'ADMIN' && nextRole !== 'ADMIN' && !flags.has('--force')) {
    const admins = await db.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } });
    if (admins <= 1) {
      console.error('Refusing to remove the last active administrator (add --force if you really mean it).');
      process.exit(1);
    }
  }
  if (nextRole !== 'CREATOR' && nextRole !== 'USER' && user.status !== 'ACTIVE') {
    console.error('The account is suspended — restore it from the admin panel before promoting it.');
    process.exit(1);
  }

  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { role: nextRole } }),
    db.moderationAction.create({
      data: {
        type: 'USER_ROLE_CHANGE',
        targetUserId: user.id,
        reason: demote ? 'Role removed from the command line' : 'Role granted from the command line',
        meta: { from: user.role, to: nextRole, via: 'cli' },
      },
    }),
  ]);
  console.log(`✔ ${user.email}: ${user.role} → ${nextRole}. Takes effect on their next request (no re-login needed).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
