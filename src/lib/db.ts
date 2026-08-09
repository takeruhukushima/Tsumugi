import type { D1Database } from "@cloudflare/workers-types";

// Row shapes mirror migrations/0001_init.sql.

export interface UserRow {
  did: string;
  handle: string;
  created_at: string;
}

export interface ChannelRow {
  channel_id: string;
  owner_did: string;
  title: string | null;
  verified_at: string;
  auto_post: number;
  last_rss_check: string | null;
}

export interface VideoRow {
  video_id: string;
  channel_id: string;
  title: string | null;
  published_at: string | null;
  root_uri: string | null;
  root_cid: string | null;
  deliberation_uri: string | null;
  created_at: string;
}

const now = () => new Date().toISOString();

export async function upsertUser(
  db: D1Database,
  did: string,
  handle: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (did, handle, created_at) VALUES (?, ?, ?)
       ON CONFLICT(did) DO UPDATE SET handle = excluded.handle`,
    )
    .bind(did, handle, now())
    .run();
}

export async function getUser(
  db: D1Database,
  did: string,
): Promise<UserRow | null> {
  return db
    .prepare("SELECT * FROM users WHERE did = ?")
    .bind(did)
    .first<UserRow>();
}

export async function getVideo(
  db: D1Database,
  videoId: string,
): Promise<VideoRow | null> {
  return db
    .prepare("SELECT * FROM videos WHERE video_id = ?")
    .bind(videoId)
    .first<VideoRow>();
}

export async function getChannel(
  db: D1Database,
  channelId: string,
): Promise<ChannelRow | null> {
  return db
    .prepare("SELECT * FROM channels WHERE channel_id = ?")
    .bind(channelId)
    .first<ChannelRow>();
}

export async function listChannelsByOwner(
  db: D1Database,
  did: string,
): Promise<ChannelRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM channels WHERE owner_did = ? ORDER BY verified_at DESC")
    .bind(did)
    .all<ChannelRow>();
  return results ?? [];
}

export async function listAllChannels(db: D1Database): Promise<ChannelRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM channels ORDER BY verified_at DESC")
    .all<ChannelRow>();
  return results ?? [];
}

export async function listVideosByChannel(
  db: D1Database,
  channelId: string,
): Promise<VideoRow[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM videos WHERE channel_id = ? ORDER BY published_at DESC",
    )
    .bind(channelId)
    .all<VideoRow>();
  return results ?? [];
}

/** Upsert a verified channel bound to an owner DID. */
export async function upsertChannel(
  db: D1Database,
  channelId: string,
  ownerDid: string,
  title: string | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO channels (channel_id, owner_did, title, verified_at, auto_post)
       VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(channel_id) DO UPDATE SET
         owner_did = excluded.owner_did,
         title = excluded.title,
         verified_at = excluded.verified_at`,
    )
    .bind(channelId, ownerDid, title, now())
    .run();
}

/**
 * Seed a channel's existing videos with root_uri = NULL (spec §5). This marks
 * them "known but not posted", so the background worker only auto-posts genuinely
 * new uploads and doesn't flood the creator's timeline on first registration.
 */
export async function seedKnownVideos(
  db: D1Database,
  channelId: string,
  videos: Array<{ videoId: string; title: string | null; publishedAt: string | null }>,
): Promise<void> {
  if (videos.length === 0) return;
  const ts = now();
  const stmts = videos.map((v) =>
    db
      .prepare(
        `INSERT INTO videos (video_id, channel_id, title, published_at, root_uri, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)
         ON CONFLICT(video_id) DO NOTHING`,
      )
      .bind(v.videoId, channelId, v.title, v.publishedAt, ts),
  );
  await db.batch(stmts);
}

/** Set/attach the root thread refs onto a video that was manually seeded
 * (spec milestone 3 — put root_uri in by hand before the worker exists). */
export async function attachRoot(
  db: D1Database,
  videoId: string,
  rootUri: string,
  rootCid: string,
): Promise<void> {
  await db
    .prepare("UPDATE videos SET root_uri = ?, root_cid = ? WHERE video_id = ?")
    .bind(rootUri, rootCid, videoId)
    .run();
}

export async function markChecked(
  db: D1Database,
  channelId: string,
): Promise<void> {
  await db
    .prepare("UPDATE channels SET last_rss_check = ? WHERE channel_id = ?")
    .bind(now(), channelId)
    .run();
}

export async function disconnectChannel(
  db: D1Database,
  channelId: string,
  ownerDid: string,
): Promise<void> {
  // Only the owner may disconnect. Videos rows are kept — root_uri points at
  // records that still live in the creator's PDS.
  await db
    .prepare("DELETE FROM channels WHERE channel_id = ? AND owner_did = ?")
    .bind(channelId, ownerDid)
    .run();
}
