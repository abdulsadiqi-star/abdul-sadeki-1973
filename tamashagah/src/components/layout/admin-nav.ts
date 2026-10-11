import type { Route } from 'next';
import { BadgeCheck, Flag, History, LayoutDashboard, LifeBuoy, Tv, Users, Video, Wallet, type LucideIcon } from 'lucide-react';
import type { Capability } from '@/features/admin/policy';
import type { NavCounts } from '@/features/admin/queries/overview';

export type AdminNavItem = {
  href: Route;
  label: string;
  icon: LucideIcon;
  match?: 'exact' | 'prefix';
  /** Sidebar badge: how many items of this section wait for a human. */
  badge?: keyof NavCounts;
  /** Hidden (and guarded by the page itself) for roles without this capability. */
  capability?: Capability;
};

/** Staff panel navigation, in the order of the specification. */
export const adminNav: AdminNavItem[] = [
  { href: '/admin', label: 'نمای کلی', icon: LayoutDashboard, match: 'exact' },
  { href: '/admin/reports', label: 'گزارش‌ها', icon: Flag, badge: 'reports' },
  { href: '/admin/videos', label: 'ویدیوها', icon: Video },
  { href: '/admin/channels', label: 'کانال‌ها', icon: Tv },
  { href: '/admin/users', label: 'کاربران', icon: Users },
  { href: '/admin/monetization', label: 'درخواست‌های درآمدزایی', icon: Wallet, badge: 'monetization', capability: 'monetization.review' },
  { href: '/admin/verification', label: 'درخواست‌های تیک تأیید', icon: BadgeCheck, badge: 'verification' },
  { href: '/admin/support', label: 'پشتیبانی', icon: LifeBuoy, badge: 'support' },
  { href: '/admin/activity', label: 'گزارش فعالیت‌ها', icon: History },
];
