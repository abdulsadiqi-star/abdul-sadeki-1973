/**
 * Serializable comment shapes shared by the server (queries, API, actions) and the client components.
 * No server imports here: client components import these types and helpers.
 */
export type CommentAuthorDTO = {
  id: string;
  /** Channel name when the author has a channel, otherwise the display name. */
  name: string;
  avatarUrl: string | null;
  /** Channel handle (link target) when the author has a channel. */
  handle: string | null;
  verified: boolean;
  /** True for the owner of the channel the video belongs to (shown as the «سازنده» badge). */
  isCreator: boolean;
};

export type CommentDTO = {
  id: string;
  videoId: string;
  body: string;
  /** Only APPROVED comments are public; the author additionally sees their own PENDING one. */
  status: 'APPROVED' | 'PENDING';
  /** ISO string. */
  createdAt: string;
  /** Number of approved replies (meaningful on roots). */
  replyCount: number;
  /** null for top-level comments. */
  rootId: string | null;
  author: CommentAuthorDTO;
  /** Name of the person being answered, only when replying to a reply (not to the root). */
  replyToName: string | null;
  isOwn: boolean;
  /** The signed-in viewer already reported this comment. */
  reported: boolean;
};

export type CommentPageDTO = {
  items: CommentDTO[];
  nextCursor: string | null;
  /** Approved comments on the video (`Video.commentCount`). */
  total: number;
  /** True when the creator turned comments off for this video / channel. */
  disabled?: boolean;
};

export type RepliesPageDTO = { items: CommentDTO[]; nextCursor: string | null };

/** How a freshly posted comment was handled by the server. */
export type PostOutcome = 'published' | 'pending' | 'spam';

/** `comment` is null when the server classified the text as spam: it is stored for the creator but never shown. */
export type PostCommentResultDTO = { comment: CommentDTO | null; outcome: PostOutcome };
