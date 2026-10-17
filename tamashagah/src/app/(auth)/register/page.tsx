import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/auth-card';
import { RegisterForm } from '@/components/auth/register-form';
import { getCurrentUser } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'ثبت‌نام' };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect('/');
  return (
    <AuthCard
      title="ساخت حساب کاربری"
      description="در چند ثانیه حساب بسازید و کانال خودتان را راه‌اندازی کنید."
      footer={
        <>
          قبلاً ثبت‌نام کرده‌اید؟{' '}
          <Link href="/login" className="font-semibold text-primary hover:underline">
            وارد شوید
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthCard>
  );
}
