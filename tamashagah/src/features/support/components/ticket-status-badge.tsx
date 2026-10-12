import { Badge } from '@/components/ui/badge';
import { labels } from '@/lib/i18n/fa';
import type { TicketStatus } from '@/generated/prisma/enums';

const variant = { OPEN: 'info', ANSWERED: 'success', CLOSED: 'muted' } as const satisfies Record<TicketStatus, 'info' | 'success' | 'muted'>;

/** Ticket status as a coloured badge (labels come from `labels.ticketStatus`). */
export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <Badge variant={variant[status]}>{labels.ticketStatus[status]}</Badge>;
}
