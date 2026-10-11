import type { Metadata } from 'next';
import { LegalDocumentView } from '@/features/info/components/legal-document';
import { privacyDocument } from '@/features/info/legal';

export const metadata: Metadata = {
  title: 'سیاست حریم خصوصی',
  description: 'تماشاگاه چه اطلاعاتی نگه می‌دارد، چطور از آن استفاده می‌کند و شما چطور می‌توانید آن را ببینید یا پاک کنید (الگوی حقوقی؛ نیازمند بازبینی اپراتور).',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return <LegalDocumentView doc={privacyDocument} />;
}
