import {
  Baby,
  Briefcase,
  Car,
  Cpu,
  Film,
  Gamepad2,
  GraduationCap,
  HeartPulse,
  Laugh,
  LayoutGrid,
  Music,
  Newspaper,
  Palette,
  Plane,
  Sparkles,
  Trophy,
  Tv,
  Utensils,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  film: Film,
  tv: Tv,
  music: Music,
  trophy: Trophy,
  gamepad: Gamepad2,
  graduation: GraduationCap,
  newspaper: Newspaper,
  cpu: Cpu,
  utensils: Utensils,
  baby: Baby,
  plane: Plane,
  laugh: Laugh,
  car: Car,
  heart: HeartPulse,
  palette: Palette,
  briefcase: Briefcase,
  sparkles: Sparkles,
};

export function CategoryIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  const Icon = (name && ICONS[name]) || LayoutGrid;
  return <Icon aria-hidden="true" className={className} />;
}
