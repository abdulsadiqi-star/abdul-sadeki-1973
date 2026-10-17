import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Direction } from 'radix-ui';
import { SeekBar } from '@/components/player/seek-bar';
import { playerLabels } from '@/components/player/labels';

function renderBar(props: Partial<React.ComponentProps<typeof SeekBar>> = {}, dir: 'rtl' | 'ltr' = 'rtl') {
  const onSeek = vi.fn();
  render(
    <Direction.Provider dir={dir}>
      <SeekBar currentTime={30} duration={120} buffered={[[0, 60]]} onSeek={onSeek} {...props} />
    </Direction.Provider>,
  );
  return { onSeek, slider: screen.getByRole('slider', { name: playerLabels.seek }) };
}

/** jsdom has no layout and no pointer capture: give the bar a 200 px box starting at x = 100. */
function sizeBar(slider: HTMLElement) {
  slider.getBoundingClientRect = () => ({ x: 100, y: 0, left: 100, right: 300, top: 0, bottom: 24, width: 200, height: 24, toJSON: () => ({}) });
  slider.setPointerCapture = () => undefined;
}

describe('SeekBar (RTL)', () => {
  it('exposes the position to assistive technology in Persian', () => {
    const { slider } = renderBar();
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '120');
    expect(slider).toHaveAttribute('aria-valuenow', '30');
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining('از'));
  });

  it('← goes forward and → goes backward, following the visual direction of the bar', async () => {
    const user = userEvent.setup();
    const { slider, onSeek } = renderBar();
    slider.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onSeek).toHaveBeenLastCalledWith(35);
    await user.keyboard('{ArrowRight}');
    expect(onSeek).toHaveBeenLastCalledWith(25);
  });

  it('is mirrored in LTR', async () => {
    const user = userEvent.setup();
    const { slider, onSeek } = renderBar({}, 'ltr');
    slider.focus();
    await user.keyboard('{ArrowRight}');
    expect(onSeek).toHaveBeenLastCalledWith(35);
  });

  it('Home, End and Page keys jump', async () => {
    const user = userEvent.setup();
    const { slider, onSeek } = renderBar();
    slider.focus();
    await user.keyboard('{Home}');
    expect(onSeek).toHaveBeenLastCalledWith(0);
    await user.keyboard('{End}');
    expect(onSeek).toHaveBeenLastCalledWith(120);
    await user.keyboard('{PageUp}');
    expect(onSeek).toHaveBeenLastCalledWith(40);
  });

  it('never seeks past the ends', async () => {
    const user = userEvent.setup();
    const { slider, onSeek } = renderBar({ currentTime: 118 });
    slider.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onSeek).toHaveBeenLastCalledWith(120);
  });

  it('a click near the LEFT end is late in the video (the bar starts on the right)', () => {
    const { slider, onSeek } = renderBar();
    sizeBar(slider);
    fireEvent.pointerDown(slider, { clientX: 130, pointerId: 1, button: 0 }); // 30 px from the left = 85 % of the way
    fireEvent.pointerUp(slider, { clientX: 130, pointerId: 1, button: 0 });
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek.mock.calls[0]![0]).toBeCloseTo(102, 5);
  });

  it('a click near the RIGHT end is early in the video', () => {
    const { slider, onSeek } = renderBar();
    sizeBar(slider);
    fireEvent.pointerDown(slider, { clientX: 290, pointerId: 1, button: 0 });
    fireEvent.pointerUp(slider, { clientX: 290, pointerId: 1, button: 0 });
    expect(onSeek.mock.calls[0]![0]).toBeCloseTo(6, 5);
  });

  it('is inert until the duration is known', async () => {
    const user = userEvent.setup();
    const { slider, onSeek } = renderBar({ duration: 0 });
    expect(slider).toHaveAttribute('aria-disabled', 'true');
    slider.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onSeek).not.toHaveBeenCalled();
  });
});
