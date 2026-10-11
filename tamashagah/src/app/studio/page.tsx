import { Clapperboard, MailWarning } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CreateChannelForm } from '@/components/channel/create-channel-form';
import { ComingSoon } from '@/components/coming-soon';
import { requirePageUser } from '@/lib/auth/guards';

export const metadata = { title: 'داشبورد' };

export default async function StudioDashboardPage() {
  const user = await requirePageUser('/studio');

  // Onboarding: signed-in users without a channel create one here. KEEP THIS BLOCK.
  if (!user.channel) {
    return (
      <div className="mx-auto max-w-xl space-y-6 py-4">
        <div className="space-y-2 text-center">
          <span className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-md">
            <Clapperboard aria-hidden="true" className="size-8" />
          </span>
          <h1 className="text-2xl font-extrabold">کانال خودتان را بسازید</h1>
          <p className="text-sm text-muted-foreground">با داشتن کانال می‌توانید ویدیو بارگذاری کنید، مخاطب جمع کنید و آمار بازدید را ببینید.</p>
        </div>
        {!user.emailVerified ? (
          <Alert variant="warning">
            <MailWarning />
            <AlertTitle>ابتدا ایمیل خود را تأیید کنید</AlertTitle>
            <AlertDescription>
              برای ساخت کانال باید ایمیل شما تأیید شده باشد. پیوند تأیید به <bdi className="ltr-isolate">{user.email}</bdi> ارسال شده است.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <CreateChannelForm suggestedFrom={user.email} />
          </div>
        )}
      </div>
    );
  }

  return <ComingSoon title="داشبورد استودیو" hint="آمار کلی، آخرین ویدیوها و دیدگاه‌های اخیر اینجا نمایش داده می‌شود." />;
}
