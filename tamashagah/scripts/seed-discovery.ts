/**
 * Demo catalogue for the discovery pages (home, search, categories, channels, shorts, library).
 *
 *   pnpm exec tsx --env-file-if-exists=.env scripts/seed-discovery.ts          # idempotent
 *
 * Needs `pnpm db:seed` first (categories + demo accounts). Creates 6 more demo channels, ~40 videos with abstract posters,
 * 12 shorts with REAL playable HLS (ffmpeg lavfi), and synthetic activity: every ViewEvent has `source = 'SEED'`; likes,
 * follows, comments and watch history come from `demo-viewer-NN@tamashagah.test` accounts (nobody can log in as them).
 * Counters (viewCount, likeCount, followerCount, commentCount) are derived from the rows, so they stay honest.
 */
import { randomToken } from '../src/lib/ids';
import { hashPassword } from '../src/lib/auth/password';
import { db } from '../src/lib/db';
import { watchLaterPlaylistId } from '../src/lib/ids';
import { buildChannelSearchName } from '../src/lib/persian';
import { chunk } from '../src/lib/utils';
import { createMediaVideo, disposeFixtures, seededRng, stableVideoId, storeChannelImages } from './discovery-fixtures';

const DAY = 86_400_000;
const NOW = Date.now();

type ChannelDef = { handle: string; name: string; description: string; verified?: boolean; links?: { title: string; url: string }[] };

const NEW_CHANNELS: ChannelDef[] = [
  { handle: 'varzeshkade', name: 'ورزش‌کده', description: 'تمرین، تغذیه و تحلیل ورزشی برای همه‌ی سطوح؛ از تمرین در خانه تا خلاصه‌ی بازی‌های هفته.' },
  { handle: 'zende-music', name: 'موسیقی زنده', description: 'اجراهای زنده و آموزش ساز؛ از سه‌تار و دف تا گیتار و پیانو.' },
  { handle: 'kodakaneha', name: 'کودکانه‌ها', description: 'قصه، آواز و کاردستی برای بچه‌های کنجکاو و پدر و مادرهایشان.' },
  { handle: 'tanz-rooz', name: 'طنز روزانه', description: 'دقیقه‌ای که لبخند می‌آورد؛ طنز موقعیت و تقلید از زندگی روزمره.' },
  {
    handle: 'azad-amoozesh',
    name: 'آموزش آزاد',
    description: 'درس‌های کوتاه و روشن برای دانش‌آموزان و دانشجویان؛ ریاضی، زبان، مهارت‌های مطالعه و تاریخ هنر.',
    verified: true,
    links: [{ title: 'وب‌سایت آموزش آزاد', url: 'https://azad-amoozesh.example.org' }],
  },
  { handle: 'khabar-elmi', name: 'خبر علمی', description: 'مرور هفتگی اخبار علم و فناوری به زبان ساده، بدون اغراق و تیتر‌های کلیک‌خور.' },
];

type VideoDef = {
  channel: string;
  category: string;
  title: string;
  description: string;
  tags: string[];
  /** minutes (videos) — shorts are always 5 s */
  min?: number;
  ageDays: number;
  /** relative popularity (events ≈ weight × 45) */
  weight: number;
  hot?: boolean;
  short?: boolean;
};

const VIDEOS: VideoDef[] = [
  // --- آشپزی با سارا
  { channel: 'sara-cooks', category: 'cooking', title: 'طرز تهیه‌ی قورمه‌سبزی اصیل ایرانی', description: 'قورمه‌سبزی را همان‌طور که مادربزرگ‌ها می‌پختند درست می‌کنیم: سبزی خوب سرخ‌شده، لیمو‌عمانی و کمی صبر.', tags: ['قورمه‌سبزی', 'غذای ایرانی', 'آشپزی'], min: 18.5, ageDays: 3, weight: 9, hot: true },
  { channel: 'sara-cooks', category: 'cooking', title: 'کباب تابه‌ای مجلسی در ۳۰ دقیقه', description: 'برای مهمانی‌های ناگهانی؛ کباب تابه‌ای نرم و آبدار با مواد ساده.', tags: ['کباب', 'کباب تابه‌ای', 'غذای مجلسی'], min: 12.4, ageDays: 9, weight: 6 },
  { channel: 'sara-cooks', category: 'cooking', title: 'آش رشته‌ی سنتی؛ از خمیر تا سفره', description: 'آش رشته‌ی غلیظ با کشک و نعناداغ؛ همراه با رشته‌ی دست‌ساز.', tags: ['آش رشته', 'سنتی', 'غذای ایرانی'], min: 21, ageDays: 14, weight: 4 },
  { channel: 'sara-cooks', category: 'cooking', title: 'کیک شکلاتی خانگی بدون فر', description: 'کیک شکلاتی نرم و خوشمزه با قابلمه؛ بدون نیاز به فر.', tags: ['کیک', 'شکلات', 'دسر'], min: 9.2, ageDays: 20, weight: 7 },
  { channel: 'sara-cooks', category: 'cooking', title: 'سالاد شیرازی و مخلفات سفره', description: 'سالاد شیرازی خنک، ماست و خیار و ترشی‌ای که کنار هر غذایی می‌نشیند.', tags: ['سالاد شیرازی', 'مخلفات'], min: 6.7, ageDays: 31, weight: 2 },
  { channel: 'sara-cooks', category: 'cooking', title: 'صبحانه‌ی سریع برای روزهای پرمشغله', description: 'سه ایده‌ی ده‌دقیقه‌ای برای صبحانه‌ای سیرکننده و سالم.', tags: ['صبحانه', 'سریع', 'سالم'], min: 7.8, ageDays: 5, weight: 3 },
  // --- آرمان تک
  { channel: 'arman-tech', category: 'technology', title: 'آموزش پایتون برای مبتدیان — جلسه‌ی اول', description: 'در این جلسه پایتون را نصب می‌کنیم، اولین برنامه‌مان را می‌نویسیم و با متغیرها و انواع داده آشنا می‌شویم.', tags: ['پایتون', 'برنامه‌نویسی', 'آموزش', 'مبتدی'], min: 32, ageDays: 12, weight: 11, hot: true },
  { channel: 'arman-tech', category: 'technology', title: 'آموزش پایتون — شرط‌ها و حلقه‌ها', description: 'if و else، حلقه‌ی for و while و چند تمرین کوچک برای مسلط شدن.', tags: ['پایتون', 'برنامه‌نویسی', 'آموزش'], min: 27, ageDays: 8, weight: 8, hot: true },
  { channel: 'arman-tech', category: 'technology', title: 'آموزش پایتون — تابع‌ها و ماژول‌ها', description: 'تعریف تابع، آرگومان‌ها، مقدار بازگشتی و استفاده از ماژول‌های آماده.', tags: ['پایتون', 'برنامه‌نویسی', 'تابع'], min: 29, ageDays: 4, weight: 5 },
  { channel: 'arman-tech', category: 'technology', title: 'بررسی لپ‌تاپ‌های امسال؛ کدام را بخریم؟', description: 'مقایسه‌ی چند لپ‌تاپ پرفروش از نظر کارایی، باتری و قیمت.', tags: ['لپ‌تاپ', 'بررسی', 'خرید'], min: 19.5, ageDays: 6, weight: 6 },
  { channel: 'arman-tech', category: 'technology', title: 'جاوااسکریپت مدرن؛ از صفر تا یک پروژه‌ی واقعی', description: 'با ES2024 یک برنامه‌ی کوچک وب می‌سازیم و مفهوم‌های مهم را یاد می‌گیریم.', tags: ['جاوااسکریپت', 'وب', 'برنامه‌نویسی'], min: 41, ageDays: 18, weight: 7 },
  { channel: 'arman-tech', category: 'technology', title: 'امنیت حساب‌های کاربری؛ هفت نکته‌ی ضروری', description: 'گذرواژه‌ی قوی، تأیید دومرحله‌ای و چند عادت ساده که جلوی بیشتر هک‌ها را می‌گیرد.', tags: ['امنیت', 'گذرواژه', 'حریم خصوصی'], min: 11, ageDays: 25, weight: 3 },
  { channel: 'arman-tech', category: 'technology', title: 'بهترین گوشی‌های میان‌رده‌ی امسال', description: 'گوشی‌های میان‌رده‌ای که ارزش پولشان را دارند؛ با نقاط قوت و ضعف هر کدام.', tags: ['گوشی', 'بررسی', 'میان‌رده'], min: 15, ageDays: 2, weight: 4 },
  // --- سفرنامه‌ی نیکا
  { channel: 'nika-travel', category: 'travel', title: 'سفر به اصفهان؛ نصف جهان در پاییز', description: 'میدان نقش جهان، سی‌وسه‌پل و کوچه‌های قدیمی؛ دو روز پیاده‌روی در اصفهان پاییزی.', tags: ['اصفهان', 'سفر', 'گردشگری'], min: 16, ageDays: 7, weight: 8, hot: true },
  { channel: 'nika-travel', category: 'travel', title: 'شیراز در یک روز؛ حافظیه، نارنجستان و بازار وکیل', description: 'اگر فقط یک روز در شیراز وقت دارید، این مسیر را امتحان کنید.', tags: ['شیراز', 'سفر', 'حافظ'], min: 13, ageDays: 15, weight: 5 },
  { channel: 'nika-travel', category: 'travel', title: 'شب‌مانی در کویر مصر زیر آسمان پرستاره', description: 'یک شب چادر در دل کویر؛ از غروب تا طلوع.', tags: ['کویر', 'شب‌مانی', 'طبیعت‌گردی'], min: 18, ageDays: 22, weight: 6 },
  { channel: 'nika-travel', category: 'travel', title: 'راهنمای سفر به استانبول با بودجه‌ی کم', description: 'اقامت، حمل‌ونقل و غذا؛ چطور هزینه‌های سفر به استانبول را پایین بیاوریم.', tags: ['استانبول', 'ترکیه', 'سفر ارزان'], min: 22, ageDays: 11, weight: 4 },
  { channel: 'nika-travel', category: 'travel', title: 'غذاهای خیابانی استانبول', description: 'از بالیک‌اکمک تا سیمیت؛ هر چه در خیابان‌های استانبول می‌شود خورد.', tags: ['استانبول', 'غذا', 'سفر'], min: 10.5, ageDays: 3, weight: 3 },
  // --- ورزش‌کده
  { channel: 'varzeshkade', category: 'sports', title: 'تمرین کامل بدنسازی در خانه بدون وسیله', description: 'یک برنامه‌ی ۲۸ دقیقه‌ای برای تمام بدن؛ فقط به یک فرش کوچک نیاز دارید.', tags: ['بدنسازی', 'تمرین در خانه', 'تناسب اندام'], min: 28, ageDays: 5, weight: 7 },
  { channel: 'varzeshkade', category: 'sports', title: 'خلاصه‌ی بازی‌های پرگل هفته', description: 'گل‌ها و صحنه‌های مهم هفته در یک ویدیوی کوتاه.', tags: ['فوتبال', 'خلاصه بازی', 'گل'], min: 9, ageDays: 1, weight: 9, hot: true },
  { channel: 'varzeshkade', category: 'sports', title: 'شروع دویدن برای تازه‌کارها', description: 'برنامه‌ی چهار‌هفته‌ای برای کسی که می‌خواهد دویدن را شروع کند و زود خسته نشود.', tags: ['دویدن', 'ورزش', 'تناسب اندام'], min: 14, ageDays: 10, weight: 3 },
  { channel: 'varzeshkade', category: 'health', title: 'یوگا برای کمردرد؛ ۱۵ دقیقه هر روز', description: 'حرکت‌های ملایم برای کشش و تقویت ناحیه‌ی کمر.', tags: ['یوگا', 'کمردرد', 'سلامت'], min: 15, ageDays: 17, weight: 5 },
  // --- موسیقی زنده
  { channel: 'zende-music', category: 'music', title: 'اجرای زنده‌ی سه‌تار در دستگاه دشتی', description: 'نوازندگی سه‌تار در فضایی آرام؛ ضبط شده بدون ادیت.', tags: ['سه‌تار', 'دشتی', 'موسیقی ایرانی'], min: 8.5, ageDays: 13, weight: 4 },
  { channel: 'zende-music', category: 'music', title: 'آموزش گیتار — آکوردهای پایه', description: 'شش آکورد اصلی و چند ریتم ساده برای اولین آهنگ‌تان.', tags: ['گیتار', 'آموزش موسیقی', 'آکورد'], min: 24, ageDays: 6, weight: 6 },
  { channel: 'zende-music', category: 'music', title: 'کنسرت خیابانی؛ آهنگ‌های ماندگار قدیمی', description: 'اجرای خیابانی چند ترانه‌ی قدیمی با همراهی مردم.', tags: ['موسیقی', 'کنسرت', 'خیابانی'], min: 31, ageDays: 28, weight: 3 },
  // --- کودکانه‌ها
  { channel: 'kodakaneha', category: 'kids', title: 'قصه‌ی شب؛ روباه و کلاغ حیله‌گر', description: 'قصه‌ای کوتاه با صدای آرام برای قبل از خواب.', tags: ['قصه', 'کودک', 'شب‌بخیر'], min: 7, ageDays: 4, weight: 6 },
  { channel: 'kodakaneha', category: 'kids', title: 'آموزش الفبا با آواز', description: 'حروف الفبای فارسی را با یک آهنگ شاد یاد بگیریم.', tags: ['الفبا', 'آموزش', 'کودک'], min: 9, ageDays: 19, weight: 5 },
  { channel: 'kodakaneha', category: 'kids', title: 'کاردستی با کاغذ رنگی؛ قایق کاغذی', description: 'ساخت قایق کاغذی در چند مرحله‌ی ساده.', tags: ['کاردستی', 'کودک', 'کاغذ'], min: 6, ageDays: 9, weight: 3 },
  // --- طنز روزانه
  { channel: 'tanz-rooz', category: 'comedy', title: 'وقتی مهمان بی‌خبر می‌آید!', description: 'همه‌مان این صحنه را دیده‌ایم؛ خانه شلوغ، یخچال خالی.', tags: ['طنز', 'خانوادگی', 'مهمان'], min: 3.5, ageDays: 2, weight: 9, hot: true },
  { channel: 'tanz-rooz', category: 'comedy', title: 'دعوای همیشگی سر کنترل تلویزیون', description: 'ماجرای کنترلی که هیچ‌وقت سر جایش نیست.', tags: ['طنز', 'خانواده'], min: 2.8, ageDays: 12, weight: 5 },
  { channel: 'tanz-rooz', category: 'comedy', title: 'اگر ایرانی‌ها فضانورد بودند', description: 'تصور کنید پنج ایرانی در یک ایستگاه فضایی گیر کنند.', tags: ['طنز', 'فضا'], min: 4.1, ageDays: 21, weight: 4 },
  // --- آموزش آزاد
  { channel: 'azad-amoozesh', category: 'education', title: 'ریاضی کنکور — تابع و دامنه', description: 'مفهوم تابع، تعیین دامنه و چند تست مهم کنکور.', tags: ['ریاضی', 'کنکور', 'آموزش'], min: 26, ageDays: 8, weight: 6 },
  { channel: 'azad-amoozesh', category: 'education', title: '۱۰۰ لغت پرکاربرد انگلیسی', description: 'صد لغتی که در مکالمه‌ی روزمره بیش از همه می‌شنوید، همراه با مثال.', tags: ['زبان انگلیسی', 'لغت', 'آموزش'], min: 18, ageDays: 5, weight: 7 },
  { channel: 'azad-amoozesh', category: 'education', title: 'مدیریت زمان برای دانشجویان', description: 'چند روش ساده برای برنامه‌ریزی هفتگی و مقابله با عقب‌انداختن کارها.', tags: ['مدیریت زمان', 'دانشجو', 'مطالعه'], min: 12, ageDays: 16, weight: 4 },
  { channel: 'azad-amoozesh', category: 'art', title: 'تاریخ هنر ایران در ده دقیقه', description: 'مروری سریع بر هنر ایران از دوران باستان تا قاجار.', tags: ['تاریخ هنر', 'ایران'], min: 10.5, ageDays: 30, weight: 3 },
  // --- خبر علمی
  { channel: 'khabar-elmi', category: 'news', title: 'مرور اخبار علمی هفته', description: 'مهم‌ترین خبرهای علمی هفته در یازده دقیقه.', tags: ['علم', 'خبر', 'فناوری'], min: 11, ageDays: 1, weight: 5 },
  { channel: 'khabar-elmi', category: 'news', title: 'خلاصه‌ی اخبار دنیای فناوری', description: 'از رونمایی گجت‌های تازه تا تحولات دنیای نرم‌افزار.', tags: ['فناوری', 'خبر'], min: 8.5, ageDays: 6, weight: 3 },
  { channel: 'khabar-elmi', category: 'technology', title: 'کشف تازه‌ی ستاره‌شناسان درباره‌ی کهکشان‌های دور', description: 'تلسکوپ‌های جدید چه چیزهایی را دیده‌اند و چرا مهم است؟', tags: ['نجوم', 'علم'], min: 13, ageDays: 20, weight: 4 },
  // --- شورتس (5 ثانیه، HLS واقعی)
  { channel: 'sara-cooks', category: 'cooking', title: 'سه ترفند برای برنج دانه‌دانه', description: 'سه ترفند کوتاه برای پلوی آبکش‌شده.', tags: ['برنج', 'ترفند', 'آشپزی'], ageDays: 2, weight: 7, short: true, hot: true },
  { channel: 'arman-tech', category: 'technology', title: 'نکته‌ی سریع پایتون: list comprehension', description: 'ساخت لیست در یک خط.', tags: ['پایتون', 'نکته'], ageDays: 3, weight: 6, short: true },
  { channel: 'nika-travel', category: 'travel', title: 'یک دقیقه در بازار وکیل شیراز', description: 'قدم‌زدن در یکی از زیباترین بازارهای ایران.', tags: ['شیراز', 'بازار'], ageDays: 5, weight: 5, short: true },
  { channel: 'varzeshkade', category: 'health', title: 'حرکت ساده برای کمردرد', description: 'یک حرکت کششی که هر روز می‌توانید انجام دهید.', tags: ['کمردرد', 'ورزش'], ageDays: 1, weight: 6, short: true },
  { channel: 'zende-music', category: 'music', title: 'ریتم ساده‌ی دف برای شروع', description: 'اولین ریتم دف را همین حالا یاد بگیرید.', tags: ['دف', 'ریتم'], ageDays: 6, weight: 4, short: true },
  { channel: 'tanz-rooz', category: 'comedy', title: 'جوک روز؛ آقای راننده!', description: 'یک طنز یک‌دقیقه‌ای از ترافیک شهر.', tags: ['طنز', 'جوک'], ageDays: 1, weight: 8, short: true, hot: true },
  { channel: 'azad-amoozesh', category: 'education', title: 'لغت روز: Resilient', description: 'معنی و کاربرد یک لغت انگلیسی در هر کلیپ.', tags: ['زبان انگلیسی', 'لغت'], ageDays: 4, weight: 4, short: true },
  { channel: 'kodakaneha', category: 'kids', title: 'کاردستی شصت‌ثانیه‌ای', description: 'یک کاردستی سریع با وسایل دم‌دست.', tags: ['کاردستی', 'کودک'], ageDays: 7, weight: 3, short: true },
  { channel: 'arman-tech', category: 'technology', title: 'میانبر صفحه‌کلیدی که نمی‌دانستید', description: 'یک میانبر ساده که سرعت کارتان را بالا می‌برد.', tags: ['میانبر', 'کامپیوتر'], ageDays: 9, weight: 5, short: true },
  { channel: 'nika-travel', category: 'travel', title: 'غروب در کویر', description: 'پنج ثانیه آرامش.', tags: ['کویر', 'غروب'], ageDays: 8, weight: 3, short: true },
  { channel: 'azad-amoozesh', category: 'education', title: 'یک ترفند برای حفظ لغات', description: 'روش کارت‌های مرور برای یادگیری ماندگار.', tags: ['لغت', 'مطالعه'], ageDays: 10, weight: 3, short: true },
  { channel: 'sara-cooks', category: 'cooking', title: 'سس مخصوص ساندویچ', description: 'سس ساده‌ای که ساندویچ را عوض می‌کند.', tags: ['سس', 'ساندویچ'], ageDays: 12, weight: 4, short: true },
];

const COMMENTS = [
  'خیلی عالی بود، دست شما درد نکند!',
  'ممنون از آموزش خوبتان. دقیقاً همین چیزی بود که دنبالش بودم.',
  'مفید و کوتاه؛ ادامه بدهید لطفاً.',
  'من هم امتحان کردم، جواب داد.',
  'کیفیت تصویر و صدا خیلی خوب بود.',
  'میشه درباره‌ی بخش آخرش بیشتر توضیح بدید؟',
  'لذت بردم. حتماً برای دوستانم می‌فرستم.',
  'سپاس از شما، ویدیوهای بعدی را هم منتظریم.',
];

async function main() {
  const categories = new Map((await db.category.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]));
  if (categories.size === 0) throw new Error('No categories found — run `pnpm db:seed` first.');
  const viewerAccount = await db.user.findUnique({ where: { email: 'viewer@tamashagah.test' }, select: { id: true } });
  if (!viewerAccount) throw new Error('Demo accounts not found — run `pnpm db:seed` first.');
  const rng = seededRng('seed-discovery');

  // --- accounts: one hash, reused (nobody can log in as the extra demo accounts) --------------------------------------
  const unusablePasswordHash = await hashPassword(`${randomToken(18)}-A1`);
  const ensureUser = async (email: string, displayName: string, role: 'USER' | 'CREATOR') => {
    const found = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (found) return found.id;
    return (await db.user.create({ data: { email, displayName, role, emailVerifiedAt: new Date(), passwordHash: unusablePasswordHash }, select: { id: true } })).id;
  };

  const viewers: string[] = [];
  for (let i = 1; i <= 30; i++) viewers.push(await ensureUser(`demo-viewer-${String(i).padStart(2, '0')}@tamashagah.test`, `بیننده ${i}`, 'USER'));
  console.log(`✔ ${viewers.length} demo viewers`);

  // --- channels -------------------------------------------------------------------------------------------------------
  const channelIds = new Map<string, string>();
  for (const handle of ['sara-cooks', 'arman-tech', 'nika-travel']) {
    const channel = await db.channel.findUnique({ where: { handle }, select: { id: true, ownerId: true } });
    if (!channel) throw new Error(`Channel ${handle} missing — run \`pnpm db:seed\` first.`);
    channelIds.set(handle, channel.id);
  }
  for (const def of NEW_CHANNELS) {
    const ownerId = await ensureUser(`demo-${def.handle}@tamashagah.test`, def.name, 'CREATOR');
    const channel = await db.channel.upsert({
      where: { handle: def.handle },
      create: {
        ownerId,
        handle: def.handle,
        name: def.name,
        description: def.description,
        links: def.links,
        isVerified: !!def.verified,
        verifiedAt: def.verified ? new Date(NOW - 60 * DAY) : null,
        searchName: buildChannelSearchName(def.name, def.handle),
      },
      update: { name: def.name, description: def.description },
      select: { id: true },
    });
    channelIds.set(def.handle, channel.id);
  }
  await db.channel.update({ where: { handle: 'arman-tech' }, data: { isVerified: true, verifiedAt: new Date(NOW - 90 * DAY) } });
  for (const [handle, id] of channelIds) {
    const channel = await db.channel.findUniqueOrThrow({ where: { id }, select: { ownerId: true, avatarKey: true } });
    if (!channel.avatarKey) await db.channel.update({ where: { id }, data: await storeChannelImages(id, channel.ownerId, handle) });
  }
  console.log(`✔ ${channelIds.size} channels`);

  // --- videos -------------------------------------------------------------------------------------------------------------
  const created: { id: string; channelId: string; def: VideoDef; publishedAt: Date }[] = [];
  for (const def of VIDEOS) {
    const id = stableVideoId(`${def.channel}:${def.title}`);
    const publishedAt = new Date(NOW - def.ageDays * DAY - Math.floor(rng() * 10) * 3_600_000);
    const durationSeconds = def.short ? 5 : Math.round((def.min ?? 5) * 60);
    await createMediaVideo({
      id,
      channelId: channelIds.get(def.channel)!,
      categoryId: categories.get(def.category) ?? null,
      kind: def.short ? 'SHORT' : 'VIDEO',
      title: def.title,
      description: def.description,
      tags: def.tags,
      durationSeconds,
      publishedAt,
      withHls: !!def.short,
      hlsSeed: `short-${created.length % 4}`,
    });
    created.push({ id, channelId: channelIds.get(def.channel)!, def, publishedAt });
  }
  console.log(`✔ ${created.length} videos (${created.filter((c) => c.def.short).length} shorts with real HLS)`);

  // --- synthetic activity (source = SEED) -------------------------------------------------------------------------------
  const videoIds = created.map((c) => c.id);
  await db.viewEvent.deleteMany({ where: { videoId: { in: videoIds }, source: 'SEED' } });
  const devices = ['DESKTOP', 'MOBILE', 'MOBILE', 'TABLET'] as const;
  const referrers = ['direct', 'direct', 'google.com', 'instagram.com', 'telegram.org'];
  const events = created.flatMap((c) => {
    const span = Math.max(1, NOW - c.publishedAt.getTime());
    const total = Math.round(c.def.weight * (28 + rng() * 22)) + (c.def.hot ? 60 + Math.floor(rng() * 120) : 0);
    return Array.from({ length: total }, (_, i) => {
      // hot videos get a surge inside the last 3 days; the rest are spread with a bias toward publication
      const recentSurge = c.def.hot && i % 3 === 0;
      const at = recentSurge ? NOW - rng() * 3 * DAY : c.publishedAt.getTime() + Math.pow(rng(), 1.6) * span;
      const when = new Date(Math.min(NOW - 60_000, at));
      return {
        videoId: c.id,
        channelId: c.channelId,
        userId: null,
        viewerKey: randomToken(10),
        watchSeconds: Math.round(rng() * (c.def.short ? 5 : (c.def.min ?? 5) * 60)),
        device: devices[Math.floor(rng() * devices.length)]!,
        referrer: referrers[Math.floor(rng() * referrers.length)]!,
        source: 'SEED' as const,
        createdAt: when,
        lastBeatAt: when,
      };
    });
  });
  for (const batch of chunk(events, 1000)) await db.viewEvent.createMany({ data: batch });
  console.log(`✔ ${events.length} view events (source=SEED)`);

  // --- likes, comments, follows ------------------------------------------------------------------------------------
  const pickViewers = (n: number) => [...viewers].sort(() => rng() - 0.5).slice(0, n);
  for (const c of created) {
    const likers = pickViewers(Math.min(viewers.length, Math.round(c.def.weight * (1.2 + rng() * 1.2))));
    await db.videoLike.createMany({
      data: likers.map((userId) => ({ userId, videoId: c.id, createdAt: new Date(c.publishedAt.getTime() + rng() * (NOW - c.publishedAt.getTime())) })),
      skipDuplicates: true,
    });
    if (c.def.short) {
      const authors = pickViewers(2 + Math.floor(rng() * 4));
      const existing = await db.comment.count({ where: { videoId: c.id } });
      if (existing === 0) {
        await db.comment.createMany({
          data: authors.map((authorId, i) => ({
            videoId: c.id,
            authorId,
            body: COMMENTS[(i + c.id.charCodeAt(0)) % COMMENTS.length]!,
            status: 'APPROVED' as const,
            createdAt: new Date(NOW - rng() * DAY),
          })),
        });
      }
    }
  }
  const followRows: { userId: string; channelId: string }[] = [];
  const handles = [...channelIds.keys()];
  for (const userId of viewers) {
    for (const handle of [...handles].sort(() => rng() - 0.5).slice(0, 2 + Math.floor(rng() * 3))) followRows.push({ userId, channelId: channelIds.get(handle)! });
  }
  for (const handle of ['arman-tech', 'nika-travel']) followRows.push({ userId: viewerAccount.id, channelId: channelIds.get(handle)! });
  const existingFollows = await db.follow.count({ where: { userId: { in: [...viewers, viewerAccount.id] } } });
  if (existingFollows === 0) {
    await db.follow.createMany({ data: followRows, skipDuplicates: true });
    await db.followEvent.createMany({ data: followRows.map((r) => ({ channelId: r.channelId, userId: r.userId, type: 'FOLLOW' as const, source: 'SEED' as const, createdAt: new Date(NOW - rng() * 30 * DAY) })) });
  }

  // --- the demo viewer's own library ---------------------------------------------------------------------------------
  const byTitle = (needle: string) => created.find((c) => c.def.title.includes(needle))!;
  const history: [string, number, boolean, number][] = [
    ['قورمه‌سبزی', 0.45, false, 0.2],
    ['پایتون برای مبتدیان', 0.3, false, 0.5],
    ['سفر به اصفهان', 0.7, false, 1],
    ['کیک شکلاتی', 1, true, 2],
    ['شروع دویدن', 0.15, false, 3],
    ['وقتی مهمان', 1, true, 4],
    ['جاوااسکریپت مدرن', 0.55, false, 6],
  ];
  for (const [needle, fraction, completed, ago] of history) {
    const v = byTitle(needle);
    const duration = Math.round((v.def.min ?? 5) * 60);
    const at = new Date(NOW - ago * DAY);
    await db.watchHistory.upsert({
      where: { userId_videoId: { userId: viewerAccount.id, videoId: v.id } },
      create: { userId: viewerAccount.id, videoId: v.id, positionSeconds: completed ? duration : duration * fraction, watchedSeconds: duration * fraction, completed, firstWatchedAt: at, lastWatchedAt: at },
      update: {},
    });
  }
  for (const needle of ['شب‌مانی', 'آش رشته', 'کنسرت خیابانی', 'ریاضی کنکور']) {
    await db.videoLike.createMany({ data: [{ userId: viewerAccount.id, videoId: byTitle(needle).id }], skipDuplicates: true });
  }

  const wlId = watchLaterPlaylistId(viewerAccount.id);
  await db.playlist.upsert({ where: { id: wlId }, create: { id: wlId, ownerId: viewerAccount.id, kind: 'WATCH_LATER', title: 'بعداً تماشا می‌کنم', visibility: 'PRIVATE' }, update: {} });
  const playlists: { id: string; ownerId: string; title: string; description: string; visibility: 'PUBLIC' | 'PRIVATE'; items: string[] }[] = [
    { id: wlId, ownerId: viewerAccount.id, title: '', description: '', visibility: 'PRIVATE', items: ['راهنمای سفر به استانبول', 'تمرین کامل بدنسازی', 'آموزش گیتار', 'قصه‌ی شب'] },
    { id: 'pl_demo_viewer_code', ownerId: viewerAccount.id, title: 'آموزش‌های برنامه‌نویسی', description: 'ویدیوهایی که برای یادگیری پایتون و وب دنبال می‌کنم.', visibility: 'PUBLIC', items: ['پایتون برای مبتدیان', 'شرط‌ها و حلقه‌ها', 'جاوااسکریپت مدرن'] },
    { id: 'pl_demo_viewer_weekend', ownerId: viewerAccount.id, title: 'برای آخر هفته', description: '', visibility: 'PRIVATE', items: ['غذاهای خیابانی استانبول', 'سفر به اصفهان'] },
  ];
  const armanOwner = (await db.channel.findUniqueOrThrow({ where: { handle: 'arman-tech' }, select: { ownerId: true } })).ownerId;
  playlists.push({ id: 'pl_demo_arman_python', ownerId: armanOwner, title: 'دوره‌ی کامل پایتون', description: 'جلسه‌های دوره‌ی پایتون به ترتیب.', visibility: 'PUBLIC', items: ['پایتون برای مبتدیان', 'شرط‌ها و حلقه‌ها', 'تابع‌ها و ماژول‌ها'] });
  for (const p of playlists) {
    if (p.id !== wlId) {
      await db.playlist.upsert({ where: { id: p.id }, create: { id: p.id, ownerId: p.ownerId, title: p.title, description: p.description, visibility: p.visibility }, update: {} });
    }
    await db.playlistItem.createMany({ data: p.items.map((needle, position) => ({ playlistId: p.id, videoId: byTitle(needle).id, position })), skipDuplicates: true });
  }

  // a ticket with a staff reply, so the user-side thread view has something to show
  if ((await db.supportTicket.count({ where: { userId: viewerAccount.id } })) === 0) {
    const admin = await db.user.findUnique({ where: { email: 'admin@tamashagah.test' }, select: { id: true } });
    const ticket = await db.supportTicket.create({
      data: { userId: viewerAccount.id, email: 'viewer@tamashagah.test', subject: 'ویدیو بعد از بارگذاری پخش نمی‌شود', category: 'UPLOAD', status: 'ANSWERED' },
    });
    await db.ticketMessage.create({ data: { ticketId: ticket.id, authorId: viewerAccount.id, body: 'سلام. ویدیویی را دیروز بارگذاری کردم ولی هنوز در حالت «در حال پردازش» مانده است. لطفاً راهنمایی کنید.', createdAt: new Date(NOW - 2 * DAY) } });
    await db.ticketMessage.create({ data: { ticketId: ticket.id, authorId: admin?.id ?? null, isStaff: true, body: 'سلام و وقت بخیر. پردازش ویدیو در زمان شلوغی ممکن است کمی طول بکشد؛ مورد شما را بررسی کردیم و اکنون ویدیو آماده‌ی پخش است. اگر هنوز مشکل دارید همین‌جا پاسخ دهید.', createdAt: new Date(NOW - 1 * DAY) } });
  }

  // --- counters derived from the rows (so the worker's reconcile job would agree) ----------------------------------------
  await db.$executeRaw`UPDATE "Video" v SET "viewCount" = COALESCE((SELECT count(*) FROM "ViewEvent" e WHERE e."videoId" = v.id), 0)::int WHERE v.id = ANY(${videoIds})`;
  await db.$executeRaw`UPDATE "Video" v SET "likeCount" = COALESCE((SELECT count(*) FROM "VideoLike" l WHERE l."videoId" = v.id), 0)::int WHERE v.id = ANY(${videoIds})`;
  await db.$executeRaw`UPDATE "Video" v SET "commentCount" = COALESCE((SELECT count(*) FROM "Comment" c WHERE c."videoId" = v.id AND c.status = 'APPROVED'), 0)::int WHERE v.id = ANY(${videoIds})`;
  await db.$executeRaw`UPDATE "Channel" ch SET "followerCount" = COALESCE((SELECT count(*) FROM "Follow" f WHERE f."channelId" = ch.id), 0)::int`;
  console.log('✔ counters reconciled from rows');
  console.log('Done. Demo viewer: viewer@tamashagah.test (password in .data/seed-credentials.json).');
}

main()
  .then(async () => {
    await disposeFixtures();
    await db.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await disposeFixtures();
    await db.$disconnect();
    process.exit(1);
  });
