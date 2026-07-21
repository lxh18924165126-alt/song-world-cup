import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Lock, RefreshCw, WifiOff } from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import type { CloudTournament, SnapshotSong, TournamentMatch } from "@song-world-cup/domain";
import { appPath } from "../../app/paths";
import {
  enqueueTournamentPick,
  enqueueTournamentRoundLock,
  discardLocalBranchAndReload,
  flushTournamentEvents,
  loadTournamentForPlay,
  pendingTournamentEventCount,
  reloadTournamentFromCloud,
  saveLocalTournamentAsBranch,
  TournamentLeaseConflictError,
  TournamentQueueConflictError,
  type LocalTournamentPayload,
  type TournamentSyncState,
} from "./repository";
import {
  heartbeatTournament,
  takeoverTournament,
  TournamentRequestError,
  type EditLeaseStatus,
} from "./api";
import { TournamentCanvas } from "./TournamentCanvas";

export function PlayPage() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const [tournament, setTournament] = useState<CloudTournament | null>(null);
  const [songs, setSongs] = useState<SnapshotSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncState, setSyncState] = useState<TournamentSyncState>("synced");
  const [pendingCount, setPendingCount] = useState(0);
  const [lease, setLease] = useState<EditLeaseStatus | null>(null);
  const [leaseBusy, setLeaseBusy] = useState(false);
  const [conflictBusy, setConflictBusy] = useState<"cloud" | "branch" | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const syncPromise = useRef<Promise<void> | null>(null);
  const tokenRef = useRef("");

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
    const hashToken = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    tokenRef.current = hashToken;
    let active = true;
    void (async () => {
      try {
        const payload = await loadTournamentForPlay(id, hashToken);
        if (!active) return;
        applyLocalPayload(payload);
        setLoading(false);
        if (navigator.onLine) {
          const editable = await refreshLease();
          if (editable && payload.pendingCount > 0) await synchronize();
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "恢复赛事失败");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    async function handleOnline() {
      const editable = await refreshLease();
      if (editable) await synchronize();
    }
    function handleOffline() {
      setLease(null);
      setSyncState("offline");
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [id]);

  useEffect(() => {
    if (loading || !navigator.onLine) return;
    const timer = window.setInterval(() => void refreshLease(), 15_000);
    return () => window.clearInterval(timer);
  }, [id, loading]);

  useEffect(() => {
    if (!lease || lease.editable) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [lease]);

  const leaseLocked = syncState !== "offline" && lease !== null && !lease.editable;

  if (loading) return <div className="center-state">正在恢复赛事进度…</div>;
  if (!tournament) {
    return <div className="center-state"><p>{error ?? "赛事不可用"}</p><button className="secondary-button" type="button" onClick={() => navigate("/")}>返回首页</button></div>;
  }

  if (tournament.progress.status === "finished") {
    return <Navigate replace to={`/t/${id}/result${window.location.hash}`} />;
  }

  const round = tournament.progress.rounds[tournament.progress.currentRoundIndex];
  if (!round) return <div className="center-state">赛事轮次数据不可用</div>;
  const entrantsThisRound = round.matches.length * 2;
  const canLock = round.matches.every((match) => Boolean(match.winnerId));

  async function choose(match: TournamentMatch, entrantId: string): Promise<CloudTournament | null> {
    if (!tournament || saving || syncState === "conflict" || leaseLocked) return null;
    const winnerId = match.winnerId === entrantId ? null : entrantId;
    setSaving(true);
    setError(null);
    try {
      const payload = await enqueueTournamentPick(tournament.id, match.id, winnerId);
      const nextPayload = entrantsThisRound === 2 && winnerId
        ? await enqueueTournamentRoundLock(tournament.id)
        : payload;
      applyLocalPayload(nextPayload);
      void synchronize();
      return nextPayload.tournament;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存选择失败");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function lockRound(): Promise<CloudTournament | null> {
    if (!tournament || !canLock || saving || syncState === "conflict" || leaseLocked) return null;
    setSaving(true);
    setError(null);
    try {
      const payload = await enqueueTournamentRoundLock(tournament.id);
      applyLocalPayload(payload);
      void synchronize();
      return payload.tournament;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "锁定轮次失败");
      return null;
    } finally {
      setSaving(false);
    }
  }

  function applyLocalPayload(payload: LocalTournamentPayload) {
    setTournament(payload.tournament);
    setSongs(payload.songs);
    setPendingCount(payload.pendingCount);
    setSyncState(payload.syncState);
  }

  function synchronize(): Promise<void> {
    if (syncPromise.current) return syncPromise.current;
    if (!navigator.onLine) {
      setSyncState("offline");
      return Promise.resolve();
    }
    setSyncState("pending");
    let shouldContinue = true;
    const task = flushTournamentEvents(id)
      .then(applyLocalPayload)
      .catch(async (caught: unknown) => {
        setPendingCount(await pendingTournamentEventCount(id));
        if (caught instanceof TournamentQueueConflictError) {
          setSyncState("conflict");
          setError(caught.message);
        } else if (caught instanceof TournamentLeaseConflictError) {
          setLease(caught.lease ?? null);
          setSyncState("conflict");
          setError(caught.message);
        } else {
          setSyncState("offline");
        }
        shouldContinue = false;
      })
      .finally(async () => {
        syncPromise.current = null;
        if (shouldContinue && navigator.onLine && await pendingTournamentEventCount(id) > 0) {
          void synchronize();
        }
      });
    syncPromise.current = task;
    return task;
  }

  async function refreshLease(): Promise<boolean> {
    if (!navigator.onLine) {
      setLease(null);
      return false;
    }
    try {
      const nextLease = await heartbeatTournament(id, tokenRef.current);
      setLease(nextLease);
      return nextLease.editable;
    } catch (caught) {
      if (caught instanceof TournamentRequestError && caught.code === "edit_lease_required") {
        setLease(caught.lease ?? null);
        return false;
      }
      setLease(null);
      setSyncState("offline");
      return false;
    }
  }

  async function takeover() {
    if (leaseBusy || !lease?.takeoverAllowedAt || Date.now() < Date.parse(lease.takeoverAllowedAt)) return;
    setLeaseBusy(true);
    setError(null);
    try {
      const nextLease = await takeoverTournament(id, tokenRef.current);
      setLease(nextLease);
      applyLocalPayload(await reloadTournamentFromCloud(id));
    } catch (caught) {
      if (caught instanceof TournamentRequestError && caught.code === "edit_lease_required") {
        setLease(caught.lease ?? lease);
      } else {
        setError(caught instanceof Error ? caught.message : "接管编辑权失败");
      }
    } finally {
      setLeaseBusy(false);
    }
  }

  async function useCloudProgress() {
    if (conflictBusy) return;
    setConflictBusy("cloud");
    setError(null);
    try {
      applyLocalPayload(await discardLocalBranchAndReload(id));
      await refreshLease();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载云端进度失败");
    } finally {
      setConflictBusy(null);
    }
  }

  async function saveAsBranch() {
    if (conflictBusy) return;
    setConflictBusy("branch");
    setError(null);
    try {
      const branch = await saveLocalTournamentAsBranch(id);
      window.location.assign(appPath(branch.recoveryPath));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "另存本地分支失败");
      setConflictBusy(null);
    }
  }

  return <TournamentCanvas
    tournament={tournament}
    songs={songs}
    saving={saving}
    interactionDisabled={syncState === "conflict" || leaseLocked}
    error={error}
    statusContent={<>
      <LeaseBanner lease={lease} syncState={syncState} now={clock} busy={leaseBusy} onTakeover={() => void takeover()} />
      <SyncBanner state={syncState} pendingCount={pendingCount} onRetry={() => void synchronize()} />
    </>}
    conflictContent={syncState === "conflict" ? (
      <ConflictPanel
        busy={conflictBusy}
        onUseCloud={() => void useCloudProgress()}
        onSaveBranch={() => void saveAsBranch()}
      />
    ) : null}
    onChoose={choose}
    onLockRound={lockRound}
  />;
}
export function FinalStagePage() {
  const { id = "" } = useParams();
  return <Navigate replace to={`/t/${id}/play${window.location.hash}`} />;
}

function ConflictPanel({
  busy,
  onUseCloud,
  onSaveBranch,
}: {
  busy: "cloud" | "branch" | null;
  onUseCloud: () => void;
  onSaveBranch: () => void;
}) {
  return (
    <section className="conflict-panel" aria-labelledby="conflict-title">
      <h2 id="conflict-title">选择如何处理本地分支</h2>
      <p>本地进度不会自动覆盖云端。你可以放弃本地待同步操作，或将当前进度复制成一场独立的新赛事。</p>
      <div>
        <button type="button" disabled={busy !== null} onClick={onUseCloud}>{busy === "cloud" ? "加载中…" : "使用云端进度"}</button>
        <button type="button" disabled={busy !== null} onClick={onSaveBranch}>{busy === "branch" ? "创建中…" : "将本地分支另存为新赛事"}</button>
      </div>
    </section>
  );
}

function LeaseBanner({
  lease,
  syncState,
  now,
  busy,
  onTakeover,
}: {
  lease: EditLeaseStatus | null;
  syncState: TournamentSyncState;
  now: number;
  busy: boolean;
  onTakeover: () => void;
}) {
  if (!lease || syncState === "offline") return null;
  if (lease.editable) {
    return <div className="lease-banner editable"><Lock aria-hidden="true" /><span>当前设备拥有编辑权</span><small>自动续租中</small></div>;
  }
  const takeoverAt = lease.takeoverAllowedAt ? Date.parse(lease.takeoverAllowedAt) : Number.POSITIVE_INFINITY;
  const remainingSeconds = Math.max(0, Math.ceil((takeoverAt - now) / 1_000));
  const canTakeover = remainingSeconds === 0;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, "0");
  return (
    <div className="lease-banner locked" role="status">
      <Lock aria-hidden="true" />
      <span>另一台设备正在编辑，本设备暂为只读</span>
      <small>{canTakeover ? "保护期已结束" : `${minutes}:${seconds} 后可接管`}</small>
      <button type="button" disabled={!canTakeover || busy} onClick={onTakeover}>{busy ? "接管中…" : "接管编辑权"}</button>
    </div>
  );
}

function SyncBanner({
  state,
  pendingCount,
  onRetry,
}: {
  state: TournamentSyncState;
  pendingCount: number;
  onRetry: () => void;
}) {
  if (state === "synced") {
    return <div className="sync-banner synced" role="status" aria-label="云端进度已同步" title="云端进度已同步"><Check aria-hidden="true" /><span>云端进度已同步</span></div>;
  }
  if (state === "conflict") {
    return <div className="sync-banner conflict"><AlertTriangle aria-hidden="true" /><span>发现其他页面或设备的新进度，本地分支已暂停同步</span></div>;
  }
  if (state === "offline") {
    return <div className="sync-banner offline"><WifiOff aria-hidden="true" /><span>离线可继续比赛 · {pendingCount} 项变更等待联网</span><button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />重试</button></div>;
  }
  return <div className="sync-banner pending"><RefreshCw aria-hidden="true" /><span>正在按顺序同步 {pendingCount} 项变更</span></div>;
}
