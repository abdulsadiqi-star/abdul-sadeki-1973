import type { Route } from 'next';
import {
  BarChart3,
  Clock,
  Flame,
  History,
  Home,
  Info,
  LayoutDashboard,
  LifeBuoy,
  Library,
  MessageSquare,
  Settings,
  Shield,
  Smartphone,
  ThumbsUp,
  Users,
  Video,
  Wallet,
  Bell,
  Zap,
  FileText,
  Copyright,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  href: Route;
  label: string;
  icon: LucideIcon;
  /** `exact` highlights only on the same path; default `prefix`. */
  match?: 'exact' | 'prefix';
};

export const primaryNav: NavItem[] = [
  { href: '/', label: 'خانه', icon: Home, match: 'exact' },
  { href: '/shorts', label: 'شورتس', icon: Zap },
  { href: '/search?sort=popular', label: 'پرطرفدارها', icon: Flame, match: 'exact' },
];

export const libraryNav: NavItem[] = [
  { href: '/library/following', label: 'کانال‌های دنبال‌شده', icon: Users },
  { href: '/library/history', label: 'تاریخچه‌ی تماشا', icon: History },
  { href: '/library/watch-later', label: 'بعداً تماشا می‌کنم', icon: Clock },
  { href: '/library/liked', label: 'ویدیوهای پسندیده', icon: ThumbsUp },
  { href: '/library', label: 'کتابخانه‌ی من', icon: Library, match: 'exact' },
];

export const infoNav: NavItem[] = [
  { href: '/about', label: 'درباره‌ی ما', icon: Info },
  { href: '/help', label: 'راهنما و پشتیبانی', icon: LifeBuoy },
  { href: '/apps', label: 'اپلیکیشن‌ها', icon: Smartphone },
  { href: '/copyright', label: 'حق تکثیر', icon: Copyright },
  { href: '/terms', label: 'قوانین و مقررات', icon: FileText },
  { href: '/privacy', label: 'حریم خصوصی', icon: Shield },
];

/** Creator studio navigation (mirrors the reference dashboard). */
export const studioNav: NavItem[] = [
  { href: '/studio', label: 'داشبورد', icon: LayoutDashboard, match: 'exact' },
  { href: '/studio/videos', label: 'ویدیوهای من', icon: Video },
  { href: '/studio/comments', label: 'دیدگاه‌ها', icon: MessageSquare },
  { href: '/studio/analytics', label: 'آمار بازدید', icon: BarChart3 },
  { href: '/studio/monetization', label: 'درآمدزایی', icon: Wallet },
  { href: '/studio/notifications', label: 'اعلان‌ها', icon: Bell },
  { href: '/studio/settings', label: 'تنظیمات', icon: Settings },
];

export function isActivePath(pathname: string, item: Pick<NavItem, 'href' | 'match'>): boolean {
  const path = item.href.split('?')[0]!;
  if (item.match === 'exact') {
    // "/search?sort=popular" should only be active when that query is present.
    return pathname === path;
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}
