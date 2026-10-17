import { StudioShell } from '@/components/layout/studio-shell';
import { requirePageUser } from '@/lib/auth/guards';

export const metadata = { title: { default: 'استودیو', template: '%s | استودیوی تماشاگاه' }, robots: { index: false } };

/** Every /studio/** page requires a signed-in user. Pages that need a channel call requirePageChannelUser(). */
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser('/studio');
  return <StudioShell user={user}>{children}</StudioShell>;
}
