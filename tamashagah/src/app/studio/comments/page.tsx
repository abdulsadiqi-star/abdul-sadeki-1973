import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { requirePageChannelUser } from '@/lib/auth/guards';
import { StudioComments } from '@/features/comments/components/studio-comments';
import { STUDIO_TABS, type StudioTab } from '@/features/comments/schemas';
import { getStudioCommentCounts, listSpamWriters, listStudioComments } from '@/features/comments/studio-queries';

export const metadata = { title: 'دیدگاه‌ها' };

type Props = { searchParams: Promise<{ tab?: string; q?: string; page?: string }> };

/** Comment moderation (reference: the creator-studio comments screen). Requires a channel. */
export default async function StudioCommentsPage({ searchParams }: Props) {
  const user = await requirePageChannelUser('/studio/comments');
  const sp = await searchParams;
  const tab: StudioTab = (STUDIO_TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as StudioTab) : 'all';
  const q = (sp.q ?? '').trim().slice(0, 100);
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));
  const channelId = user.channel.id;

  const [counts, data, writers] = await Promise.all([
    getStudioCommentCounts(channelId),
    listStudioComments(channelId, { tab, q, page }),
    listSpamWriters(channelId),
  ]);

  const href = (p: number) => {
    const params = new URLSearchParams();
    if (tab !== 'all') params.set('tab', tab);
    if (q) params.set('q', q);
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    return qs ? `/studio/comments?${qs}` : '/studio/comments';
  };

  return (
    <>
      <PageHeader title="دیدگاه‌ها" description="دیدگاه‌های زیر ویدیوهای شما را تأیید، رد یا پاسخ دهید و هرزنویس‌ها را مسدود کنید." />
      <StudioComments
        tab={tab}
        q={q}
        counts={counts}
        data={data}
        writers={writers}
        owner={{ id: user.id, name: user.channel.name, avatarUrl: user.channel.avatarUrl }}
      />
      <Pagination page={data.page} pageCount={data.pageCount} href={href} className="mt-6" />
    </>
  );
}
