import { ExternalLink } from 'lucide-react';
import { getFormatter } from '@/lib/format-server';
import { linkHost, type ChannelLink } from '@/features/channels/links';
import type { ChannelProfile, ChannelStats } from '@/features/channels/queries';

/** "About" tab: description, links (nofollow/ugc, http(s) only), join date (Jalali) and public totals. */
export async function ChannelAbout({ channel, stats }: { channel: ChannelProfile; stats: ChannelStats }) {
  const f = await getFormatter();
  const rows: [string, string][] = [
    ['تاریخ ساخت کانال', f.date(channel.createdAt)],
    ['دنبال‌کننده‌ها', f.number(channel.followerCount)],
    ['ویدیوها', f.number(stats.videoCount)],
    ['شورتس', f.number(stats.shortCount)],
    ['مجموع بازدیدها', f.number(stats.totalViews)],
  ];
  return (
    <div className="grid gap-8 md:grid-cols-[1fr_20rem]">
      <div className="space-y-8">
        <section aria-labelledby="about-description">
          <h2 id="about-description" className="mb-2 text-lg font-bold">
            درباره‌ی این کانال
          </h2>
          {channel.description ? (
            <p dir="auto" className="user-text leading-8 whitespace-pre-line text-muted-foreground">
              {channel.description}
            </p>
          ) : (
            <p className="text-muted-foreground">سازنده‌ی این کانال هنوز توضیحی ننوشته است.</p>
          )}
        </section>

        {channel.links.length > 0 && (
          <section aria-labelledby="about-links">
            <h2 id="about-links" className="mb-3 text-lg font-bold">
              پیوندها
            </h2>
            <ul className="space-y-2">
              {channel.links.map((link: ChannelLink) => (
                <li key={link.url}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="nofollow noopener ugc"
                    className="inline-flex max-w-full items-center gap-2 rounded-lg text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
                    <span dir="auto" className="truncate">
                      {link.title}
                    </span>
                    <span className="ltr-isolate truncate text-xs text-muted-foreground">{linkHost(link.url)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside aria-label="آمار کانال">
        <h2 className="mb-3 text-lg font-bold">آمار</h2>
        <dl className="divide-y rounded-2xl border bg-card text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {channel.isVerified && <p className="mt-3 text-[13px] text-muted-foreground">این کانال تیک تأیید دارد.</p>}
      </aside>
    </div>
  );
}
