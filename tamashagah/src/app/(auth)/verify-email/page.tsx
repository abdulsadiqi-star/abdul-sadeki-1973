import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth/auth-card';
import { VerifyEmailCard } from '@/components/auth/verify-email-card';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'تأیید ایمیل', robots: { index: false } };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token || token.length < 20 || token.length > 128) {
    return (
      <AuthCard title="پیوند نامعتبر است" description="پیوند تأیید ناقص است. از داخل سایت دوباره ایمیل تأیید دریافت کنید.">
        <Button asChild className="w-full" size="lg">
          <Link href="/">بازگشت به خانه</Link>
        </Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="تأیید ایمیل" description="با تأیید ایمیل، امکان بارگذاری ویدیو و ثبت دیدگاه برای شما فعال می‌شود.">
      <VerifyEmailCard token={token} />
    </AuthCard>
  );
}
