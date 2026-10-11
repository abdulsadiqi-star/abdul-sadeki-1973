import { SHORTS_MAX_SECONDS } from '@/config/site';
import type { VideoKind } from '@/generated/prisma/enums';

export type KindInput = { width: number; height: number; durationSeconds: number };

/**
 * Automatic classification: a portrait or square clip that is at most `SHORTS_MAX_SECONDS` long is a SHORT,
 * everything else is a regular VIDEO. The creator can override this in the studio (see `kindChoice`).
 */
export function detectKind(input: KindInput, maxShortSeconds: number = SHORTS_MAX_SECONDS): VideoKind {
  const portraitOrSquare = input.height >= input.width;
  return portraitOrSquare && input.durationSeconds <= maxShortSeconds ? 'SHORT' : 'VIDEO';
}

/** What the creator picked in the studio form. `auto` = let the pipeline decide when processing finishes. */
export type KindChoice = 'auto' | VideoKind;

/** The kind a finished video gets: an explicit choice always wins over detection. */
export function resolveKind(choice: KindChoice, currentKind: VideoKind, detected: VideoKind): VideoKind {
  return choice === 'auto' ? detected : currentKind;
}
