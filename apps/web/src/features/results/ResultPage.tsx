import { useEffect, useState } from "react";
import { AlertTriangle, Cloud, Download, Link2, RefreshCw, RotateCcw, Share2, WifiOff } from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import type { CloudTournament, SnapshotSong } from "@song-world-cup/domain";
import { AppHeader } from "../../components/AppHeader";
import {
  flushTournamentEvents,
  loadCachedTournamentForPlay,
  loadTournamentForPlay,
  type LocalTournamentPayload,
} from "../tournament/repository";
import { closeShare, getShareStatus, openShare, resetShare, type ShareStatus } from "./api";
import { downloadBracketPng, downloadResultPoster, type BracketExportQuality } from "./export";
import { ResultSummary } from "./ResultSummary";

type ResultSyncState = "syncing" | "synced" | "failed" | "offline";

export function ResultPage() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
  const [tournament, setTournament] = useState<CloudTournament | null>(null);
  const [songs, setSongs] = useState<SnapshotSong[]>([]);
  const [share, setShare] = useState<ShareStatus>({ open: false, sharePath: null });
  const [quality, setQuality] = useState<BracketExportQuality>("standard");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState<ResultSyncState>("syncing");
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const cached = await loadCachedTournamentForPlay(id);
        if (!active) return;
        if (cached) {
          applyPayload(cached);
          setLoading(false);
          if (!navigator.onLine) {
            setSyncState("offline");
            return;
          }
          void synchronizeFromCloud(false);
          return;
        }
        await synchronizeFromCloud(true);
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : "加载赛果失败");
          setLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, [id, token]);

  function applyPayload(payload: LocalTournamentPayload) {
    setTournament(payload.tournament);
    setSongs(payload.songs);
  }

  async function synchronizeFromCloud(fatalWhenUnavailable: boolean) {
    if (!navigator.onLine) {
      setSyncState("offline");
      if (fatalWhenUnavailable) {
        setError("此设备尚未缓存该赛事，请联网后重试");
        setLoading(false);
      }
      return;
    }
    setSyncState("syncing");
    setSyncError(null);
    try {
      let payload = await loadTournamentForPlay(id, token);
      if (payload.pendingCount > 0) {
        payload = await flushTournamentEvents(id);
      }
      applyPayload(payload);
      setLoading(false);
      if (payload.tournament.progress.status === "finished") {
        setShare(await getShareStatus(id, token));
      }
      setError(null);
      setSyncState("synced");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "云端同步失败";
      setSyncError(message);
      setSyncState(navigator.onLine ? "failed" : "offline");
      if (fatalWhenUnavailable) setError(message);
    } finally {
      if (fatalWhenUnavailable) setLoading(false);
    }
  }

  if (loading) return <div className="center-state">正在整理最终赛果…</div>;
  if (!tournament) return <div className="center-state"><p>{error ?? "赛果不可用"}</p><button className="secondary-button" onClick={() => navigate("/")} type="button">返回首页</button></div>;
  if (tournament.progress.status !== "finished") return <Navigate replace to={`/t/${id}/play${window.location.hash}`} />;
  const shareUrl = share.sharePath ? new URL(share.sharePath, window.location.origin).href : null;

  async function updateShare(action: "open" | "close" | "reset") {
    setBusy(action);
    setError(null);
    try {
      setShare(await (action === "open" ? openShare(id, token) : action === "close" ? closeShare(id, token) : resetShare(id, token)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新分享设置失败");
    } finally {
      setBusy(null);
    }
  }

  async function copyShare() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setBusy("copied");
    window.setTimeout(() => setBusy(null), 1_200);
  }

  async function exportImage(kind: "bracket" | "poster") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "poster") {
        if (!shareUrl) throw new Error("请先开放赛后分享，以便在海报中生成只读二维码");
        await downloadResultPoster(tournament!, songs, shareUrl);
      } else {
        await downloadBracketPng(tournament!, songs, quality);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PNG 生成失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="app-shell">
      <AppHeader title="最终赛果" />
      <main className="content-column result-content">
        <ResultSummary tournament={tournament} songs={songs} />
        <ResultSyncBanner
          state={syncState}
          error={syncError}
          onRetry={() => void synchronizeFromCloud(false)}
        />
        <section className="surface result-tools">
          <h2>创建者工具</h2>
          <div className="share-control">
            <div><Share2 aria-hidden="true" /><span><strong>赛后只读分享</strong><small>{share.open ? "已开放，任何获得链接的人可查看" : "默认关闭，仅你可以查看"}</small></span></div>
            <button type="button" disabled={busy !== null || syncState !== "synced"} onClick={() => void updateShare(share.open ? "close" : "open")}>{share.open ? "关闭分享" : "开放分享"}</button>
          </div>
          {shareUrl ? <div className="share-link-row"><code>{shareUrl}</code><button type="button" onClick={() => void copyShare()}><Link2 aria-hidden="true" />{busy === "copied" ? "已复制" : "复制"}</button><button type="button" onClick={() => void updateShare("reset")}><RotateCcw aria-hidden="true" />重置</button></div> : null}
          <div className="export-grid">
            <article><h3>纯对阵图 PNG</h3><p>固定暗黑背景，不包含页面装饰。</p><label>清晰度<select value={quality} onChange={(event) => setQuality(event.target.value as BracketExportQuality)}><option value="standard">通用高清版</option><option value="original" disabled={window.innerWidth <= 720}>桌面原始超清版</option></select></label><button type="button" disabled={busy !== null} onClick={() => void exportImage("bracket")}><Download aria-hidden="true" />{busy === "bracket" ? "生成中…" : "下载对阵图"}</button></article>
            <article><h3>9:16 结果海报</h3><p>1080×1920，默认包含只读分享二维码。</p><button type="button" disabled={busy !== null || !shareUrl} onClick={() => void exportImage("poster")}><Download aria-hidden="true" />{busy === "poster" ? "生成中…" : shareUrl ? "下载结果海报" : "开放分享后生成"}</button></article>
          </div>
        </section>
        {error ? <p className="form-error setup-error" role="alert">{error}</p> : null}
      </main>
    </div>
  );
}

function ResultSyncBanner({
  state,
  error,
  onRetry,
}: {
  state: ResultSyncState;
  error: string | null;
  onRetry: () => void;
}) {
  if (state === "synced") {
    return <div className="sync-banner synced"><Cloud aria-hidden="true" /><span>云端进度已同步</span></div>;
  }
  if (state === "offline") {
    return <div className="sync-banner offline"><WifiOff aria-hidden="true" /><span>赛果已保存在本机，联网后可同步云端</span><button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />重试云端同步</button></div>;
  }
  if (state === "failed") {
    return <div className="sync-banner conflict"><AlertTriangle aria-hidden="true" /><span>赛果已保存在本机，云端同步失败{error ? `：${error}` : ""}</span><button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />重试云端同步</button></div>;
  }
  return <div className="sync-banner pending"><RefreshCw aria-hidden="true" /><span>赛果已生成，正在后台同步云端…</span></div>;
}
