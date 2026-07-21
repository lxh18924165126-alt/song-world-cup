import { useEffect, useState } from "react";
import { AlertTriangle, Download, Link2, RefreshCw, RotateCcw, Share2, WifiOff } from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import type { CloudTournament, SnapshotSong } from "@song-world-cup/domain";
import { appPath } from "../../app/paths";
import { AppHeader } from "../../components/AppHeader";
import {
  flushTournamentEvents,
  loadCachedTournamentForPlay,
  loadTournamentForPlay,
  type LocalTournamentPayload,
} from "../tournament/repository";
import { closeShare, getShareStatus, openShare, resetShare, type ShareStatus } from "./api";
import { downloadBracketPng, type BracketExportQuality } from "./export";
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
  const shareUrl = share.sharePath ? new URL(appPath(share.sharePath), window.location.origin).href : null;

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
    setError(null);
    try {
      await copyText(shareUrl);
      setBusy("copied");
      window.setTimeout(() => setBusy(null), 1_200);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "复制分享链接失败");
    }
  }

  async function exportBracketImage() {
    setBusy("bracket");
    setError(null);
    try {
      if (syncState !== "synced") throw new Error("请先完成云端同步，再生成带公开二维码的对阵图");
      const publicShare = share.open && share.sharePath
        ? share
        : await openShare(id, token);
      if (!publicShare.sharePath) throw new Error("公开赛果链接生成失败");
      setShare(publicShare);
      const publicShareUrl = new URL(appPath(publicShare.sharePath), window.location.origin).href;
      await downloadBracketPng(tournament!, songs, quality, publicShareUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PNG 生成失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="app-shell result-shell">
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
          <div className="export-grid single">
            <article><h3>超大画布对阵图 PNG</h3><label className="export-quality-field"><span>清晰度</span><select value={quality} onChange={(event) => setQuality(event.target.value as BracketExportQuality)}><option value="standard">通用高清版</option><option value="original" disabled={window.innerWidth <= 720}>桌面原始超清版</option></select></label><button type="button" disabled={busy !== null || syncState !== "synced"} onClick={() => void exportBracketImage()}><Download aria-hidden="true" />{busy === "bracket" ? "正在公开并生成…" : "下载对阵图"}</button></article>
          </div>
        </section>
        {error ? <p className="form-error setup-error" role="alert">{error}</p> : null}
      </main>
    </div>
  );
}

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // HTTP、权限策略或浏览器设置可能禁用 Clipboard API，继续使用选区复制回退。
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("复制失败，请手动选择并复制链接");
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
    return null;
  }
  if (state === "offline") {
    return <div className="sync-banner offline"><WifiOff aria-hidden="true" /><span>赛果已保存在本机，联网后可同步云端</span><button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />重试云端同步</button></div>;
  }
  if (state === "failed") {
    return <div className="sync-banner conflict"><AlertTriangle aria-hidden="true" /><span>赛果已保存在本机，云端同步失败{error ? `：${error}` : ""}</span><button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />重试云端同步</button></div>;
  }
  return <div className="sync-banner pending"><RefreshCw aria-hidden="true" /><span>赛果已生成，正在后台同步云端…</span></div>;
}
