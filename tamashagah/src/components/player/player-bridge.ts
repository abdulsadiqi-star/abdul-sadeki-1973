/**
 * Tiny registry that lets other client components on the watch page (the share dialog's "start at the current
 * time") ask the player for its position without prop drilling or a context provider.
 */
type PlayerBridge = { getCurrentTime: () => number };

const players = new Map<string, PlayerBridge>();

/** Register a mounted player; returns the unregister function (use it as an effect cleanup). */
export function registerPlayer(videoId: string, bridge: PlayerBridge): () => void {
  players.set(videoId, bridge);
  return () => {
    if (players.get(videoId) === bridge) players.delete(videoId);
  };
}

/** Current playback position of the player showing `videoId`, or null when there is none. */
export function getPlayerTime(videoId: string): number | null {
  const time = players.get(videoId)?.getCurrentTime();
  return typeof time === 'number' && Number.isFinite(time) ? time : null;
}
