// YouTube helpers that consume no Data API quota: RSS feed + oEmbed.

export interface RssVideo {
  videoId: string;
  title: string | null;
  publishedAt: string | null;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function isValidVideoId(id: string): boolean {
  return VIDEO_ID.test(id);
}

export function isValidChannelId(id: string): boolean {
  return /^UC[A-Za-z0-9_-]{22}$/.test(id);
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://youtu.be/${videoId}`;
}

export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}

/**
 * Fetch a channel's latest videos from its RSS feed (newest ~15). Consumes no
 * Data API quota (spec §5).
 */
export async function fetchChannelRss(channelId: string): Promise<RssVideo[]> {
  const url =
    "https://www.youtube.com/feeds/videos.xml?channel_id=" +
    encodeURIComponent(channelId);
  const res = await fetch(url, {
    headers: { "user-agent": "Tsumugi/0 (+https://github.com/takeruhukushima/Tsumugi)" },
  });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
  const xml = await res.text();
  return parseRss(xml);
}

/** Parse the YouTube RSS feed. Regex is enough for this fixed, simple format. */
export function parseRss(xml: string): RssVideo[] {
  const out: RssVideo[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) !== null) {
    const entry = m[1];
    const videoId = entry.match(/<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/)?.[1];
    if (!videoId) continue;
    const title = decodeXml(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? null);
    const publishedAt = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1] ?? null;
    out.push({ videoId, title, publishedAt });
  }
  return out;
}

export interface OEmbed {
  title: string | null;
  thumbnailUrl: string | null;
  authorName: string | null;
  authorUrl: string | null;
}

/** YouTube oEmbed — title, thumbnail, channel. No API key needed (spec §5). */
export async function fetchOEmbed(videoId: string): Promise<OEmbed | null> {
  const url =
    "https://www.youtube.com/oembed?format=json&url=" +
    encodeURIComponent(youtubeWatchUrl(videoId));
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, unknown>;
  return {
    title: (data.title as string) ?? null,
    thumbnailUrl: (data.thumbnail_url as string) ?? null,
    authorName: (data.author_name as string) ?? null,
    authorUrl: (data.author_url as string) ?? null,
  };
}

function decodeXml(s: string | null): string | null {
  if (s == null) return null;
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
