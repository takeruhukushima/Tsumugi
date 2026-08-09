import { Agent, RichText, AppBskyFeedPost } from "@atproto/api";
import type { OEmbed } from "./youtube";
import { youtubeWatchUrl } from "./youtube";

export interface PostRef {
  uri: string;
  cid: string;
}

/**
 * Create a reply in the acting user's PDS (spec §6, §1 — comments live in the
 * user's repo, never Tsumugi's DB). `agent` must be authenticated as that user.
 */
export async function createReply(
  agent: Agent,
  opts: { text: string; root: PostRef; parent: PostRef },
): Promise<PostRef> {
  const rt = new RichText({ text: opts.text });
  await rt.detectFacets(agent); // links / mentions

  const record: Partial<AppBskyFeedPost.Record> &
    Omit<AppBskyFeedPost.Record, "createdAt"> = {
    text: rt.text,
    facets: rt.facets,
    reply: {
      root: { uri: opts.root.uri, cid: opts.root.cid },
      parent: { uri: opts.parent.uri, cid: opts.parent.cid },
    },
  };
  const res = await agent.post(record);
  return { uri: res.uri, cid: res.cid };
}

/**
 * Create the root post for a new video from the creator's account (spec §5).
 * Body + external link card via oEmbed metadata.
 */
export async function createRootPost(
  agent: Agent,
  opts: {
    videoId: string;
    videoTitle: string | null;
    origin: string;
    oembed: OEmbed | null;
  },
): Promise<PostRef> {
  const title = opts.videoTitle ?? opts.oembed?.title ?? "New video";
  const tsumugiUrl = `${opts.origin}/v/${opts.videoId}`;
  const text = `${title}\n\n${youtubeWatchUrl(opts.videoId)}\n\n💬 ${tsumugiUrl}`;

  const rt = new RichText({ text });
  await rt.detectFacets(agent);

  const record: Partial<AppBskyFeedPost.Record> &
    Omit<AppBskyFeedPost.Record, "createdAt"> = {
    text: rt.text,
    facets: rt.facets,
  };

  // Timeline link card pointing at the Tsumugi video page.
  const thumb = opts.oembed?.thumbnailUrl
    ? await uploadThumb(agent, opts.oembed.thumbnailUrl)
    : undefined;

  record.embed = {
    $type: "app.bsky.embed.external",
    external: {
      uri: tsumugiUrl,
      title,
      description: opts.oembed?.authorName
        ? `YouTube · ${opts.oembed.authorName}`
        : "YouTube",
      ...(thumb ? { thumb } : {}),
    },
  };

  const res = await agent.post(record);
  return { uri: res.uri, cid: res.cid };
}

/** Fetch the YouTube thumbnail and upload it as a blob for the link card. */
async function uploadThumb(agent: Agent, url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const type = res.headers.get("content-type") ?? "image/jpeg";
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > 976_560) return undefined; // ~1MB blob limit
    const up = await agent.uploadBlob(bytes, { encoding: type });
    return up.data.blob;
  } catch {
    return undefined;
  }
}
