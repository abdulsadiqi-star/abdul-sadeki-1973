import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/auth-card';
import { LoginForm } from '@/components/auth/login-form';
import { getCurrentUser } from '@/lib/auth/session';
import { safeRedirectPath } from '@/lib/request';

export const metadata: Metadata = { title: 'ورود' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeRedirectPath(next, '/');
  if (await getCurrentUser()) redirect(target);

  return (
    <AuthCard
      title="ورود به حساب کاربری"
      description="برای بارگذاری ویدیو، دنبال‌کردن کانال‌ها و ثبت دیدگاه وارد شوید."
      footer={
        <>
          حساب کاربری ندارید؟{' '}
          <Link href="/register" className="font-semibold text-primary hover:underline">
            ثبت‌نام کنید
          </Link>
        </>
      }
    >
      <LoginForm next={target} />
    </AuthCard>
  );
}
