import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth/auth-card';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'تعیین گذرواژه‌ی جدید', robots: { index: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token || token.length < 20 || token.length > 128) {
    return (
      <AuthCard title="پیوند نامعتبر است" description="پیوند بازیابی ناقص است یا منقضی شده. دوباره درخواست بازیابی بدهید.">
        <Button asChild className="w-full" size="lg">
          <Link href="/forgot-password">درخواست پیوند جدید</Link>
        </Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="تعیین گذرواژه‌ی جدید" description="گذرواژه‌ی تازه‌ی خود را وارد کنید. پس از تغییر، از همه‌ی دستگاه‌ها خارج می‌شوید.">
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
