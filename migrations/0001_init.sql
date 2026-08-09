-- Tsumugi — initial schema (spec §3)
-- コメントのテーブルが無いのは意図的。コメントは各ユーザーのPDSに入る。

-- Blueskyでログインしたユーザー全員
CREATE TABLE IF NOT EXISTS users (
  did             TEXT PRIMARY KEY,
  handle          TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

-- atproto OAuthのセッション。背景投稿にリフレッシュトークンが要る
CREATE TABLE IF NOT EXISTS atp_sessions (
  did             TEXT PRIMARY KEY,
  session_json    TEXT NOT NULL,       -- NodeOAuthClientのsessionStore用
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS atp_states (
  key             TEXT PRIMARY KEY,    -- OAuthフロー中の一時state
  state_json      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

-- 所有が検証済みのチャンネル
CREATE TABLE IF NOT EXISTS channels (
  channel_id      TEXT PRIMARY KEY,    -- UCxxxxxxxx
  owner_did       TEXT NOT NULL REFERENCES users(did),
  title           TEXT,
  verified_at     TEXT NOT NULL,       -- Google OAuthで確認した時刻
  auto_post       INTEGER NOT NULL DEFAULT 1,
  last_rss_check  TEXT
);

CREATE INDEX IF NOT EXISTS idx_channels_owner ON channels(owner_did);
CREATE INDEX IF NOT EXISTS idx_channels_autopost_check
  ON channels(auto_post, last_rss_check);

-- 動画とスレッドの対応表。Tsumugiの本体はこの1枚
CREATE TABLE IF NOT EXISTS videos (
  video_id         TEXT PRIMARY KEY,   -- 11文字
  channel_id       TEXT NOT NULL REFERENCES channels(channel_id),
  title            TEXT,
  published_at     TEXT,
  root_uri         TEXT,               -- at://... コメント欄のルート
  root_cid         TEXT,               -- リプライ生成に必要
  deliberation_uri TEXT,               -- §9。v0では常にNULL
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id, published_at);
