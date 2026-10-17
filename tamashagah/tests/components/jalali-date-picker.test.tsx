import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JalaliDatePicker, JalaliDateTimeInput } from '@/components/forms/jalali-date-picker';
import { fromJalali, tehranWallClock, toJalali } from '@/lib/jalali';

describe('JalaliDatePicker', () => {
  it('shows the selected date in Persian and opens a Saturday-first calendar', async () => {
    const user = userEvent.setup();
    render(<JalaliDatePicker value={fromJalali(1405, 6, 15)} onChange={() => {}} aria-label="تاریخ" />);
    const trigger = screen.getByRole('button', { name: 'تاریخ' });
    expect(trigger).toHaveTextContent('۱۵ شهریور ۱۴۰۵');
    await user.click(trigger);
    const headers = screen.getAllByRole('columnheader').map((h) => h.getAttribute('aria-label'));
    expect(headers).toEqual(['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه']);
    // Shahrivar has 31 days
    expect(screen.getByRole('button', { name: '۳۱ شهریور ۱۴۰۵' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '۳۲ شهریور ۱۴۰۵' })).not.toBeInTheDocument();
  });

  it('emits the start of the chosen Tehran day', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<JalaliDatePicker value={fromJalali(1405, 6, 15)} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /شهریور/ }));
    await user.click(screen.getByRole('button', { name: '۲۰ شهریور ۱۴۰۵' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const picked = onChange.mock.calls[0]![0] as Date;
    expect(toJalali(picked)).toEqual({ jy: 1405, jm: 6, jd: 20 });
    const wall = tehranWallClock(picked);
    expect([wall.hour, wall.minute, wall.second]).toEqual([0, 0, 0]);
  });

  it('navigates months and crosses year boundaries', async () => {
    const user = userEvent.setup();
    render(<JalaliDatePicker value={fromJalali(1405, 12, 10)} onChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: /اسفند/ }));
    expect(screen.getByRole('button', { name: '۲۹ اسفند ۱۴۰۵' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ماه بعد' }));
    expect(screen.getByRole('button', { name: '۱ فروردین ۱۴۰۶' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ماه قبل' }));
    await user.click(screen.getByRole('button', { name: 'ماه قبل' }));
    expect(screen.getByRole('button', { name: '۳۰ بهمن ۱۴۰۵' })).toBeInTheDocument();
  });

  it('disables days outside min/max', async () => {
    const user = userEvent.setup();
    render(
      <JalaliDatePicker
        value={fromJalali(1405, 6, 15)}
        onChange={() => {}}
        min={fromJalali(1405, 6, 10)}
        max={fromJalali(1405, 6, 20)}
      />,
    );
    await user.click(screen.getByRole('button', { name: /شهریور/ }));
    expect(screen.getByRole('button', { name: '۹ شهریور ۱۴۰۵' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '۱۰ شهریور ۱۴۰۵' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '۲۰ شهریور ۱۴۰۵' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '۲۱ شهریور ۱۴۰۵' })).toBeDisabled();
  });

  it('can be cleared', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<JalaliDatePicker value={fromJalali(1405, 6, 15)} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'پاک‌کردن تاریخ' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('JalaliDateTimeInput', () => {
  it('keeps the chosen time when the day changes and the day when the time changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const value = fromJalali(1405, 6, 15, 18, 30);
    render(<JalaliDateTimeInput value={value} onChange={onChange} aria-label="زمان انتشار" />);

    await user.selectOptions(screen.getByLabelText('ساعت'), '9');
    let next = onChange.mock.calls.at(-1)![0] as Date;
    expect(toJalali(next)).toEqual({ jy: 1405, jm: 6, jd: 15 });
    expect(tehranWallClock(next).hour).toBe(9);
    expect(tehranWallClock(next).minute).toBe(30);

    await user.click(screen.getByRole('button', { name: 'زمان انتشار' }));
    await user.click(screen.getByRole('button', { name: '۲۱ شهریور ۱۴۰۵' }));
    next = onChange.mock.calls.at(-1)![0] as Date;
    expect(toJalali(next).jd).toBe(21);
    expect(tehranWallClock(next)).toMatchObject({ hour: 18, minute: 30 });
    void within;
  });

  it('disables the time selectors until a day is chosen', () => {
    render(<JalaliDateTimeInput value={null} onChange={() => {}} />);
    expect(screen.getByLabelText('ساعت')).toBeDisabled();
    expect(screen.getByLabelText('دقیقه')).toBeDisabled();
  });
});
