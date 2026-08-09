import { AtpAgent, AppBskyFeedDefs, AppBskyFeedPost } from "@atproto/api";
import { bskyPostUrl } from "./aturi";

// Reads go through the public AppView — no auth required.
export const PUBLIC_APPVIEW = "https://public.api.bsky.app";

export interface CommentView {
  uri: string;
  cid: string;
  authorDid: string;
  authorHandle: string;
  authorDisplayName: string | null;
  authorAvatar: string | null;
  text: string;
  createdAt: string | null;
  likeCount: number;
  replyCount: number;
  bskyUrl: string | null;
  /** One level of nesting only (spec §8). */
  replies: CommentView[];
}

export interface ThreadResult {
  found: boolean;
  root: CommentView | null;
  replies: CommentView[];
}

function toComment(
  post: AppBskyFeedDefs.PostView,
  replies: CommentView[] = [],
): CommentView {
  const record = post.record as AppBskyFeedPost.Record;
  return {
    uri: post.uri,
    cid: post.cid,
    authorDid: post.author.did,
    authorHandle: post.author.handle,
    authorDisplayName: post.author.displayName ?? null,
    authorAvatar: post.author.avatar ?? null,
    text: record?.text ?? "",
    createdAt: record?.createdAt ?? null,
    likeCount: post.likeCount ?? 0,
    replyCount: post.replyCount ?? 0,
    bskyUrl: bskyPostUrl(post.uri),
    replies,
  };
}

/**
 * Flatten a threadViewPost into root + one level of replies. The AppView
 * already omits threadgate-hidden replies from the default tree, so honoring
 * moderation is just a matter of rendering what it returns (spec §7).
 */
function flattenReplies(
  nodes: AppBskyFeedDefs.ThreadViewPost["replies"],
): CommentView[] {
  const out: CommentView[] = [];
  for (const node of nodes ?? []) {
    if (!AppBskyFeedDefs.isThreadViewPost(node)) continue; // skip blocked/notFound
    // Collapse deeper nesting into the single child level.
    const grandchildren = flattenReplies(node.replies);
    out.push(toComment(node.post, grandchildren));
  }
  // Oldest first reads naturally for a comment section.
  out.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  return out;
}

export async function fetchThread(rootUri: string): Promise<ThreadResult> {
  const agent = new AtpAgent({ service: PUBLIC_APPVIEW });
  let res;
  try {
    res = await agent.getPostThread({ uri: rootUri, depth: 2 });
  } catch {
    return { found: false, root: null, replies: [] };
  }
  const thread = res.data.thread;
  if (!AppBskyFeedDefs.isThreadViewPost(thread)) {
    return { found: false, root: null, replies: [] };
  }
  return {
    found: true,
    root: toComment(thread.post),
    replies: flattenReplies(thread.replies),
  };
}
