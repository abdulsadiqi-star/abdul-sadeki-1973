import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { siteConfig } from '@/config/site';
import { getFormatter } from '@/lib/format-server';
import { operatorChecklist, type LegalDocument } from '../legal';

/**
 * A legal text: template banner (these are templates the operator must review with a lawyer), table of contents,
 * numbered sections with anchors and the contact line. Pure Server Component.
 */
export async function LegalDocumentView({ doc }: { doc: LegalDocument }) {
  const f = await getFormatter();
  const other = doc.slug === 'terms' ? { href: '/privacy', label: 'سیاست حریم خصوصی' } : { href: '/terms', label: 'شرایط استفاده' };

  return (
    <article className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-extrabold sm:text-3xl">{doc.title}</h1>
        <p className="text-sm text-muted-foreground">آخرین ویرایش: {f.date(doc.updatedAt, 'long')}</p>
        <p className="leading-8">{doc.intro}</p>
      </header>

      <Alert variant="warning" role="note">
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>این متن یک الگوست</AlertTitle>
        <AlertDescription className="text-foreground">
          <p>
            متن‌های حقوقی تماشاگاه به‌صورت الگوی عمومی برای یک پلتفرم ویدیو نوشته شده و جایگزین مشاوره‌ی حقوقی نیست. اپراتور سرویس باید پیش از
            بازکردن سرویس به روی عموم آن را با وکیل یا مشاور حقوقی بازبینی و موارد زیر را تکمیل کند:
          </p>
          <ul className="list-disc space-y-1 ps-5">
            {operatorChecklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>

      <nav aria-label="فهرست مطالب" className="rounded-xl border bg-card p-4">
        <h2 className="mb-2 text-sm font-bold">فهرست مطالب</h2>
        <ol className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {doc.sections.map((section, index) => (
            <li key={section.id} className="flex gap-2">
              <span aria-hidden="true" className="w-5 shrink-0 text-muted-foreground tabular-nums">
                {f.number(index + 1)}.
              </span>
              <a href={`#${section.id}`} className="rounded text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-8">
        {doc.sections.map((section, index) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-24 space-y-3">
            <h2 id={`${section.id}-title`} className="text-lg font-bold">
              <span aria-hidden="true" className="text-muted-foreground tabular-nums">
                {f.number(index + 1)}.{' '}
              </span>
              {section.title}
            </h2>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="leading-8 text-foreground/90">
                {paragraph}
              </p>
            ))}
            {section.items && (
              <ul className="list-disc space-y-2 ps-6 leading-8 text-foreground/90 marker:text-muted-foreground">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {section.note && (
              <p className="rounded-lg border border-dashed border-warning/60 bg-warning/10 px-3 py-2 text-[13px] leading-6">
                <span className="font-semibold">برای اپراتور: </span>
                {section.note}
              </p>
            )}
          </section>
        ))}
      </div>

      <footer className="space-y-1 border-t pt-6 text-sm text-muted-foreground">
        <p>
          پرسشی دارید؟ از بخش <Link href="/help/tickets" className="text-primary underline-offset-4 hover:underline">پشتیبانی</Link> تیکت ثبت کنید یا به{' '}
          <a href={`mailto:${siteConfig.supportEmail}`} dir="ltr" className="text-primary underline-offset-4 hover:underline">
            {siteConfig.supportEmail}
          </a>{' '}
          نامه بنویسید.
        </p>
        <p>
          متن مرتبط: <Link href={other.href as '/terms'} className="text-primary underline-offset-4 hover:underline">{other.label}</Link>
        </p>
      </footer>
    </article>
  );
}
