import { useState } from "react";
import { createRootPost } from "../lib/post";
import { getBrowserAgent } from "../lib/browser-atproto";

interface SyncVideo {
  videoId: string;
  title: string | null;
  publishedAt: string | null;
}

interface SyncChannel {
  channelId: string;
  channelTitle: string | null;
  videos: SyncVideo[];
  error?: string;
}

export default function SyncPanel() {
  const [channels, setChannels] = useState<SyncChannel[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const check = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/sync", { headers: { accept: "application/json" } });
      const data = (await response.json()) as { channels?: SyncChannel[]; error?: string };
      if (!response.ok || !data.channels) throw new Error(data.error || "新着動画を取得できませんでした");
      setChannels(data.channels);
      setSelected(new Set(data.channels.flatMap((channel) => channel.videos.map((video) => video.videoId))));
      const count = data.channels.reduce((sum, channel) => sum + channel.videos.length, 0);
      setMessage(count ? `${count}件の未同期動画があります。` : "新着動画はありません。");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    const targets = (channels ?? []).flatMap((channel) =>
      channel.videos.filter((video) => selected.has(video.videoId)),
    );
    if (!targets.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const agent = await getBrowserAgent();
      if (!agent) throw new Error("Blueskyへログインしてください");
      let completed = 0;
      for (const video of targets) {
        setMessage(`${targets.length}件中${completed + 1}件目を同期中…`);
        const ref = await createRootPost(agent, {
          videoId: video.videoId,
          videoTitle: video.title,
          origin: location.origin,
          oembed: null,
        });
        const response = await fetch("/api/sync/record", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ videoId: video.videoId, uri: ref.uri, cid: ref.cid }),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) {
          await agent.deletePost(ref.uri).catch(() => undefined);
          throw new Error(result.error || `${video.title || video.videoId}の記録に失敗しました`);
        }
        completed++;
      }
      setMessage(`${completed}件をBlueskyへ同期しました。`);
      await check();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (videoId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      next.has(videoId) ? next.delete(videoId) : next.add(videoId);
      return next;
    });
  };

  const count = selected.size;
  return (
    <section className="card">
      <div className="spread">
        <div>
          <h2 style={{ margin: 0 }}>YouTube動画を同期</h2>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            新着動画を確認し、選んだ動画だけをあなたのBlueskyから投稿します。
          </p>
        </div>
        <button className="btn primary" onClick={check} disabled={busy}>
          {busy ? "確認中…" : "新着動画を確認"}
        </button>
      </div>

      {channels?.map((channel) => (
        <div key={channel.channelId} style={{ marginTop: 16 }}>
          <strong>{channel.channelTitle || channel.channelId}</strong>
          {channel.error ? <p className="small" style={{ color: "var(--danger)" }}>{channel.error}</p> : null}
          {channel.videos.map((video) => (
            <label className="row" key={video.videoId} style={{ marginTop: 8 }}>
              <input type="checkbox" checked={selected.has(video.videoId)} onChange={() => toggle(video.videoId)} />
              <span>{video.title || video.videoId}</span>
              {video.publishedAt ? <span className="small muted">{new Date(video.publishedAt).toLocaleDateString("ja-JP")}</span> : null}
            </label>
          ))}
        </div>
      ))}

      {channels && count > 0 ? (
        <button className="btn primary" style={{ marginTop: 16 }} onClick={sync} disabled={busy}>
          {busy ? "同期中…" : `${count}件をBlueskyへ同期`}
        </button>
      ) : null}
      {message ? <div className="notice" style={{ marginTop: 12 }}>{message}</div> : null}
    </section>
  );
}
