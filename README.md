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
| Bsky認証 | `@atproto/oauth-client-node`（D1にセッション永続化） |
| Bsky API | `@atproto/api` |
| Google認証 | 生の OAuth 2.0 fetch実装（所有確認のみ、トークンは即破棄） |
| 背景ジョブ | Cloudflare Cron Triggers（別Worker、同じD1） |

```
src/
  lib/            atproto / google / youtube / thread / post / moderation / db / session
  pages/          ページ + API + auth ルート
  components/     Comments.tsx（コメント欄）, OwnerTools.tsx（クリエイター操作）
  middleware.ts   Cookieセッション → locals.user
worker/           背景ワーカー（RSSポーリング + 自動投稿）
migrations/       D1スキーマ
scripts/gen-jwk.mjs  atproto OAuth署名鍵の生成
```

## ローカル開発

```bash
pnpm install

# 1. atproto OAuth署名鍵とセッション鍵を用意
cp .dev.vars.example .dev.vars
node scripts/gen-jwk.mjs          # 出力を .dev.vars の ATP_PRIVATE_JWK へ
openssl rand -hex 32              # 出力を .dev.vars の SESSION_SECRET へ
# TSUMUGI_ORIGIN は http://127.0.0.1:8787（localhost ではなく loopback IP）

# 2. ローカルD1にスキーマ適用
pnpm db:local

# 3. ビルドして wrangler で起動（D1・環境変数つき）
pnpm build
pnpm exec wrangler dev --port 8787 --local
```

`astro dev`（`platformProxy` 経由でD1が使える）でも起動できるが、
atproto OAuthのloopbackクライアントは `TSUMUGI_ORIGIN` と listen ポートの
一致が要るため、`wrangler dev --port 8787` を推奨。

Googleチャンネル登録まで試すには `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
（テストモードのOAuthクライアント、リダイレクトURIに
`http://127.0.0.1:8787/auth/google/callback`）を `.dev.vars` に設定する。

## デプロイ

```bash
# D1を作成し、両方の wrangler.toml の database_id を差し替える
pnpm exec wrangler d1 create tsumugi
pnpm db:remote

# シークレット（リポジトリには入れない）
pnpm exec wrangler secret put SESSION_SECRET
pnpm exec wrangler secret put ATP_PRIVATE_JWK
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
# 背景ワーカーにも同じ署名鍵を渡す
pnpm exec wrangler secret put ATP_PRIVATE_JWK --config worker/wrangler.toml

# 本番 TSUMUGI_ORIGIN / GOOGLE_CLIENT_ID を wrangler.toml の [vars] に設定

pnpm build
pnpm exec wrangler deploy                        # アプリ
pnpm exec wrangler deploy --config worker/wrangler.toml   # 背景ワーカー
```

本番では `TSUMUGI_ORIGIN` が `https://` のため、atproto クライアントは
confidential client（`private_key_jwt`）として動作し、公開鍵は `/jwks.json`、
クライアントメタデータは `/client-metadata.json` で配信される。

## §12 未検証の前提 — 検証結果

- **`@atproto/oauth-client-node` が Cloudflare Workers 上で動くか** → **動く（検証済み）。**
  `nodejs_compat` 下で、既定の `node:crypto`（`randomBytes` / `createHash`）と
  `JoseKey`（WebCrypto）はそのまま動作する。唯一 Workers 非対応なのは既定の
  ハンドルリゾルバ（`node:dns` 依存）なので、`handleResolver` にURL文字列
  （`https://bsky.social`）を渡してこれを回避している（`src/lib/atproto.ts`）。
  `wrangler dev`（workerd）上で `/auth/bsky/login` がクライアント構築 →
  bsky.social への PAR → D1へのstate永続化 → 認可URLへの302、まで通ることを確認した。
- **threadgate の `hiddenReplies`** → v0では AppView が既定のスレッドツリーから
  非表示リプライを除外することに委ねている（`getPostThread` の結果をそのまま描画）。
  独自の非表示リストは持たない。
- **リフレッシュトークンの有効期限 / 長期未投稿チャンネルの再認証** → セッション切れ時、
  API・ワーカーは `needsReauth` を返す。UIでの再ログイン導線は今後の課題。
- **Google OAuthのテストモード上限（100ユーザー）** → 設定画面に明記。100人に
  近づいたらアプリ審査に出す。

## 実装済みの範囲（仕様 §11 の作る順番）

1. ✅ Astro初期化、D1スキーマ、Blueskyログイン（OAuth + D1永続セッション）
2. ✅ Google OAuthでチャンネル登録、`/settings`
3. ✅ 動画ページ：スレッド表示 + コメント投稿（クリエイターは動画ページから
   コメント欄を即時作成できる）
4. ✅ 背景ワーカー：RSSポーリングと自動投稿（初回登録はシード、以降の新着のみ投稿）
5. ✅ threadgate編集UI（動画ページのクリエイター向け操作）+ モデレーションの明示

`deliberation_uri`（§9 Agora用）は空のまま予約している。
