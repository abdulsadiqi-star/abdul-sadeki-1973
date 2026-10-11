import type { Metadata } from 'next';
import { LegalDocumentView } from '@/features/info/components/legal-document';
import { termsDocument } from '@/features/info/legal';

export const metadata: Metadata = {
  title: 'شرایط استفاده',
  description: 'شرایط استفاده از تماشاگاه: حساب کاربری، محتوا، رفتار مجاز، حق تکثیر و مسئولیت‌ها (الگوی حقوقی؛ نیازمند بازبینی اپراتور).',
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return <LegalDocumentView doc={termsDocument} />;
}
