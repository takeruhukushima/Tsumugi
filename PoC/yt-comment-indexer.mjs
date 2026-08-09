#!/usr/bin/env node
/**
 * yt-comment-indexer
 *
 * Blueskyのfirehose(Jetstream)を購読し、YouTubeリンクを含むポストを
 * 動画IDごとに束ね直して JSONL に書き出す実験プロトタイプ。
 *
 * 「動画ごとのコメント欄はすでにネットワーク上に散らばって存在する」
 * という仮説を、実データで検証するための最小実装。
 *
 * 実行:  node yt-comment-indexer.mjs
 *        node yt-comment-indexer.mjs --channel UCxxxxxxxx   (特定チャンネルのみ)
 *
 * 必要: Node 22+ (グローバル WebSocket / fetch を使用。追加依存なし)
 *
 * 注意: 未検証コード。ライブAPIに対して動作確認していません。
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------- config

const JETSTREAM =
  "wss://jetstream2.us-east.bsky.network/subscribe" +
  "?wantedCollections=app.bsky.feed.post";

const OUT = path.resolve("./index.jsonl");
const STATE = path.resolve("./state.json");

// --channel UCxxxx を渡すと、そのチャンネルの動画だけに絞る
const argChannel = (() => {
  const i = process.argv.indexOf("--channel");
  return i !== -1 ? process.argv[i + 1] : null;
})();

// ------------------------------------------------------- youtube helpers

/** テキスト・埋め込みから YouTube の videoId をすべて拾う */
function extractVideoIds(record) {
  const surfaces = [];

  if (typeof record?.text === "string") surfaces.push(record.text);

  // 外部リンク埋め込み (リンクカード)
  const ext = record?.embed?.external?.uri ?? record?.embed?.media?.external?.uri;
  if (typeof ext === "string") surfaces.push(ext);

  // facets に埋め込まれたリンク (テキスト中で短縮表示されている場合)
  for (const facet of record?.facets ?? []) {
    for (const feature of facet?.features ?? []) {
      if (typeof feature?.uri === "string") surfaces.push(feature.uri);
    }
  }

  const ids = new Set();
  const patterns = [
    /(?:youtube\.com\/watch\?[^\s]*[?&]?v=)([A-Za-z0-9_-]{11})/g,
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/g,
    /(?:youtube\.com\/(?:shorts|live|embed)\/)([A-Za-z0-9_-]{11})/g,
  ];

  for (const s of surfaces) {
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s)) !== null) ids.add(m[1]);
    }
  }
  return [...ids];
}

/**
 * 登録チャンネルの動画IDを RSS から取得する。
 * YouTube Data API のクォータ(1日10,000ユニット)を消費しないのが利点。
 */
async function fetchChannelVideoIds(channelId) {
  const url =
    "https://www.youtube.com/feeds/videos.xml?channel_id=" +
    encodeURIComponent(channelId);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/g)].map(
    (m) => m[1]
  );
}

// ------------------------------------------------------------- persistence

const stream = fs.createWriteStream(OUT, { flags: "a" });

/** videoId -> 件数 (メモリ上の集計。再起動時は state.json から復元) */
const counts = new Map();

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE, "utf8"));
    for (const [k, v] of Object.entries(raw.counts ?? {})) counts.set(k, v);
    console.log(`[state] restored ${counts.size} videos`);
  } catch {
    /* 初回起動 */
  }
}

function saveState() {
  const obj = { updatedAt: new Date().toISOString(), counts: Object.fromEntries(counts) };
  fs.writeFileSync(STATE, JSON.stringify(obj, null, 2));
}

// ---------------------------------------------------------------- indexer

let allowList = null; // Set<videoId> | null (null = 全動画を対象)

async function buildAllowList() {
  if (!argChannel) return null;
  const ids = await fetchChannelVideoIds(argChannel);
  console.log(`[rss] ${argChannel}: ${ids.length} videos`);
  return new Set(ids);
}

function onCommit(evt) {
  const c = evt.commit;
  if (!c || c.operation !== "create") return;
  if (c.collection !== "app.bsky.feed.post") return;

  const videoIds = extractVideoIds(c.record);
  if (videoIds.length === 0) return;

  const hits = allowList ? videoIds.filter((id) => allowList.has(id)) : videoIds;
  if (hits.length === 0) return;

  for (const videoId of hits) {
    counts.set(videoId, (counts.get(videoId) ?? 0) + 1);

    const entry = {
      videoId,
      did: evt.did,
      rkey: c.rkey,
      // atproto上の正規アドレス。これがそのままレコードの所在になる
      uri: `at://${evt.did}/app.bsky.feed.post/${c.rkey}`,
      // 人間が開けるリンク
      web: `https://bsky.app/profile/${evt.did}/post/${c.rkey}`,
      text: c.record?.text ?? "",
      createdAt: c.record?.createdAt ?? null,
      // リプライなら親スレッドのroot。公式スレッドとの結合判定に使う
      replyRoot: c.record?.reply?.root?.uri ?? null,
      indexedAt: new Date().toISOString(),
    };

    stream.write(JSON.stringify(entry) + "\n");
    console.log(`[hit] ${videoId} (${counts.get(videoId)}) ${entry.text.slice(0, 60).replace(/\n/g, " ")}`);
  }
}

// ------------------------------------------------------------- connection

let backoff = 1000;

function connect() {
  console.log(`[ws] connecting…`);
  const ws = new WebSocket(JETSTREAM);

  ws.addEventListener("open", () => {
    console.log("[ws] connected");
    backoff = 1000;
  });

  ws.addEventListener("message", (ev) => {
    try {
      const evt = JSON.parse(ev.data);
      if (evt.kind === "commit") onCommit(evt);
    } catch {
      /* 壊れたフレームは黙って捨てる */
    }
  });

  ws.addEventListener("close", () => {
    console.log(`[ws] closed. retry in ${backoff}ms`);
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 60_000);
  });

  ws.addEventListener("error", (e) => {
    console.error("[ws] error", e?.message ?? e);
    try { ws.close(); } catch { /* noop */ }
  });
}

// ------------------------------------------------------------------- main

loadState();
allowList = await buildAllowList();
setInterval(saveState, 30_000);

process.on("SIGINT", () => {
  saveState();
  console.log(`\n[exit] ${counts.size} videos indexed → ${OUT}`);
  process.exit(0);
});

connect();
