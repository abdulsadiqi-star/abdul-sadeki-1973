import { FilterBar } from '@/components/admin/filter-bar';
import { actionTypeGroups, actionTypeLabels } from '@/features/admin/labels';
import type { ModerationActionType } from '@/generated/prisma/enums';

/**
 * Audit-log filters: actor, action type, target, and a Jalali date range. The type list only offers what the viewer can
 * see (moderators never see account / money decisions of others, so they are not offered either).
 */
export function ActivityFilters({
  values,
  hiddenTypes,
}: {
  values: { actor: string; type: string; target: string; from: string; to: string };
  hiddenTypes: readonly ModerationActionType[];
}) {
  const options = [
    { value: 'ALL', label: 'همه‌ی اقدام‌ها' },
    ...actionTypeGroups.flatMap((g) =>
      g.types.filter((t) => !hiddenTypes.includes(t)).map((t) => ({ value: t, label: actionTypeLabels[t], group: g.label })),
    ),
  ];
  return (
    <FilterBar
      key={JSON.stringify(values)}
      label="فیلتر گزارش فعالیت‌ها"
      values={values}
      fields={[
        { kind: 'search', name: 'actor', label: 'تصمیم‌گیرنده', placeholder: 'نام یا ایمیل' },
        { kind: 'search', name: 'target', label: 'مورد', placeholder: 'شناسه‌ی ویدیو، کانال، ایمیل یا نام' },
        { kind: 'select', name: 'type', label: 'نوع اقدام', defaultValue: 'ALL', options },
        { kind: 'date', name: 'from', label: 'از تاریخ' },
        { kind: 'date', name: 'to', label: 'تا تاریخ' },
      ]}
    />
  );
}
