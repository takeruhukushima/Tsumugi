# Tsumugi ◐

YouTube動画に、Blueskyアカウントで書けるコメント欄を付ける。
コメントはユーザー自身のPDSに `app.bsky.feed.post` として残り、Bluesky上でもそのまま見える。

Tsumugiは**ビューであって、器ではない**。コメントはTsumugiのDBに入らない。
Tsumugiが保持するのは「どの動画がどのスレッドに対応するか」の対応表だけ。

仕様の全体は [`Tsumugi-spec.md`](./Tsumugi-spec.md)。

---

## 構成

| 層 | 選定 |
|---|---|
| フレームワーク | Astro（SSR / `@astrojs/cloudflare`） |
| UIアイランド | React（コメント欄・投稿フォーム・クリエイター操作のみ） |
| DB | Cloudflare D1（コメントテーブルは無い） |
| Bsky認証 | `@atproto/oauth-client-browser`（ブラウザにセッション保存） |
| Bsky API | `@atproto/api` |
| Google認証 | 生の OAuth 2.0 fetch実装（所有確認のみ、トークンは即破棄） |
| 動画同期 | 設定画面の「同期」ボタンからユーザーが明示的に実行 |

```
src/
  lib/            browser-atproto / google / youtube / thread / post / db / session
  pages/          ページ + API + auth ルート
  components/     Comments.tsx（コメント欄）, OwnerTools.tsx（クリエイター操作）
worker/           旧cron Workerを停止するための廃止済みエンドポイント
migrations/       D1スキーマ
```

## ローカル開発

```bash
pnpm install

# 1. ローカル環境変数を用意
cp .dev.vars.example .dev.vars
# TSUMUGI_ORIGIN は http://127.0.0.1:4321（localhost ではなく loopback IP）

# 2. ローカルD1にスキーマ適用
pnpm db:local

# 3. 開発サーバーを起動（http://127.0.0.1:4321/）
pnpm dev
```

`pnpm dev` は `platformProxy` 経由でローカルD1を使い、AT Protocolのloopback
OAuthに必要な `127.0.0.1:4321` で待ち受ける。

Googleチャンネル登録まで試すには `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
（テストモードのOAuthクライアント、リダイレクトURIに
`http://127.0.0.1:4321/auth/google/callback`）を `.dev.vars` に設定する。

## デプロイ

```bash
# D1を作成し、両方の wrangler.toml の database_id を差し替える
pnpm exec wrangler d1 create tsumugi
pnpm db:remote

# シークレット（リポジトリには入れない）
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET

# 本番 TSUMUGI_ORIGIN / GOOGLE_CLIENT_ID を wrangler.toml の [vars] に設定

pnpm build
pnpm exec wrangler deploy                        # アプリ
# 旧cronをデプロイ済みの場合だけ、トリガー削除を反映
pnpm exec wrangler deploy --config worker/wrangler.toml
```

Bluesky OAuthは公開ブラウザクライアントとして動くため、秘密鍵もOAuthトークンも
Workers/D1には保存しない。ログイン状態はブラウザだけに保存され、Tsumugi独自の
ログインCookieも発行しない。チャンネル登録・解除時だけ、ブラウザがユーザーのPDSへ
短命な操作証明レコードを書き、サーバーが検証する。

## 実装上の注意

- OAuthトークンはブラウザだけが保持し、投稿もブラウザからユーザーのPDSへ直接送る。
- 「同期」はYouTube RSSを更新して未同期動画を表示し、選択した動画だけを投稿する。
- **threadgate の `hiddenReplies`** は AppView が既定のスレッドツリーから
  非表示リプライを除外することに委ねている。
- **Google OAuthのテストモード上限（100ユーザー）** → 設定画面に明記。100人に
  近づいたらアプリ審査に出す。

## 実装済みの範囲（仕様 §11 の作る順番）

1. ✅ Astro初期化、D1スキーマ、Blueskyログイン（ブラウザOAuth）
2. ✅ Google OAuthでチャンネル登録、`/settings`
3. ✅ 動画ページ：スレッド表示 + コメント投稿（クリエイターは動画ページから
   コメント欄を即時作成できる）
4. ✅ 設定画面の「同期」ボタン：RSS更新、動画選択、Bluesky投稿
5. ✅ threadgate編集UI（動画ページのクリエイター向け操作）+ モデレーションの明示

`deliberation_uri`（§9 Agora用）は空のまま予約している。
