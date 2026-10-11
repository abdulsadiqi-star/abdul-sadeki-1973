import { FlaskConical } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { getFormatter } from '@/lib/format-server';
import { SEED_NOTICE, SEED_NOTICE_HINT } from '@/features/analytics/labels';

/**
 * Banner shown when SYNTHETIC rows (`source = SEED`) are part of the selected range
 * (and only then — see `getAnalyticsOverview().data`).
 */
export async function SeedDataNotice({
  seedViews,
  totalViews,
  seedFollowEvents,
}: {
  seedViews: number;
  totalViews: number;
  seedFollowEvents: number;
}) {
  const f = await getFormatter();
  const parts: string[] = [];
  if (seedViews > 0) parts.push(`${f.number(seedViews)} از ${f.number(totalViews)} بازدید`);
  if (seedFollowEvents > 0) parts.push(`${f.number(seedFollowEvents)} رویداد دنبال‌کردن`);
  return (
    <Alert variant="info" data-testid="seed-notice">
      <FlaskConical />
      <AlertTitle>{SEED_NOTICE}</AlertTitle>
      <AlertDescription>
        <p>
          {parts.length > 0 && <>{parts.join(' و ')} نمونه است. </>}
          {SEED_NOTICE_HINT}
        </p>
      </AlertDescription>
    </Alert>
  );
}

/** Small marker for a single figure that includes synthetic rows (stat cards). */
export function SampleChip() {
  return (
    <Badge variant="muted" title={SEED_NOTICE}>
      <FlaskConical aria-hidden="true" />
      نمونه
      <span className="sr-only">: {SEED_NOTICE}</span>
    </Badge>
  );
}
