import { Ban, CircleCheck, CircleDot, Clock, Eye, EyeOff, Hourglass, Lock, MessageSquareReply, ShieldAlert, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { adminLabels } from '@/features/admin/labels';
import { labels } from '@/lib/i18n/fa';
import type {
  CommentStatus,
  MonetizationStatus,
  ProcessingStatus,
  PublishStatus,
  ReportStatus,
  TicketStatus,
  UserRole,
  UserStatus,
  VerificationStatus,
  Visibility,
} from '@/generated/prisma/enums';

type Variant = React.ComponentProps<typeof Badge>['variant'];

export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  const map: Record<ReportStatus, { variant: Variant; icon: React.ReactNode }> = {
    OPEN: { variant: 'warning', icon: <CircleDot /> },
    REVIEWING: { variant: 'info', icon: <Eye /> },
    ACTIONED: { variant: 'success', icon: <CircleCheck /> },
    DISMISSED: { variant: 'muted', icon: <XCircle /> },
  };
  const { variant, icon } = map[status];
  return (
    <Badge variant={variant}>
      {icon}
      {labels.reportStatus[status]}
    </Badge>
  );
}

/** Monetization and verification share the same lifecycle vocabulary. */
export function RequestStatusBadge({ status, kind }: { status: MonetizationStatus | VerificationStatus; kind: 'monetization' | 'verification' }) {
  const variant: Variant =
    status === 'APPROVED' ? 'success' : status === 'REJECTED' ? 'destructive' : status === 'SUSPENDED' ? 'warning' : status === 'UNDER_REVIEW' ? 'info' : status === 'DRAFT' ? 'muted' : 'secondary';
  const label = kind === 'monetization' ? labels.monetization[status as MonetizationStatus] : labels.verification[status as VerificationStatus];
  return <Badge variant={variant}>{label}</Badge>;
}

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const map: Record<TicketStatus, { variant: Variant; icon: React.ReactNode }> = {
    OPEN: { variant: 'warning', icon: <Hourglass /> },
    ANSWERED: { variant: 'info', icon: <MessageSquareReply /> },
    CLOSED: { variant: 'muted', icon: <Lock /> },
  };
  const { variant, icon } = map[status];
  return (
    <Badge variant={variant}>
      {icon}
      {labels.ticketStatus[status]}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: UserRole }) {
  const variant: Variant = role === 'ADMIN' ? 'default' : role === 'MODERATOR' ? 'info' : 'secondary';
  return <Badge variant={variant}>{labels.role[role]}</Badge>;
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  return status === 'SUSPENDED' ? (
    <Badge variant="destructive">
      <Ban />
      {adminLabels.userStatus.SUSPENDED}
    </Badge>
  ) : (
    <Badge variant="success">{adminLabels.userStatus.ACTIVE}</Badge>
  );
}

export function CommentStatusBadge({ status }: { status: CommentStatus }) {
  const variant: Variant = status === 'APPROVED' ? 'success' : status === 'DELETED' || status === 'REJECTED' ? 'destructive' : status === 'SPAM' ? 'warning' : 'secondary';
  return <Badge variant={variant}>{labels.commentStatus[status]}</Badge>;
}

/** All the states that decide whether a video is visible, in one cluster. */
export function VideoStateBadges({
  processingStatus,
  publishStatus,
  visibility,
  takenDown,
  channelSuspended,
}: {
  processingStatus: ProcessingStatus;
  publishStatus: PublishStatus;
  visibility: Visibility;
  takenDown: boolean;
  channelSuspended?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {takenDown && (
        <Badge variant="destructive">
          <ShieldAlert />
          {adminLabels.videoState.takenDown}
        </Badge>
      )}
      {channelSuspended && (
        <Badge variant="warning">
          <Ban />
          {adminLabels.videoState.channelSuspended}
        </Badge>
      )}
      <Badge variant={processingStatus === 'READY' ? 'success' : processingStatus === 'FAILED' ? 'destructive' : 'info'}>
        {processingStatus === 'READY' ? null : <Clock />}
        {labels.processing[processingStatus]}
      </Badge>
      <Badge variant={publishStatus === 'PUBLISHED' ? 'secondary' : 'muted'}>{labels.publish[publishStatus]}</Badge>
      <Badge variant="outline">
        {visibility === 'PUBLIC' ? <Eye /> : <EyeOff />}
        {labels.visibility[visibility]}
      </Badge>
    </div>
  );
}
