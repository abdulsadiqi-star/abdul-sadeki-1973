import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PosterImage } from '@/components/video/video-card';
import { FaqBrowser } from '@/features/info/components/faq-browser';
import { InstallApp } from '@/features/info/components/install-app';
import { buildFaq } from '@/features/info/faq';
import { createFormatter } from '@/lib/format';

const topics = buildFaq({
  f: createFormatter('fa'),
  maxUploadBytes: 2 * 1024 ** 3,
  dailyQuotaBytes: 5 * 1024 ** 3,
  maxUploadsPerDay: 10,
  shortsMaxSeconds: 60,
  monetization: { minFollowers: 500, minWatchHours: 1000, minPublicVideos: 3, windowDays: 90 },
});

describe('FaqBrowser', () => {
  it('filters by words (partial, Arabic letters, missing ZWNJ) and announces the count', async () => {
    const user = userEvent.setup();
    render(<FaqBrowser topics={topics} />);
    expect(screen.getByRole('status')).toHaveTextContent('۳۴ پرسش در ۷ موضوع');

    const search = screen.getByRole('searchbox', { name: 'جستجو در راهنما' });
    await user.type(search, 'گذرواژ');
    expect(screen.getByRole('button', { name: /گذرواژه‌ام را فراموش/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/پرسش از ۳۴ پرسش/);

    await user.clear(search);
    await user.type(search, 'نميشود'); // Arabic yeh, no half-space
    expect(screen.getByRole('button', { name: /ویدیو پخش نمی‌شود/ })).toBeInTheDocument();
  });

  it('opens a small result set automatically, shows an empty state, and filters by topic chip', async () => {
    const user = userEvent.setup();
    render(<FaqBrowser topics={topics} />);
    const search = screen.getByRole('searchbox', { name: 'جستجو در راهنما' });
    await user.type(search, 'فراموش');
    const trigger = screen.getByRole('button', { name: /گذرواژه‌ام را فراموش/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/پیوند تغییر گذرواژه/)).toBeVisible();

    await user.clear(search);
    await user.type(search, 'ساندویچ همبرگر');
    expect(screen.getByText('پرسشی با این عبارت پیدا نشد')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ثبت تیکت پشتیبانی' })).toHaveAttribute('href', '/help/tickets');
    await user.click(screen.getByRole('button', { name: 'نمایش همه‌ی پرسش‌ها' }));
    expect(screen.getByRole('status')).toHaveTextContent('۳۴ پرسش در ۷ موضوع');

    const chip = screen.getByRole('button', { name: 'حق تکثیر' });
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /اگر کسی اثر مرا بدون اجازه/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /گذرواژه‌ام را فراموش/ })).not.toBeInTheDocument();
  });
});

describe('PosterImage', () => {
  it('shows the image, then the branded placeholder when it fails to load', () => {
    const { container } = render(<PosterImage src="/media/videos/x/thumbs/p.jpg" />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', '/media/videos/x/thumbs/p.jpg');
    fireEvent.error(img!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.bg-brand-gradient')).toBeInTheDocument();
  });

  it('shows the placeholder without a URL and retries when the URL changes', () => {
    const { container, rerender } = render(<PosterImage src={null} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.bg-brand-gradient')).toBeInTheDocument();

    rerender(<PosterImage src="/a.jpg" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    rerender(<PosterImage src="/b.jpg" />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/b.jpg');
  });
});

describe('InstallApp', () => {
  it('offers a real install button only after the browser fires beforeinstallprompt', async () => {
    const user = userEvent.setup();
    render(<InstallApp />);
    expect(screen.queryByRole('button', { name: 'نصب برنامه' })).not.toBeInTheDocument();
    expect(screen.getByText('اندروید (کروم)')).toBeInTheDocument();
    expect(screen.getByText('آیفون و آیپد (سافاری)')).toBeInTheDocument();

    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'dismissed' as const }) });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    await user.click(await screen.findByRole('button', { name: 'نصب برنامه' }));
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'نصب برنامه' })).not.toBeInTheDocument();
  });

  it('says so when it already runs as an installed app', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query.includes('standalone') })) as typeof window.matchMedia;
    try {
      render(<InstallApp />);
      expect(screen.getByText('شما هم‌اکنون در برنامه‌ی نصب‌شده هستید')).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});
