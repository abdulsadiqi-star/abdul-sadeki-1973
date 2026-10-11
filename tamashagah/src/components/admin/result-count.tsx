import { getFormatter } from '@/lib/format-server';

/** "۳۴ مورد" summary line above a list (announced politely when filters change). Server component. */
export async function ResultCount({ total, noun }: { total: number; noun: string }) {
  const f = await getFormatter();
  return (
    <p className="mb-3 text-sm text-muted-foreground" role="status" aria-live="polite">
      {f.number(total)} {noun}
    </p>
  );
}
