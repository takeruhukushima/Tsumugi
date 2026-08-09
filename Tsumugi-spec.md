# Tsumugi — 仕様書 v0

YouTube動画に、Blueskyアカウントで書けるコメント欄を付ける。
コメントはユーザー自身のPDSに `app.bsky.feed.post` として残り、Bluesky上でもそのまま見える。

---

## 1. これは何で、何ではないか

**やること**

- クリエイターが自分のYouTubeチャンネルを登録する（所有権はGoogle OAuthで証明）
- 新着動画が出たら、クリエイター本人のBlueskyアカウントから1本ポストする
- そのポストのスレッドが、その動画の公式コメント欄になる
- 視聴者はTsumugi上で動画を見ながら、Blueskyアカウントでコメントする

**やらないこと（v0では）**

- 動画のホスティング、トランスコード、配信（YouTubeに任せる）
- 独自レキシコンの定義（`app.bsky.feed.post` をそのまま使う）
- モデレーション機構の自作（Blueskyの `threadgate` に委ねる）
- 熟議・投票・意見クラスタリング（Agora待ち。§9で場所だけ空けておく）
- firehose全体のインデックス（実測で、同一動画への複数ポストはほぼ発生しなかった）

**設計の芯**

コメントはTsumugiのDBに入れない。ユーザーのPDSに入る。
Tsumugiが保持するのは「どの動画がどのスレッドに対応するか」の対応表だけ。
Tsumugiが消えてもコメントは消えない。これが他のコメントサービスとの違いであり、
言い換えると Tsumugi は**ビューであって、器ではない**。

---

## 2. 技術スタック

**デプロイ先は Cloudflare Workers。** この制約が以下すべてを決めている。

| 層 | 選定 | 備考 |
|---|---|---|
| フレームワーク | Astro（SSR / `@astrojs/cloudflare` アダプタ） | ViteはAstro内蔵。別途セットアップ不要 |
| UIアイランド | React（`@astrojs/react`） | コメント欄と投稿フォームのみ動的。他は静的 |
| DB | **Cloudflare D1** | `better-sqlite3` は使用不可（§3.1） |
| Bsky認証 | `@atproto/oauth-client-node` | **Workers上で動くか要検証（§12）** |
| Bsky API | `@atproto/api` | |
| Google認証 | 生の OAuth 2.0 fetch実装 | `googleapis` は重くWorkersに不向き |
| 背景ジョブ | **Cloudflare Cron Triggers**（別Worker） | 常駐プロセスは存在しない（§5） |

Astroを選ぶ理由：動画ページの大部分（プレイヤー、メタ情報）は静的で、
動的なのはコメント欄だけ。アイランド構成がこの形にちょうど合う。

**Workersの制約から来る禁止事項**

- ファイルシステムへの書き込み不可。ネイティブモジュール不可
- 常駐プロセス・`setInterval` による定期実行は不可
- リクエストをまたぐメモリ上の状態は保持されない（キャッシュとしてすら当てにしない）
- `nodejs_compat` フラグは有効にしておくこと

---

## 3. データモデル（SQLite）

```sql
-- Blueskyでログインしたユーザー全員
CREATE TABLE users (
  did             TEXT PRIMARY KEY,
  handle          TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

-- atproto OAuthのセッション。背景投稿にリフレッシュトークンが要る
CREATE TABLE atp_sessions (
  did             TEXT PRIMARY KEY,
  session_json    TEXT NOT NULL,       -- NodeOAuthClientのsessionStore用
  updated_at      TEXT NOT NULL
);
CREATE TABLE atp_states (
  key             TEXT PRIMARY KEY,    -- OAuthフロー中の一時state
  state_json      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

-- 所有が検証済みのチャンネル
CREATE TABLE channels (
  channel_id      TEXT PRIMARY KEY,    -- UCxxxxxxxx
  owner_did       TEXT NOT NULL REFERENCES users(did),
  title           TEXT,
  verified_at     TEXT NOT NULL,       -- Google OAuthで確認した時刻
  auto_post       INTEGER NOT NULL DEFAULT 1,
  last_rss_check  TEXT
);

-- 動画とスレッドの対応表。Tsumugiの本体はこの1枚
CREATE TABLE videos (
  video_id        TEXT PRIMARY KEY,    -- 11文字
  channel_id      TEXT NOT NULL REFERENCES channels(channel_id),
  title           TEXT,
  published_at    TEXT,
  root_uri        TEXT,                -- at://... コメント欄のルート
  root_cid        TEXT,                -- リプライ生成に必要
  deliberation_uri TEXT,               -- §9。v0では常にNULL
  created_at      TEXT NOT NULL
);
```

コメントのテーブルが**無い**ことに注意。意図的。

### 3.1 D1について

スキーマはそのまま使えるが、アクセス方法が変わる。

```js
// Astroのエンドポイント内
const db = locals.runtime.env.DB;
const { results } = await db
  .prepare("SELECT * FROM videos WHERE video_id = ?")
  .bind(videoId)
  .all();
```

- `better-sqlite3` は使わない（ネイティブモジュールのためWorkersで動かない）
- すべて非同期。同期APIは存在しない
- 複数書き込みは `db.batch([...])` でまとめる
- ローカル開発は `wrangler dev --local` でMiniflareのD1が立つ

**無料枠の余裕**: D1は5GBストレージ、1日500万行読み取り、10万行書き込み。
Tsumugiの想定規模では桁違いに余る。先に当たるとすればWorkersの
1日10万リクエストの方なので、心配する順番はそちら。

---

## 4. 認証

### 4.1 Blueskyログイン（atproto OAuth）

`@atproto/oauth-client-node` を使う。クライアントメタデータを
`/client-metadata.json` で公開し、`redirect_uri` を `/auth/bsky/callback` に。

**重要**: 背景ワーカーがユーザーの代わりに投稿するため、セッションは
DBに永続化してリフレッシュ可能な状態を保つこと（`atp_sessions`）。
`stateStore` と `sessionStore` を SQLite 実装で渡す。
ここを揮発メモリにすると、再起動のたびに自動投稿が全部止まる。

スコープは投稿の作成が必要。開発中は `atproto transition:generic` で開始し、
細かい permission set が固まったら絞る。

### 4.2 チャンネル所有権の証明（Google OAuth）

なりすまし対策。これが無いと、他人のチャンネルのコメント欄を乗っ取れる。

1. `https://accounts.google.com/o/oauth2/v2/auth` へリダイレクト
   scope: `https://www.googleapis.com/auth/youtube.readonly`
2. コールバックでコードをトークンに交換
3. `GET https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true`
4. 返ってきた `items[].id` が、そのGoogleアカウントが所有するチャンネル
5. ログイン中のDIDと紐付けて `channels` に保存
6. **アクセストークンは即破棄**。所有確認以外に使わない

**制約**: `youtube.readonly` はGoogleのセンシティブスコープ。
本番公開にはアプリ審査（プライバシーポリシー、ドメイン所有証明、デモ動画、
数週間）が必要。**テストモードなら審査なしで最大100ユーザー**。
v0はテストモードで進める。100人に近づいたら審査に出す。

---

## 5. 背景ジョブ（Cron Trigger）

常駐プロセスは作れないので、**同じD1をバインドした別Worker**として実装する。
`wrangler.toml` に `crons = ["*/15 * * * *"]` を書き、`scheduled` ハンドラで動かす。
無料プランでもCron Triggersは使える。

Workerの実行時間には上限があるため、1回の起動で全チャンネルを回さないこと。
`last_rss_check` の古い順に**10〜20チャンネルずつ**処理し、残りは次の起動に回す。
チャンネル数が増えても、この形なら破綻しない。

15分おきに、`auto_post = 1` のチャンネルを古い順に取り出して：

1. `https://www.youtube.com/feeds/videos.xml?channel_id={id}` を取得
   （YouTube Data APIのクォータを消費しない。RSSは最新15件を返す）
2. `<yt:videoId>` を抽出し、`videos` に未登録のものを新着とみなす
3. 新着があれば、オーナーのatprotoセッションを復元して
   `com.atproto.repo.createRecord` でポストを作成
4. 返ってきた `uri` / `cid` を `videos.root_uri` / `root_cid` に保存

**ポスト本文**

```
{動画タイトル}

https://youtu.be/{videoId}

💬 {TSUMUGI_ORIGIN}/v/{videoId}
```

外部リンク埋め込み（`app.bsky.embed.external`）を付けるとタイムライン上で
サムネイル付きカードになる。YouTubeのoEmbedからタイトルとサムネイルURLが取れる：

```
https://www.youtube.com/oembed?url=https://youtu.be/{id}&format=json
```

APIキー不要。`author_url` からチャンネルの解決もできる。

**初回登録時の注意**: 登録直後にRSSの15件を全部ポストすると、
そのユーザーのタイムラインが埋まって迷惑になる。
初回は既存動画を `root_uri = NULL` で記録するだけにして、
以降の新着だけ投稿すること。

---

## 6. ページとAPI

### ページ

| パス | 内容 |
|---|---|
| `/` | 説明とログイン。登録済みチャンネルの一覧 |
| `/v/{videoId}` | 動画ページ。プレイヤー＋コメント欄 |
| `/c/{channelId}` | チャンネルの動画一覧 |
| `/settings` | 自分のチャンネル登録・解除、自動投稿のオン/オフ |

### APIルート

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/thread/{videoId}` | `app.bsky.feed.getPostThread` の結果を整形して返す |
| POST | `/api/comment` | `{ videoId, text, parentUri?, parentCid? }` → リプライ作成 |
| GET | `/auth/bsky/login` `/auth/bsky/callback` | Blueskyログイン |
| GET | `/auth/google/start` `/auth/google/callback` | チャンネル所有権検証 |
| POST | `/api/channel/{id}/disconnect` | 登録解除 |

`/api/comment` は必ずサーバー側でログインDIDを確認し、
そのユーザーのセッションでレコードを作る。クライアントから来たDIDを信用しない。

---

## 7. モデレーション

**自作しない。** Blueskyの既存機能に委ねる。

- ルート投稿はクリエイター本人のアカウントから出るので、
  `app.bsky.feed.threadgate` の設定権はクリエイターが持つ
- 誰が返信できるか（誰でも / フォロワーのみ / メンションした人のみ / リスト）を制限できる
- 個別のリプライは threadgate の `hiddenReplies` で非表示にできる
- Tsumugiは `getPostThread` が返す非表示フラグを尊重して描画するだけ

`/settings` からthreadgateを編集できるUIを付けると親切。

**正直に表示すべきこと**: クリエイターにできるのは「自分の場から外す」ことで、
「ネットワークから消す」ことではない。元のポストは他のクライアントからは見える。
この点は設定画面に明記すること。誤解させたまま運用すると必ず問題になる。

**ユーザーへの説明**: Tsumugiで書いたコメントは公開ポストなので、
本人のBlueskyプロフィールの「Posts & replies」にも出る。
初回コメント時に一度だけ明示する。

---

## 8. UIの方向

派手にしない。**このアプリの主役は動画と、そこに集まった言葉**であって、
Tsumugi自身ではない。

- プレイヤーは16:9を保ったまま、ページの上部で最大幅を取る
- コメントは1階層のインデントまで（Redditのような深いネストはやらない。
  Blueskyのスレッドは実際にはそこまで深くならない）
- 各コメントに、元のBlueskyポストへのリンクを必ず置く。
  「これは本当にBluesky上にある」ことが体感できることが、この製品の主張そのもの
- 空のコメント欄は「まだ誰も書いていません」ではなく、
  最初の一人になるよう促す文言にする

タイポグラフィと配色はClaude Codeの裁量。ただし
「クリーム色の背景＋ハイコントラストのセリフ＋テラコッタのアクセント」は
AI生成デザインの定番なので避けること。

---

## 9. 将来のための予約（実装しない）

`videos.deliberation_uri` を空のまま用意してある。

AgoraがAT Protocol上にレコードを放流したら、動画に紐づく熟議のAT-URIを
ここに入れるだけで接続できる。DDS（W3C Community Group）は現時点で
チェアも決まっておらず仕様も固まっていないため、**今はDDSに合わせて設計しない**。
確定していない仕様に寄せると振り回される。

UI上は「コメント」と「みんなの意見」のタブになる想定。
雑談と熟議はデータの形が違う（リプライツリー vs 意見＋賛否投票）ので、
統合せず併存させる。

---

## 10. 環境変数

`wrangler.toml` のバインディング:

```toml
[[d1_databases]]
binding = "DB"
database_name = "tsumugi"

[vars]
TSUMUGI_ORIGIN = "https://tsumugi.example"
GOOGLE_CLIENT_ID = ""
```

シークレット（`wrangler secret put` で設定、リポジトリに入れない）:

```
GOOGLE_CLIENT_SECRET
SESSION_SECRET
ATP_PRIVATE_JWK    # atproto OAuthのクライアント署名鍵
```

atproto OAuthのクライアントメタデータは `TSUMUGI_ORIGIN` から組み立てる。
ローカル開発では `http://127.0.0.1:8788` を使う（`localhost` ではなく）。

---

## 11. 作る順番

1. Astroプロジェクト初期化、SQLiteスキーマ、Blueskyログイン
2. Google OAuthでチャンネル登録。`/settings` で確認できるところまで
3. 動画ページ。**まず手動で** `root_uri` をDBに入れて、スレッド表示とコメント投稿を通す
4. 背景ワーカー。RSSポーリングと自動投稿
5. threadgate編集UI

3が通った時点で、このアプリが面白いかどうかは判断できる。
4より先に3を完成させること。

---

## 12. 未検証の前提

実装前に確認すること。仕様の根拠が崩れる可能性がある箇所。

- **`@atproto/oauth-client-node` がCloudflare Workers上で動くか。最優先で潰すこと。**
  Node固有のcrypto APIに依存していると、`nodejs_compat` を有効にしても動かない
  可能性がある。着手初日に、空のWorkerでインポートと1回の認可URL生成だけを試す。
  動かなければ、DPoPとPARを含むatproto OAuthを `jose` で自前実装することになり、
  見積もりが大きく変わる。他のどの作業よりも先に確認する
- **threadgateの `hiddenReplies` が期待通り動くか**。モデレーション戦略の全体が
  ここに乗っている。動かなければ、Tsumugi側で独自の非表示リストを持つ必要がある
- **atproto OAuthのリフレッシュトークンの有効期限**。長期間投稿がないチャンネルで
  セッションが切れた場合の再認証フローが要る
- **Google OAuthのテストモードの制限**が現在も100ユーザーか
- **Jetstreamの遅延**。実測でポストの `createdAt` と受信時刻に約17分のずれがあった。
  原因未特定（v0ではJetstreamを使わないので影響しないが、将来の集約機能で問題になる）
