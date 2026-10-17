'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import {
  BarChart3,
  Check,
  Clapperboard,
  ExternalLink,
  Hash,
  LifeBuoy,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Settings,
  ShieldCheck,
  Sun,
  Video,
  Wallet,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChannelAvatar } from '@/components/channel-avatar';
import { VerifiedBadge } from '@/components/verified-badge';
import { useFormatter } from '@/components/providers/format-provider';
import { logoutAction, setDigitStyleAction } from '@/features/auth/actions';
import { labels } from '@/lib/i18n/fa';
import type { UserRole } from '@/generated/prisma/enums';

export type UserMenuUser = {
  displayName: string;
  email: string;
  avatarUrl: string | null;
  role: UserRole;
  channel: { handle: string; name: string; avatarUrl: string | null; isVerified: boolean } | null;
};

export function UserMenu({ user }: { user: UserMenuUser }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const f = useFormatter();
  const [pending, startTransition] = useTransition();

  const name = user.channel?.name ?? user.displayName;
  const avatar = user.channel?.avatarUrl ?? user.avatarUrl;
  const isStaff = user.role === 'MODERATOR' || user.role === 'ADMIN';

  function logout() {
    startTransition(async () => {
      const res = await logoutAction();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      router.push('/');
      router.refresh();
    });
  }

  function setDigits(value: string) {
    startTransition(async () => {
      const res = await setDigitStyleAction({ digitStyle: value === 'en' ? 'EN' : 'FA' });
      if (!res.ok) toast.error(res.message);
      else router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="منوی حساب کاربری"
          className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChannelAvatar name={name} src={avatar} size="md" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <div className="flex items-center gap-3 px-2.5 py-2.5">
          <ChannelAvatar name={name} src={avatar} size="lg" className="size-12 text-base" />
          <div className="min-w-0">
            <p className="flex items-center gap-1 truncate text-sm font-bold" dir="auto">
              <span className="truncate">{name}</span>
              {user.channel?.isVerified && <VerifiedBadge />}
            </p>
            <p className="ltr-isolate truncate text-xs text-muted-foreground">{user.email}</p>
            {user.channel ? (
              <Link
                href={`/channel/${user.channel.handle}`}
                className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <ExternalLink className="size-3" /> مشاهده‌ی کانال
              </Link>
            ) : (
              <span className="mt-0.5 block text-xs text-muted-foreground">{labels.role[user.role]}</span>
            )}
          </div>
        </div>
        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          {user.channel ? (
            <>
              <DropdownMenuItem asChild>
                <Link href="/studio">
                  <Clapperboard /> مدیریت کانال
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/studio/videos">
                  <Video /> ویدیوهای من
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/studio/analytics">
                  <BarChart3 /> آمار بازدید
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/studio/monetization">
                  <Wallet /> درآمدزایی
                </Link>
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem asChild>
              <Link href="/studio">
                <Clapperboard /> ساخت کانال
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link href="/studio/settings">
              <Settings /> تنظیمات حساب
            </Link>
          </DropdownMenuItem>
          {isStaff && (
            <DropdownMenuItem asChild>
              <Link href="/admin">
                <ShieldCheck /> پنل مدیریت
              </Link>
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette /> ظاهر
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light">
                <Sun /> روشن
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon /> تیره
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <Monitor /> مطابق سیستم
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Hash /> ارقام
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={f.digits} onValueChange={setDigits}>
              <DropdownMenuRadioItem value="fa">فارسی (۱۲۳)</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="en">انگلیسی (123)</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem asChild>
          <Link href="/help">
            <LifeBuoy /> راهنما و پشتیبانی
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={pending} onSelect={(e) => { e.preventDefault(); logout(); }}>
          {pending ? <Check className="animate-pulse" /> : <LogOut />} خروج از حساب
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
