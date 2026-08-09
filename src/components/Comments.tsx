import { useCallback, useEffect, useRef, useState } from "react";

// The comment section island (spec §8). Data comes from /api/thread; writes go
// through /api/comment, which lands the reply in the viewer's own PDS.

interface CommentView {
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
  replies: CommentView[];
}

interface ThreadResponse {
  hasRoot: boolean;
  found?: boolean;
  rootUri?: string;
  rootCid?: string;
  root?: CommentView | null;
  replies?: CommentView[];
}

interface Props {
  videoId: string;
  isLoggedIn: boolean;
  loginHref: string;
}

const DISCLOSURE_KEY = "tsumugi_disclosed_public";

export default function Comments({ videoId, isLoggedIn, loginHref }: Props) {
  const [data, setData] = useState<ThreadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<CommentView | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/thread/${videoId}`);
      if (!res.ok) throw new Error(`thread ${res.status}`);
      setData((await res.json()) as ThreadResponse);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [videoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const startReply = (c: CommentView) => {
    setReplyTo(c);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const replies = data?.replies ?? [];
  const total = countComments(replies);

  return (
    <section aria-label="コメント">
      <div className="spread" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>
          コメント{total > 0 ? ` (${total})` : ""}
        </h2>
        {data?.hasRoot && data.rootUri ? (
          <a
            className="small"
            href={bskyThreadUrl(data.rootUri)}
            target="_blank"
            rel="noreferrer"
          >
            Blueskyでスレッドを開く ↗
          </a>
        ) : null}
      </div>

      {error ? <div className="notice">読み込みに失敗しました: {error}</div> : null}

      {data && !data.hasRoot ? (
        <div className="notice">
          この動画にはまだ公式のコメント欄がありません。クリエイターが登録すると、
          本人のBlueskyアカウントからスレッドが作られます。
        </div>
      ) : null}

      {data?.hasRoot ? (
        <div ref={formRef}>
          <CommentComposer
            videoId={videoId}
            isLoggedIn={isLoggedIn}
            loginHref={loginHref}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onPosted={async () => {
              setReplyTo(null);
              await load();
            }}
          />
        </div>
      ) : null}

      {data?.hasRoot && replies.length === 0 ? (
        <p className="muted" style={{ marginTop: 16 }}>
          まだ誰も書いていません。最初の一人になりましょう。
        </p>
      ) : null}

      <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0" }}>
        {replies.map((c) => (
          <li key={c.uri} style={{ marginBottom: 14 }}>
            <Comment comment={c} onReply={startReply} canReply={isLoggedIn} />
            {c.replies.length > 0 ? (
              <ul
                style={{
                  listStyle: "none",
                  margin: "10px 0 0 0",
                  padding: "0 0 0 18px",
                  borderLeft: "2px solid var(--border)",
                }}
              >
                {c.replies.map((r) => (
                  <li key={r.uri} style={{ marginBottom: 10 }}>
                    <Comment comment={r} onReply={startReply} canReply={isLoggedIn} />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Comment({
  comment,
  onReply,
  canReply,
}: {
  comment: CommentView;
  onReply: (c: CommentView) => void;
  canReply: boolean;
}) {
  const name = comment.authorDisplayName || `@${comment.authorHandle}`;
  return (
    <article className="card" style={{ padding: 14 }}>
      <div className="row" style={{ gap: 10, marginBottom: 6 }}>
        {comment.authorAvatar ? (
          <img
            src={comment.authorAvatar}
            alt=""
            width={28}
            height={28}
            style={{ borderRadius: "50%", flex: "0 0 auto" }}
          />
        ) : (
          <span
            aria-hidden
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "var(--surface-2)",
              display: "inline-block",
            }}
          />
        )}
        <div style={{ minWidth: 0 }}>
          <a
            href={`https://bsky.app/profile/${comment.authorHandle}`}
            target="_blank"
            rel="noreferrer"
            style={{ fontWeight: 600, color: "var(--ink)" }}
          >
            {name}
          </a>{" "}
          <span className="muted small">@{comment.authorHandle}</span>
        </div>
      </div>
      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {comment.text}
      </div>
      <div className="row small muted" style={{ gap: 14, marginTop: 8 }}>
        <span>{fmtDate(comment.createdAt)}</span>
        {comment.likeCount > 0 ? <span>♥ {comment.likeCount}</span> : null}
        {canReply ? (
          <button
            className="btn small"
            style={{ padding: "3px 10px" }}
            onClick={() => onReply(comment)}
          >
            返信
          </button>
        ) : null}
        {/* Every comment carries a link back to the real post on Bluesky —
            the product's whole claim (spec §8). */}
        {comment.bskyUrl ? (
          <a href={comment.bskyUrl} target="_blank" rel="noreferrer">
            Blueskyで見る ↗
          </a>
        ) : null}
      </div>
    </article>
  );
}

function CommentComposer({
  videoId,
  isLoggedIn,
  loginHref,
  replyTo,
  onCancelReply,
  onPosted,
}: {
  videoId: string;
  isLoggedIn: boolean;
  loginHref: string;
  replyTo: CommentView | null;
  onCancelReply: () => void;
  onPosted: () => void | Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!isLoggedIn) {
    return (
      <div className="notice" style={{ marginTop: 8 }}>
        コメントするには <a href={loginHref}>Blueskyでログイン</a>。
        書いたコメントは公開ポストとして、あなたのBlueskyプロフィールにも表示されます。
      </div>
    );
  }

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    // One-time disclosure that comments are public posts (spec §7).
    if (!localStorage.getItem(DISCLOSURE_KEY)) {
      const ok = window.confirm(
        "Tsumugiのコメントは公開ポストです。あなたのBlueskyプロフィールの" +
          "「Posts & replies」にも表示されます。よろしいですか？",
      );
      if (!ok) return;
      localStorage.setItem(DISCLOSURE_KEY, "1");
    }

    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/comment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          videoId,
          text: body,
          parentUri: replyTo?.uri,
          parentCid: replyTo?.cid,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `error ${res.status}`);
      setText("");
      await onPosted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      {replyTo ? (
        <div className="small muted" style={{ marginBottom: 6 }}>
          @{replyTo.authorHandle} への返信{" "}
          <button
            className="btn small"
            style={{ padding: "2px 8px" }}
            onClick={onCancelReply}
          >
            やめる
          </button>
        </div>
      ) : null}
      <textarea
        value={text}
        maxLength={300}
        placeholder={replyTo ? "返信を書く…" : "この動画について書く…"}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      <div className="spread" style={{ marginTop: 8 }}>
        <span className="small muted">{text.length}/300</span>
        <button
          className="btn primary"
          onClick={submit}
          disabled={busy || !text.trim()}
        >
          {busy ? "投稿中…" : "コメントする"}
        </button>
      </div>
      {err ? (
        <div className="notice" style={{ marginTop: 8 }}>
          {err}
        </div>
      ) : null}
    </div>
  );
}

function countComments(list: CommentView[]): number {
  let n = 0;
  for (const c of list) n += 1 + c.replies.length;
  return n;
}

function bskyThreadUrl(rootUri: string): string {
  const m = rootUri.match(/^at:\/\/([^/]+)\/[^/]+\/([^/]+)$/);
  return m ? `https://bsky.app/profile/${m[1]}/post/${m[2]}` : "#";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
