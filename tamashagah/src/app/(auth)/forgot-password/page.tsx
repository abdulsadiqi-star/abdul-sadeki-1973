import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth/auth-card';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export const metadata: Metadata = { title: 'بازیابی گذرواژه' };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="بازیابی گذرواژه"
      description="ایمیل حساب خود را وارد کنید تا پیوند تعیین گذرواژه‌ی جدید برایتان ارسال شود."
      footer={
        <Link href="/login" className="font-semibold text-primary hover:underline">
          بازگشت به ورود
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
