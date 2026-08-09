import { useEffect, useState } from "react";
import { initBrowserSession, signInWithBluesky } from "../lib/browser-atproto";

export default function HomeConnect() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void initBrowserSession()
      .then(session => setLoggedIn(!!session))
      .catch(error => setError((error as Error).message))
      .finally(() => setBusy(false));
  }, []);

  const connect = async () => {
    if (loggedIn) { location.href = "/settings"; return; }
    setBusy(true);
    setError(null);
    try { await signInWithBluesky(); }
    catch (cause) { setError((cause as Error).message); setBusy(false); }
  };

  return <div>
    <button className="btn primary" onClick={connect} disabled={busy}>
      {busy ? "確認中…" : loggedIn ? "同期を始める" : "Blueskyに接続"}
    </button>
    {error ? <div className="small" style={{ color: "var(--danger)", marginTop: 6 }}>{error}</div> : null}
  </div>;
}
