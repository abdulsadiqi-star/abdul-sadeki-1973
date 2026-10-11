'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Captions, Check, Gauge, Keyboard, SlidersHorizontal } from 'lucide-react';
import { ChevronEnd, ChevronStart } from '@/components/icons';
import { useFormatter } from '@/components/providers/format-provider';
import { cn } from '@/lib/utils';
import { playerLabels } from './labels';
import { SPEEDS, qualityLabel, type QualityOption } from './player-utils';
import type { Quality } from './use-hls';

export type PlayerSubtitle = { id: string; lang: string; label: string; src: string; isDefault?: boolean };

type View = 'root' | 'speed' | 'quality' | 'captions';

type Props = {
  open: boolean;
  /** `restoreFocus` is true when the menu closed by keyboard (Esc / selection), so focus returns to its button. */
  onClose: (restoreFocus: boolean) => void;
  /** The element that opens the menu (clicks on it are not "outside"). */
  triggerRef: React.RefObject<HTMLElement | null>;
  rate: number;
  onRate: (rate: number) => void;
  qualities: QualityOption[];
  quality: Quality;
  activeHeight: number | null;
  onQuality: (quality: Quality) => void;
  subtitles: PlayerSubtitle[];
  activeSubtitleId: string | null;
  onSubtitle: (id: string | null) => void;
  onShowShortcuts: () => void;
};

const itemClass =
  'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start text-sm outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/15';

/**
 * Settings panel (speed, quality, subtitles, keyboard help). Rendered INSIDE the player so it stays visible in
 * fullscreen (portalled menus would be hidden behind the fullscreen element). Two levels, roving keyboard focus,
 * Esc steps back / closes, clicking elsewhere closes.
 */
export function PlayerMenu(props: Props) {
  const { open, onClose, triggerRef } = props;
  const f = useFormatter();
  const [view, setView] = useState<View>('root');
  const panelRef = useRef<HTMLDivElement>(null);

  // Always start from the root list when (re)opened.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setView('root');
  }

  // Focus the active (or first) item whenever the visible list changes.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const target = panel?.querySelector<HTMLElement>('[aria-checked="true"]') ?? panel?.querySelector<HTMLElement>('[role^="menuitem"]');
    target?.focus();
  }, [open, view]);

  // Click / touch outside closes the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const node = e.target as Node | null;
      if (panelRef.current?.contains(node) || triggerRef.current?.contains(node)) return;
      onClose(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  const speedText = (r: number) => (r === 1 ? playerLabels.speedNormal : `${f.number(r)}×`);
  const qualityText =
    props.quality === 'auto'
      ? props.activeHeight
        ? playerLabels.qualityAutoActive(qualityLabel(props.activeHeight))
        : playerLabels.qualityAuto
      : qualityLabel(props.quality);
  const activeSubtitle = props.subtitles.find((s) => s.id === props.activeSubtitleId);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // While the menu has focus no player-wide shortcut may fire (arrows must not seek or change the volume behind it).
    if (e.key !== 'Tab') e.stopPropagation();
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []).filter((el) => el.offsetParent !== null);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focus = (i: number) => items[(i + items.length) % items.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focus(index + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focus(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        focus(0);
        break;
      case 'End':
        e.preventDefault();
        focus(items.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        if (view === 'root') onClose(true);
        else setView('root');
        break;
      case 'Tab':
        onClose(false);
        break;
    }
  }

  const choose = (apply: () => void) => {
    apply();
    onClose(true);
  };

  let body: ReactNode;
  if (view === 'root') {
    body = (
      <>
        <MenuItem
          icon={<Gauge />}
          label={playerLabels.speed}
          value={props.rate === 1 ? playerLabels.speedNormal : <span dir="ltr">{speedText(props.rate)}</span>}
          onClick={() => setView('speed')}
          hasSubmenu
        />
        {props.qualities.length > 0 && (
          <MenuItem
            icon={<SlidersHorizontal />}
            label={playerLabels.quality}
            value={props.quality === 'auto' ? <ActiveQuality text={qualityText} /> : <span dir="ltr">{qualityText}</span>}
            onClick={() => setView('quality')}
            hasSubmenu
          />
        )}
        {props.subtitles.length > 0 && (
          <MenuItem
            icon={<Captions />}
            label={playerLabels.subtitles}
            value={activeSubtitle?.label ?? playerLabels.subtitlesOff}
            onClick={() => setView('captions')}
            hasSubmenu
          />
        )}
        <MenuItem
          icon={<Keyboard />}
          label={playerLabels.shortcuts}
          className="hidden md:flex"
          onClick={() => {
            onClose(false);
            props.onShowShortcuts();
          }}
        />
      </>
    );
  } else if (view === 'speed') {
    body = (
      <SubMenu title={playerLabels.speed} onBack={() => setView('root')}>
        {SPEEDS.map((r) => (
          <RadioItem key={r} checked={props.rate === r} onClick={() => choose(() => props.onRate(r))}>
            <span dir="ltr">{speedText(r)}</span>
          </RadioItem>
        ))}
      </SubMenu>
    );
  } else if (view === 'quality') {
    body = (
      <SubMenu title={playerLabels.quality} onBack={() => setView('root')}>
        <RadioItem checked={props.quality === 'auto'} onClick={() => choose(() => props.onQuality('auto'))}>
          <span>{props.quality === 'auto' ? <ActiveQuality text={qualityText} /> : playerLabels.qualityAuto}</span>
        </RadioItem>
        {props.qualities.map((q) => (
          <RadioItem key={q.height} checked={props.quality === q.height} onClick={() => choose(() => props.onQuality(q.height))}>
            <span dir="ltr">{qualityLabel(q.height)}</span>
          </RadioItem>
        ))}
      </SubMenu>
    );
  } else {
    body = (
      <SubMenu title={playerLabels.subtitles} onBack={() => setView('root')}>
        <RadioItem checked={props.activeSubtitleId === null} onClick={() => choose(() => props.onSubtitle(null))}>
          {playerLabels.subtitlesOff}
        </RadioItem>
        {props.subtitles.map((s) => (
          <RadioItem key={s.id} checked={props.activeSubtitleId === s.id} onClick={() => choose(() => props.onSubtitle(s.id))}>
            {s.label}
          </RadioItem>
        ))}
      </SubMenu>
    );
  }

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label={playerLabels.settings}
      onKeyDown={onKeyDown}
      className="absolute end-3 bottom-16 z-30 max-h-[calc(100%-5rem)] w-60 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-xl bg-black/90 py-1 text-white shadow-xl ring-1 ring-white/10 backdrop-blur"
    >
      {body}
    </div>
  );
}

/** "خودکار (720p)": the Persian word with the resolution isolated as LTR. */
function ActiveQuality({ text }: { text: string }) {
  const match = /^(.*?)\((\d+p)\)$/.exec(text);
  if (!match) return <>{text}</>;
  return (
    <>
      {match[1]}(<span dir="ltr">{match[2]}</span>)
    </>
  );
}

function MenuItem({ icon, label, value, onClick, hasSubmenu, className }: { icon: ReactNode; label: string; value?: ReactNode; onClick: () => void; hasSubmenu?: boolean; className?: string }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={cn(itemClass, className)}>
      <span className="flex items-center gap-3 [&_svg]:size-4.5 [&_svg]:shrink-0 [&_svg]:text-white/70">
        {icon}
        {label}
      </span>
      <span className="flex items-center gap-1 text-white/70">
        {value && <span className="max-w-28 truncate text-xs">{value}</span>}
        {hasSubmenu && <ChevronEnd className="size-4" />}
      </span>
    </button>
  );
}

function SubMenu({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <>
      <button type="button" role="menuitem" onClick={onBack} aria-label={`${playerLabels.back}: ${title}`} className={cn(itemClass, 'justify-start gap-2 border-b border-white/10 font-semibold')}>
        <ChevronStart className="size-4" />
        {title}
      </button>
      {children}
    </>
  );
}

function RadioItem({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} onClick={onClick} className={cn(itemClass, checked && 'font-semibold')}>
      <span className="flex items-center gap-2">{children}</span>
      {checked && <Check className="size-4 text-[oklch(0.72_0.17_293)]" />}
    </button>
  );
}
