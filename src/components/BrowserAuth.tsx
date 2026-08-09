import { useEffect, useState } from "react";
import {
  AUTH_COLLECTION,
  getBrowserAgent,
  initBrowserSession,
  signInWithBluesky,
  signOutFromBluesky,
} from "../lib/browser-atproto";

interface Props {
  serverDid?: string;
  serverHandle?: string;
  compact?: boolean;
}

type Status =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "ready"; did: string; handle: string }
  | { kind: "error"; message: string };

export default function BrowserAuth({ serverDid, serverHandle, compact }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void initialize();
  }, []);

  const initialize = async () => {
    try {
      const session = await initBrowserSession();
      if (!session) {
        setStatus({ kind: "anonymous" });
        return;
      }
      const agent = await getBrowserAgent();
      if (!agent) throw new Error("Blueskyセッションを復元できませんでした");
      let handle: string = session.did;
      try {
        const profile = await agent.getProfile({ actor: session.did });
        handle = profile.data.handle || session.did;
      } catch {
        // Display-only; the DID session is still usable.
      }

      if (serverDid !== session.did) {
        await establishServerSession(agent, session.did);
        location.reload();
        return;
      }
      setStatus({ kind: "ready", did: session.did, handle: serverHandle || handle });
    } catch (error) {
      setStatus({ kind: "error", message: (error as Error).message });
    }
  };

  const login = async () => {
    setBusy(true);
    try {
      await signInWithBluesky();
    } catch (error) {
      setStatus({ kind: "error", message: (error as Error).message });
      setBusy(false);
    }
  };

  const logout = async () => {
    if (status.kind !== "ready") return;
    setBusy(true);
    try {
      await signOutFromBluesky(status.did);
      await fetch("/auth/bsky/logout", { method: "POST" });
      location.href = "/";
    } catch (error) {
      setStatus({ kind: "error", message: (error as Error).message });
      setBusy(false);
    }
  };

  if (status.kind === "loading") return <span className="small muted">確認中…</span>;
  if (status.kind === "error") {
    return (
      <span className="small" style={{ color: "var(--danger)" }} title={status.message}>
        Bluesky接続エラー
      </span>
    );
  }
  if (status.kind === "anonymous") {
    return (
      <button className={`btn primary ${compact ? "small" : ""}`} onClick={login} disabled={busy}>
        {busy ? "接続中…" : "Blueskyでログイン"}
      </button>
    );
  }
  return (
    <div className="row">
      <span className="muted small">@{status.handle}</span>
      <button className="btn small" onClick={logout} disabled={busy}>
        {busy ? "処理中…" : "ログアウト"}
      </button>
    </div>
  );
}

async function establishServerSession(
  agent: NonNullable<Awaited<ReturnType<typeof getBrowserAgent>>>,
  did: string,
) {
  const challengeResponse = await fetch("/api/auth/bsky/challenge", { method: "POST" });
  const challenge = (await challengeResponse.json()) as {
    token?: string;
    nonce?: string;
    error?: string;
  };
  if (!challengeResponse.ok || !challenge.token || !challenge.nonce) {
    throw new Error(challenge.error || "本人確認を開始できませんでした");
  }

  const created = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: AUTH_COLLECTION,
    record: {
      $type: AUTH_COLLECTION,
      challenge: challenge.nonce,
      createdAt: new Date().toISOString(),
    },
  });

  try {
    const response = await fetch("/api/auth/bsky/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: challenge.token, uri: created.data.uri }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(result.error || "本人確認に失敗しました");
  } finally {
    await agent.com.atproto.repo
      .deleteRecord({ repo: did, collection: AUTH_COLLECTION, rkey: created.data.uri.split("/").at(-1)! })
      .catch(() => undefined);
  }
}
