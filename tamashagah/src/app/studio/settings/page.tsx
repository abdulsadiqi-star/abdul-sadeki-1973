import Link from 'next/link';
import { Clapperboard } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { requirePageUser } from '@/lib/auth/guards';
import { AccountProfileForm } from '@/features/settings/components/account-profile-form';
import { ChannelForm } from '@/features/settings/components/channel-form';
import { EmailCardContent } from '@/features/settings/components/email-card-content';
import { ImageUploader } from '@/features/settings/components/image-uploader';
import { PasswordForm } from '@/features/settings/components/password-form';
import { SessionsCardContent } from '@/features/settings/components/sessions-card-content';
import { SettingsCard } from '@/features/settings/components/settings-card';
import { SettingsTabs, type SettingsTab } from '@/features/settings/components/settings-tabs';
import { getAccountSettings, getChannelSettings, listActiveSessions } from '@/features/settings/queries';

export const metadata = { title: 'تنظیمات' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Account and channel settings. Works WITHOUT a channel too: such users only get the account tab (the channel tab
 * and its uploads need a channel, and the server enforces that independently of what is rendered here).
 */
export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser('/studio/settings');
  const rawTab = (await searchParams).tab;
  const initialTab: SettingsTab = (Array.isArray(rawTab) ? rawTab[0] : rawTab) === 'channel' && user.channel ? 'channel' : 'account';

  const [account, sessions, channel] = await Promise.all([
    getAccountSettings(user.id),
    listActiveSessions(user.id, user.sessionId),
    user.channel ? getChannelSettings(user.channel.id) : null,
  ]);

  const accountPanel = (
    <>
      {!user.channel && (
        <Alert variant="info">
          <Clapperboard />
          <AlertTitle>هنوز کانال ندارید</AlertTitle>
          <AlertDescription>
            <p>برای بارگذاری ویدیو و دیدن آمار، ابتدا یک کانال بسازید.</p>
            <Button asChild size="sm" className="mt-2">
              <Link href="/studio">ساخت کانال</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <SettingsCard title="نمایه" description="نام و تصویری که دیگران می‌بینند، و ترجیح‌های نمایش.">
        <ImageUploader
          endpoint="/api/studio/account/avatar"
          variant="avatar"
          label="تصویر نمایه"
          hint="JPG، PNG یا WebP تا ۸ مگابایت؛ به‌صورت مربع ۴۰۰×۴۰۰ ذخیره می‌شود."
          name={account.displayName}
          initialUrl={account.avatarUrl}
        />
        {user.channel && (
          <p className="text-[13px] text-muted-foreground">
            در منوی بالای صفحه، تصویر کانال شما (در صورت وجود) نمایش داده می‌شود؛ تصویر کانال را از بخش «کانال» تغییر دهید.
          </p>
        )}
        <AccountProfileForm initial={{ displayName: account.displayName, digitStyle: account.digitStyle, notifyByEmail: account.notifyByEmail }} />
      </SettingsCard>

      <SettingsCard id="email" title="ایمیل" description="نشانی‌ای که با آن وارد می‌شوید و اعلان‌های امنیتی دریافت می‌کنید.">
        <EmailCardContent email={account.email} verified={account.emailVerified} />
      </SettingsCard>

      <SettingsCard id="password" title="گذرواژه" description="برای امنیت حساب، گذرواژه‌ی منحصربه‌فرد و قوی انتخاب کنید.">
        <PasswordForm />
      </SettingsCard>

      <SettingsCard id="sessions" title="نشست‌های فعال" description="دستگاه‌هایی که اکنون با حساب شما وارد شده‌اند.">
        <SessionsCardContent sessions={sessions} />
      </SettingsCard>
    </>
  );

  const channelPanel = channel && (
    <>
      <SettingsCard title="تصویر و بنر کانال" description="تصویری که کنار نام کانال، ویدیوها و دیدگاه‌های شما نمایش داده می‌شود.">
        <ImageUploader
          endpoint="/api/studio/channel/banner"
          variant="banner"
          label="بنر کانال"
          hint="JPG، PNG یا WebP تا ۸ مگابایت؛ به اندازه‌ی ۱۹۲۰×۴۸۰ (نسبت ۴ به ۱) بُرش و ذخیره می‌شود."
          name={channel.name}
          initialUrl={channel.bannerUrl}
        />
        <hr />
        <ImageUploader
          endpoint="/api/studio/channel/avatar"
          variant="avatar"
          label="تصویر کانال"
          hint="JPG، PNG یا WebP تا ۸ مگابایت؛ به‌صورت مربع ۴۰۰×۴۰۰ ذخیره می‌شود."
          name={channel.name}
          initialUrl={channel.avatarUrl}
        />
      </SettingsCard>
      <SettingsCard title="اطلاعات کانال" description="نام، توضیحات، پیوندها و سیاست دیدگاه‌ها.">
        <ChannelForm
          handle={channel.handle}
          initial={{
            name: channel.name,
            description: channel.description,
            links: channel.links,
            commentsMode: channel.commentsMode,
            defaultVisibility: channel.defaultVisibility,
          }}
        />
      </SettingsCard>
    </>
  );

  return (
    <>
      <PageHeader title="تنظیمات" description="حساب کاربری، امنیت و اطلاعات کانال شما." />
      <SettingsTabs initial={initialTab} account={accountPanel} channel={channelPanel} />
    </>
  );
}
