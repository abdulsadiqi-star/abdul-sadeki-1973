/**
 * Recommendation entry points (transparent, rule-based — see ./scoring.ts and docs/features/discovery.md).
 *
 * `getRelatedVideos` / `getTrendingVideos` keep the signatures of the foundation version (the watch page and shorts
 * already depend on them); the options only grew (`days`, `categoryId`, `now`). No machine learning is involved or claimed.
 */
export { getPersonalizedFeed, getRelatedVideos, getTrendingVideoIds, getTrendingVideos } from './ranking';
export type { PersonalizedOptions, RelatedOptions, TrendingOptions } from './ranking';
export { getContinueWatching, getFollowedLatest, getHomeFeed } from './home';
export type { ContinueWatchingItem, HomeCategoryRow, HomeFeed } from './home';
export { hydrateCards } from './queries';
