import {
  BadgeCheck,
  CheckCheck,
  Clapperboard,
  CircleCheck,
  Hourglass,
  LifeBuoy,
  Megaphone,
  MessageSquare,
  Reply,
  Rocket,
  ShieldAlert,
  ThumbsUp,
  TriangleAlert,
  UserPlus,
  Video,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { NotificationType } from '@/generated/prisma/enums';
import { cn } from '@/lib/utils';

const ICONS: Record<NotificationType, { icon: LucideIcon; tone: string }> = {
  NEW_COMMENT: { icon: MessageSquare, tone: 'bg-info/15 text-info' },
  COMMENT_PENDING: { icon: Hourglass, tone: 'bg-warning/25 text-warning-foreground dark:text-warning' },
  COMMENT_REPLY: { icon: Reply, tone: 'bg-info/15 text-info' },
  COMMENT_APPROVED: { icon: CheckCheck, tone: 'bg-success/15 text-success' },
  VIDEO_LIKED: { icon: ThumbsUp, tone: 'bg-accent text-accent-foreground' },
  NEW_FOLLOWER: { icon: UserPlus, tone: 'bg-accent text-accent-foreground' },
  VIDEO_READY: { icon: CircleCheck, tone: 'bg-success/15 text-success' },
  VIDEO_FAILED: { icon: TriangleAlert, tone: 'bg-destructive/10 text-destructive' },
  VIDEO_PUBLISHED: { icon: Rocket, tone: 'bg-success/15 text-success' },
  NEW_VIDEO: { icon: Clapperboard, tone: 'bg-accent text-accent-foreground' },
  MODERATION: { icon: ShieldAlert, tone: 'bg-warning/25 text-warning-foreground dark:text-warning' },
  MONETIZATION_UPDATE: { icon: Wallet, tone: 'bg-accent text-accent-foreground' },
  VERIFICATION_UPDATE: { icon: BadgeCheck, tone: 'bg-verified/15 text-verified' },
  TICKET_REPLY: { icon: LifeBuoy, tone: 'bg-info/15 text-info' },
  SYSTEM: { icon: Megaphone, tone: 'bg-muted text-muted-foreground' },
};

/** Round, tinted icon for a notification type (decorative: the type label is always present as text). */
export function NotificationIcon({ type, className }: { type: NotificationType; className?: string }) {
  const { icon: Icon, tone } = ICONS[type] ?? { icon: Video, tone: 'bg-muted text-muted-foreground' };
  return (
    <span aria-hidden="true" className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', tone, className)}>
      <Icon className="size-5" />
    </span>
  );
}
