import type { D1Database } from "@cloudflare/workers-types";
import {
  channelsDueForCheck,
  knownVideoIds,
  insertPostedVideo,
  seedKnownVideos,
  markChecked,
} from "../src/lib/db";
import { fetchChannelRss, fetchOEmbed } from "../src/lib/youtube";
import { getAgent } from "../src/lib/atproto";
import { createRootPost } from "../src/lib/post";

// Tsumugi background worker (spec §5). Separate Worker, same D1. There is no
// resident process on Workers — this runs on a Cron Trigger every 15 minutes.

interface Env {
  DB: D1Database;
  TSUMUGI_ORIGIN: string;
  ATP_PRIVATE_JWK: string;
}

// Keep each invocation well within the CPU-time limit: process only the oldest
// N channels, leave the rest for the next tick (spec §5).
const CHANNELS_PER_RUN = 15;
// Guard against bursts even past the seeding step.
const MAX_NEW_POSTS_PER_CHANNEL = 5;

export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(run(env));
  },

  // Allow manual triggering during development: `curl http://127.0.0.1:8787/`.
  async fetch(_req: Request, env: Env): Promise<Response> {
    const summary = await run(env);
    return new Response(JSON.stringify(summary, null, 2), {
      headers: { "content-type": "application/json" },
    });
  },
};

async function run(env: Env) {
  const channels = await channelsDueForCheck(env.DB, CHANNELS_PER_RUN);
  const summary: Array<{ channel: string; new: number; error?: string }> = [];

  for (const ch of channels) {
    try {
      const posted = await processChannel(env, ch);
      summary.push({ channel: ch.channel_id, new: posted });
    } catch (err) {
      summary.push({
        channel: ch.channel_id,
        new: 0,
        error: (err as Error).message,
      });
    } finally {
      await markChecked(env.DB, ch.channel_id);
    }
  }
  return { checked: channels.length, results: summary };
}

async function processChannel(
  env: Env,
  ch: {
    channel_id: string;
    owner_did: string;
    last_rss_check: string | null;
  },
): Promise<number> {
  const rss = await fetchChannelRss(ch.channel_id);
  const known = await knownVideoIds(env.DB, ch.channel_id);

  // Safety net: if we've never checked this channel and nothing was seeded at
  // registration, record everything as known WITHOUT posting — don't flood the
  // creator's timeline (spec §5, initial-registration note).
  if (ch.last_rss_check === null && known.size === 0) {
    await seedKnownVideos(env.DB, ch.channel_id, rss);
    return 0;
  }

  const fresh = rss
    .filter((v) => !known.has(v.videoId))
    // Oldest first, so the timeline order matches publish order.
    .sort((a, b) => (a.publishedAt ?? "").localeCompare(b.publishedAt ?? ""))
    .slice(0, MAX_NEW_POSTS_PER_CHANNEL);

  if (fresh.length === 0) return 0;

  // Restore the creator's session once for the whole batch.
  const agent = await getAgent(env, ch.owner_did);

  let posted = 0;
  for (const v of fresh) {
    const oembed = await fetchOEmbed(v.videoId);
    const ref = await createRootPost(agent, {
      videoId: v.videoId,
      videoTitle: v.title ?? oembed?.title ?? null,
      origin: env.TSUMUGI_ORIGIN,
      oembed,
    });
    await insertPostedVideo(env.DB, {
      videoId: v.videoId,
      channelId: ch.channel_id,
      title: v.title,
      publishedAt: v.publishedAt,
      rootUri: ref.uri,
      rootCid: ref.cid,
    });
    posted++;
  }
  return posted;
}
