import type { MonetizationStatus } from '@/generated/prisma/enums';

/** What each status means for the creator (the short status names live in the shared `labels.monetization`). */
export const statusDescription: Record<MonetizationStatus, string> = {
  DRAFT: 'پیش‌نویس درخواست ذخیره شده است و هنوز برای بررسی ارسال نشده.',
  SUBMITTED: 'درخواست شما ارسال شد و در صف بررسی است. تا پیش از شروع بررسی می‌توانید از آن انصراف دهید.',
  UNDER_REVIEW: 'تیم تماشاگاه در حال بررسی درخواست شماست. نتیجه همین‌جا اعلام می‌شود.',
  APPROVED: 'درخواست شما تأیید شد.',
  REJECTED: 'درخواست شما رد شد. پس از رفع ایراد می‌توانید دوباره درخواست دهید.',
  SUSPENDED: 'مشارکت شما در برنامه‌ی درآمدزایی معلق شده است.',
};

export const statusVariant: Record<MonetizationStatus, 'muted' | 'info' | 'warning' | 'success' | 'destructive'> = {
  DRAFT: 'muted',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  SUSPENDED: 'destructive',
};

/** Shown with an APPROVED application and in the revenue section: approval is not a payout. */
export const PAYMENT_NOT_CONNECTED = 'اتصال به سرویس پرداخت هنوز انجام نشده';
export const NO_REVENUE_RECORDED = 'درآمدی ثبت نشده است';
