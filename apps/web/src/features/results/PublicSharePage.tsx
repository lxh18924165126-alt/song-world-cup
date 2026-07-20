import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AppHeader } from "../../components/AppHeader";
import { getPublicShare, type PublicSharePayload } from "./api";
import { ResultSummary } from "./ResultSummary";

export function PublicSharePage() {
  const { token = "" } = useParams();
  const [payload, setPayload] = useState<PublicSharePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.append(meta);
    }
    meta.content = "noindex,nofollow";
    getPublicShare(token).then(setPayload).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "分享链接不可用"));
    return () => { meta?.remove(); };
  }, [token]);

  if (!payload) return <div className="center-state">{error ?? "正在加载只读赛果…"}</div>;
  return (
    <div className="app-shell">
      <AppHeader title="只读赛果" />
      <main className="content-column result-content public-result">
        <ResultSummary tournament={payload.tournament} songs={payload.songs} playlist={payload.playlist} />
        <section className="surface privacy-panel">
          {payload.playlist.coverUrl ? <img src={payload.playlist.coverUrl} alt="歌单封面" /> : null}
          <div><strong>{payload.playlist.title}</strong><p>此页面仅展示最终赛果，不公开原音乐平台歌单链接，也不提供任何媒体按钮。</p></div>
        </section>
      </main>
    </div>
  );
}
