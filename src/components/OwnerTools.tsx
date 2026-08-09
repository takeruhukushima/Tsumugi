import { useState } from "react";

// Owner-only controls on a video page: open the comment thread on demand, and
// set who may reply (Bluesky threadgate — spec §7).

type Rule = "everyone" | "following" | "mentioned" | "nobody";

const RULE_LABEL: Record<Rule, string> = {
  everyone: "誰でも返信できる",
  following: "自分がフォローしている人のみ",
  mentioned: "メンションした人のみ",
  nobody: "返信を締め切る",
};

interface Props {
  videoId: string;
  hasRoot: boolean;
}

export default function OwnerTools({ videoId, hasRoot }: Props) {
  const [open, setOpen] = useState(hasRoot);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rule, setRule] = useState<Rule>("everyone");

  const createThread = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/video/${videoId}/create-thread`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `error ${res.status}`);
      setOpen(true);
      setMsg("コメント欄を作成しました。ページを再読み込みします…");
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const applyGate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/threadgate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId, rule }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `error ${res.status}`);
      setMsg("返信の可否を更新しました。");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ borderStyle: "dashed" }}>
      <div className="small muted" style={{ marginBottom: 8 }}>
        クリエイター向け操作
      </div>

      {!open ? (
        <div>
          <p className="small">
            この動画のコメント欄はまだ開かれていません。あなたのBlueskyアカウントから
            ルート投稿を作成すると、スレッドがコメント欄になります。
          </p>
          <button className="btn primary" onClick={createThread} disabled={busy}>
            {busy ? "作成中…" : "コメント欄を作成"}
          </button>
        </div>
      ) : (
        <div>
          <label className="field">
            <span>誰が返信できるか（Blueskyのthreadgate）</span>
            <select
              value={rule}
              onChange={(e) => setRule(e.target.value as Rule)}
              style={{
                font: "inherit",
                padding: "9px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--ink)",
                width: "100%",
              }}
            >
              {(Object.keys(RULE_LABEL) as Rule[]).map((r) => (
                <option key={r} value={r}>
                  {RULE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" onClick={applyGate} disabled={busy}>
            {busy ? "適用中…" : "返信の可否を適用"}
          </button>
          <p className="small muted" style={{ marginTop: 10 }}>
            できるのは「自分の場から外す」ことで、「ネットワークから消す」ことでは
            ありません。元のポストは他のBlueskyクライアントからは見えます。
          </p>
        </div>
      )}

      {msg ? (
        <div className="notice" style={{ marginTop: 10 }}>
          {msg}
        </div>
      ) : null}
    </div>
  );
}
