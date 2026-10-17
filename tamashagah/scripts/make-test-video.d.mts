/** Type declarations for the (plain JavaScript) fixture generator, so TypeScript tests can import it. */
export type FixtureName =
  | 'landscape-1080p'
  | 'landscape-720p'
  | 'landscape-360p'
  | 'landscape-240p'
  | 'portrait-short'
  | 'silent-720p'
  | 'rotated-portrait'
  | 'webm-vp8'
  | 'webm-no-duration'
  | 'mkv-hevc'
  | 'avi-mpeg4'
  | 'corrupt'
  | 'truncated'
  | 'large-1080p';

export const PALETTES: Record<string, [string, string, string]>;
export const FIXTURES: Record<FixtureName, { file: string; description: string }>;
export const STANDARD_FIXTURES: FixtureName[];

export type GenerateOptions = { dir?: string; seconds?: number; force?: boolean };

/** Create one fixture (cached on disk) and return its absolute path. */
export function generateFixture(name: FixtureName, options?: GenerateOptions): Promise<string>;
export function generateFixtures(names?: FixtureName[], options?: GenerateOptions): Promise<Record<string, string>>;
