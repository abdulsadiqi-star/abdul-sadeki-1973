'use client';

import { StudioRouteError } from '@/components/studio/studio-route-error';

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <StudioRouteError {...props} what="فهرست ویدیوها" />;
}
