import { Fragment } from 'react';
import type { Segment } from '@/features/search/highlight';

/**
 * Renders highlight segments. Matches become `<mark>`; everything else is plain text. Because segments are data
 * (never an HTML string), React escapes all user content — a title like "<script>" is displayed, never executed.
 */
export function HighlightedText({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((segment, i) =>
        segment.match ? (
          <mark key={i} className="rounded-[0.2rem] bg-primary/15 px-0.5 text-foreground">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
