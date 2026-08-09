import { useEffect, useState } from "react";
import { createActionProof, initBrowserSession } from "../lib/browser-atproto";
import SyncPanel from "./SyncPanel";

interface Channel {
  channelId: string;
  title: string | null;
}

export default function SettingsClient({ googleConfigured }: { googleConfigured: boolean }) {
  const [did, setDid] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { void load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const session = await initBrowserSession();
      if (!session) { setDid(null); return; }
      setDid(session.did);
      const response = await fetch(`/api/channels?did=${encodeURIComponent(session.did)}`);
      const data = await response.json() as { channels?: Channel[]; error?: string };
      if (!response.ok) throw new Error(data.error || "チャンネルを取得できませんでした");
      setChannels(data.channels || []);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const register = async () => {
    setMessage(null);
    if (!googleConfigured) {
      setMessage(
        "Google OAuthが未設定です。.dev.vars に GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を設定して、pnpm devを再起動してください。",
      );
      return;
    }
    const proof = await createActionProof("register-channel");
    try {
      const response = await fetch("/auth/google/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proofUri: proof.uri }),
      });
      const data = await response.json() as { authUrl?: string; error?: string };
      if (!response.ok || !data.authUrl) throw new Error(data.error || "Google認証を開始できませんでした");
      await proof.remove();
      location.href = data.authUrl;
    } catch (error) {
      await proof.remove();
      setMessage((error as Error).message);
    }
  };

  const disconnect = async (channelId: string) => {
    if (!confirm("登録を解除しますか？既存のコメントは各ユーザーのPDSに残ります。")) return;
    const proof = await createActionProof("disconnect-channel", { channelId });
    try {
      const response = await fetch(`/api/channel/${encodeURIComponent(channelId)}/disconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proofUri: proof.uri }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "登録解除に失敗しました");
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      await proof.remove();
    }
  };

  if (loading) return <p className="muted">Blueskyのログイン状態を確認中…</p>;
  if (!did) return <section className="card"><h2>Blueskyへログインしてください</h2><p className="muted small">上部のログインボタンを使ってください。ログイン状態はブラウザだけに保存されます。</p></section>;

  return <>
    {channels.length > 0 ? <SyncPanel did={did} /> : null}
    <section className="card">
      <div className="spread">
        <div><h2 style={{ margin: 0 }}>チャンネルを登録</h2><p className="muted small">Googleで所有するYouTubeチャンネルを証明します。</p></div>
        <button className="btn primary" onClick={register}>YouTubeチャンネルを登録</button>
      </div>
      {!googleConfigured ? <p className="small muted" style={{ marginBottom: 0 }}>Google OAuthの設定が必要です。</p> : null}
    </section>
    <h2>登録済みチャンネル</h2>
    {channels.length === 0 ? <p className="muted">まだ登録していません。</p> : <ul style={{ listStyle: "none", padding: 0 }}>
      {channels.map(channel => <li className="card spread" key={channel.channelId}><div><a href={`/c/${channel.channelId}`}><strong>{channel.title || channel.channelId}</strong></a><div className="small muted">{channel.channelId}</div></div><button className="btn small danger" onClick={() => disconnect(channel.channelId)}>登録解除</button></li>)}
    </ul>}
    {message ? <div className="notice">{message}</div> : null}
  </>;
}
