'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { CircleHelp, Search, X } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { useFormatter } from '@/components/providers/format-provider';
import { cn } from '@/lib/utils';
import { countFaqItems, filterFaq, type FaqTopic, type FaqTopicId } from '../faq';

/** Up to this many matches are opened automatically while searching; more than that stay closed (the list would be a wall of text). */
const AUTO_OPEN_LIMIT = 6;

/**
 * Searchable help centre: free-text filter (Persian-aware, partial words, ZWNJ/Yeh/Kaf/digit folding) plus topic chips.
 * The topics (already formatted with the real limits) come from the server; filtering is pure client-side work.
 */
export function FaqBrowser({ topics }: { topics: FaqTopic[] }) {
  const f = useFormatter();
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState<FaqTopicId | 'all'>('all');
  const [opened, setOpened] = useState<string[]>([]);

  const total = useMemo(() => countFaqItems(topics), [topics]);
  const visible = useMemo(() => filterFaq(topics, query, topic), [topics, query, topic]);
  const visibleCount = countFaqItems(visible);
  const searching = query.trim().length > 0;
  const visibleIds = useMemo(() => visible.flatMap((t) => t.items.map((i) => i.id)), [visible]);
  const autoOpen = searching && visibleIds.length <= AUTO_OPEN_LIMIT;

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="relative">
          <label htmlFor={inputId} className="sr-only">
            جستجو در راهنما
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="مثلاً: گذرواژه، حجم ویدیو، حق تکثیر…"
            autoComplete="off"
            maxLength={100}
            className="h-12 w-full rounded-full border border-input bg-card ps-12 pe-12 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="پاک‌کردن جستجو"
              className="absolute end-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>

        <div role="group" aria-label="موضوع‌ها" className="flex flex-wrap gap-2">
          {[{ id: 'all' as const, title: 'همه' }, ...topics.map((t) => ({ id: t.id, title: t.title }))].map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={topic === t.id}
              onClick={() => setTopic(t.id)}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                topic === t.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent',
              )}
            >
              {t.title}
            </button>
          ))}
        </div>

        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {searching || topic !== 'all' ? `${f.number(visibleCount)} پرسش از ${f.number(total)} پرسش` : `${f.number(total)} پرسش در ${f.number(topics.length)} موضوع`}
        </p>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={CircleHelp}
          title="پرسشی با این عبارت پیدا نشد"
          description="عبارت دیگری را امتحان کنید یا سؤالتان را از راه تیکت برای پشتیبانی بفرستید."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" variant="outline" shape="pill" onClick={() => { setQuery(''); setTopic('all'); }}>
                نمایش همه‌ی پرسش‌ها
              </Button>
              <Button asChild shape="pill">
                <Link href="/help/tickets">ثبت تیکت پشتیبانی</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <Accordion
          type="multiple"
          value={autoOpen ? visibleIds : opened}
          onValueChange={setOpened}
          className="space-y-6"
        >
          {visible.map((t) => (
            <section key={t.id} aria-labelledby={`faq-topic-${t.id}`}>
              <div className="mb-1 px-1">
                <h2 id={`faq-topic-${t.id}`} className="text-lg font-bold">
                  {t.title}
                </h2>
                <p className="text-[13px] text-muted-foreground">{t.description}</p>
              </div>
              <div className="rounded-2xl border bg-card px-4">
                {t.items.map((item) => (
                  <AccordionItem key={item.id} value={item.id} id={item.id} className="scroll-mt-24">
                    <AccordionTrigger className="text-[15px] leading-7">{item.q}</AccordionTrigger>
                    <AccordionContent className="space-y-3 text-[15px] leading-8">
                      {item.a.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                      ))}
                      {item.link && (
                        <p>
                          <Link href={item.link.href as Route} className="font-medium text-primary underline-offset-4 hover:underline">
                            {item.link.label} ←
                          </Link>
                        </p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </div>
            </section>
          ))}
        </Accordion>
      )}
    </div>
  );
}
