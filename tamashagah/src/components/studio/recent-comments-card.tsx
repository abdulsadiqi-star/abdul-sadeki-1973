import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChannelAvatar } from '@/components/channel-avatar';
import { ChevronEnd } from '@/components/icons';
import { EmptyState } from '@/components/empty-state';
import { getFormatter } from '@/lib/format-server';
import type { DashboardComment } from '@/features/studio/types';
import { ApproveCommentButton } from './approve-comment-button';

/** "دیدگاه‌ها": the latest comments with author, relative time, text and a quick approve for pending ones. */
export async function RecentCommentsCard({ comments, pending }: { comments: DashboardComment[]; pending: number }) {
  const f = await getFormatter();
  return (
    <Card data-testid="recent-comments">
      <CardHeader>
        <CardTitle className="text-base">دیدگاه‌ها</CardTitle>
        {pending > 0 && (
          <CardDescription data-testid="pending-comments">
            <Badge variant="warning">{f.number(pending)} دیدگاه در انتظار تأیید شما</Badge>
          </CardDescription>
        )}
        <CardAction>
          <Button asChild variant="ghost" size="xs">
            <Link href="/studio/comments">
              همه‌ی دیدگاه‌ها <ChevronEnd />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {comments.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="هنوز دیدگاهی ثبت نشده است"
            description="وقتی بینندگان زیر ویدیوهای شما دیدگاه بگذارند، آخرین‌ها اینجا نمایش داده می‌شوند."
            className="py-8"
          />
        ) : (
          <ul className="divide-y">
            {comments.map((comment) => (
              <li key={comment.id} className="flex gap-3 py-3 first:pt-0 last:pb-0" data-testid="dashboard-comment">
                <ChannelAvatar name={comment.author.name} src={comment.author.avatarUrl} size="md" className="shrink-0" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                    <span className="font-semibold" dir="auto">
                      {comment.author.name}
                    </span>
                    <span className="text-muted-foreground" suppressHydrationWarning>
                      {f.relative(comment.createdAt)}
                    </span>
                    {comment.status === 'PENDING' && <Badge variant="warning">در انتظار تأیید</Badge>}
                  </div>
                  <p className="user-text line-clamp-3 text-sm leading-6 whitespace-pre-line" dir="auto">
                    {comment.body}
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/watch/${comment.video.id}`} dir="auto" className="line-clamp-1 max-w-full text-xs text-muted-foreground hover:text-primary">
                      روی «{comment.video.title}»
                    </Link>
                    {comment.status === 'PENDING' && <ApproveCommentButton commentId={comment.id} author={comment.author.name} />}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
