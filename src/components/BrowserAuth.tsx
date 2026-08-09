import { useEffect, useState } from "react";
import {
  getBrowserAgent,
  initBrowserSession,
  signInWithBluesky,
  signOutFromBluesky,
} from "../lib/browser-atproto";

interface Props { compact?: boolean; }

type Status =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "ready"; did: string; handle: string }
  | { kind: "error"; message: string };

export default function BrowserAuth({ compact }: Props) {
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

      setStatus({ kind: "ready", did: session.did, handle });
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
      location.href = "/";
    } catch (error) {
      setStatus({ kind: "error", message: (error as Error).message });
      setBusy(false);
    }
  };

  if (status.kind === "loading") return <span className="small muted">確認中…</span>;
  if (status.kind === "error") {
    return (
      <span className="small" style={{ color: "var(--danger)" }}>
        Bluesky接続エラー: {status.message}
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
