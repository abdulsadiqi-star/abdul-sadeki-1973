'use client';

import { useState, type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Clapperboard, UserRound } from 'lucide-react';

export type SettingsTab = 'account' | 'channel';

/**
 * Account / channel tabs. The active tab lives in `?tab=` (deep links from menus, reload keeps it) and is updated with
 * the History API, so switching never re-runs the server component. Both panels stay mounted (hidden when inactive)
 * so a half-edited form is not lost when the user peeks at the other tab. Users without a channel get no channel tab.
 */
export function SettingsTabs({ initial, account, channel }: { initial: SettingsTab; account: ReactNode; channel: ReactNode | null }) {
  const [tab, setTab] = useState<SettingsTab>(channel ? initial : 'account');

  function onChange(next: string) {
    const value = next === 'channel' ? 'channel' : 'account';
    setTab(value);
    const url = new URL(window.location.href);
    if (value === 'account') url.searchParams.delete('tab');
    else url.searchParams.set('tab', value);
    window.history.replaceState(null, '', url);
  }

  return (
    <Tabs value={tab} onValueChange={onChange} className="gap-6">
      <TabsList variant="underline" aria-label="بخش‌های تنظیمات">
        <TabsTrigger value="account">
          <UserRound /> حساب کاربری
        </TabsTrigger>
        {channel && (
          <TabsTrigger value="channel">
            <Clapperboard /> کانال
          </TabsTrigger>
        )}
      </TabsList>
      <TabsContent value="account" forceMount className="space-y-6 data-[state=inactive]:hidden">
        {account}
      </TabsContent>
      {channel && (
        <TabsContent value="channel" forceMount className="space-y-6 data-[state=inactive]:hidden">
          {channel}
        </TabsContent>
      )}
    </Tabs>
  );
}
