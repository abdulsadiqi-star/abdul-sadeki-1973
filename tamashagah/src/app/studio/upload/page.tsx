import { PageHeader } from '@/components/page-header';
import { UploadManager } from '@/components/studio/upload-manager';
import { requirePageChannelUser } from '@/lib/auth/guards';
import { getCategories } from '@/features/categories/queries';
import { readUploadLimits } from '@/features/uploads/service';
import { getPendingUploads, getProcessingVideos, getUploadUsage } from '@/features/videos-studio/queries';

export const metadata = { title: 'بارگذاری ویدیو' };
export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  const user = await requirePageChannelUser('/studio/upload');
  const channelId = user.channel.id;
  const [categories, pending, processing, usage] = await Promise.all([
    getCategories(),
    getPendingUploads(channelId),
    getProcessingVideos(channelId),
    getUploadUsage(channelId),
  ]);

  return (
    <>
      <PageHeader
        title="بارگذاری ویدیو"
        description="فایل را انتخاب کنید؛ هم‌زمان با بارگذاری می‌توانید عنوان و تنظیمات انتشار را وارد کنید."
      />
      <UploadManager
        limits={readUploadLimits()}
        usage={usage}
        emailVerified={user.emailVerified}
        categories={categories.map((category) => ({ id: category.id, nameFa: category.nameFa }))}
        defaultVisibility={user.channel.defaultVisibility}
        pending={pending}
        processing={processing}
      />
    </>
  );
}
