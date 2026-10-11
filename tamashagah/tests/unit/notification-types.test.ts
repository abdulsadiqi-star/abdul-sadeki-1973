import { describe, expect, it } from 'vitest';
import { NotificationType } from '@/generated/prisma/enums';
import { notificationTitle, notificationTypeMeta } from '@/features/notifications/types';

const PERSIAN = /[؀-ۿ]/;

describe('notification copy', () => {
  const types = Object.values(NotificationType);

  it('covers every NotificationType with natural Persian copy', () => {
    expect(Object.keys(notificationTypeMeta).sort()).toEqual([...types].sort());
    for (const type of types) {
      const meta = notificationTypeMeta[type];
      expect(meta.label, `${type} label`).toMatch(PERSIAN);
      expect(meta.fallbackTitle, `${type} fallback`).toMatch(PERSIAN);
      // sentences have no stray spaces, trailing dots or Latin leftovers
      expect(meta.fallbackTitle, type).toBe(meta.fallbackTitle.trim());
      expect(meta.fallbackTitle, type).not.toMatch(/[.:]$/);
      expect(meta.fallbackTitle, type).not.toMatch(/[A-Za-z_]/);
      expect(meta.label, type).not.toMatch(/[A-Za-z_]/);
    }
  });

  it('keeps labels short enough for a chip and unique enough to tell types apart', () => {
    const labels = types.map((t) => notificationTypeMeta[t].label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label.length).toBeLessThanOrEqual(24);
  });

  it('uses the stored title and falls back to the type sentence only when it is empty', () => {
    expect(notificationTitle({ type: 'NEW_FOLLOWER', title: 'سارا کانال شما را دنبال کرد' })).toBe('سارا کانال شما را دنبال کرد');
    expect(notificationTitle({ type: 'NEW_FOLLOWER', title: '   ' })).toBe(notificationTypeMeta.NEW_FOLLOWER.fallbackTitle);
    expect(notificationTitle({ type: 'SYSTEM', title: '' })).toBe(notificationTypeMeta.SYSTEM.fallbackTitle);
  });
});
