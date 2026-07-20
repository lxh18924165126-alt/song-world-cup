import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Cloud, ExternalLink, LayoutGrid, Lock, RefreshCw, Trophy, WifiOff } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import type { CloudTournament, SnapshotSong, TournamentMatch } from "@song-world-cup/domain";
import { AppHeader } from "../../components/AppHeader";
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

export function PlayPage({ centerStage = false }: { centerStage?: boolean }) {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const [tournament, setTournament] = useState<CloudTournament | null>(null);
  const [songs, setSongs] = useState<SnapshotSong[]>([]);
  const [page, setPage] = useState(0);
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

  const songById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);
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
  const actionableMatches = round.matches.filter((match) => match.status !== "auto_bye");
  const entrantsThisRound = round.matches.length * 2;
  if (!centerStage && entrantsThisRound <= 4) {
    return <Navigate replace to={`/t/${id}/final${window.location.hash}`} />;
  }
  if (centerStage && entrantsThisRound > 4) {
    return <Navigate replace to={`/t/${id}/play${window.location.hash}`} />;
  }
  const pageSize = entrantsThisRound <= 4 ? 1 : entrantsThisRound <= 8 ? 2 : window.innerWidth <= 720 ? 4 : 8;
  const pageCount = Math.max(Math.ceil(actionableMatches.length / pageSize), 1);
  const currentPage = Math.min(page, pageCount - 1);
  const pageMatches = actionableMatches.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const completedCount = actionableMatches.filter((match) => match.winnerId).length;
  const canLock = round.matches.every((match) => Boolean(match.winnerId));
  const roundLabel = `${entrantsThisRound} 进 ${round.matches.length}`;
  const currentSide = pageMatches[0]?.side === "right" ? "右赛区" : pageMatches[0]?.side === "final" ? "决赛" : "左赛区";
  const stageLabel = entrantsThisRound === 2 ? "总决赛" : entrantsThisRound === 4 ? "半决赛" : entrantsThisRound === 8 ? "八强" : roundLabel;

  async function choose(match: TournamentMatch, entrantId: string) {
    if (!tournament || saving || syncState === "conflict" || leaseLocked) return;
    const winnerId = match.winnerId === entrantId ? null : entrantId;
    setSaving(true);
    setError(null);
    try {
      const payload = await enqueueTournamentPick(tournament.id, match.id, winnerId);
      const nextPayload = entrantsThisRound === 2 && winnerId
        ? await enqueueTournamentRoundLock(tournament.id)
        : payload;
      applyLocalPayload(nextPayload);
      const updatedRound = nextPayload.tournament.progress.rounds[nextPayload.tournament.progress.currentRoundIndex];
      const updatedActionable = updatedRound?.matches.filter((item) => item.status !== "auto_bye") ?? [];
      const start = currentPage * pageSize;
      const currentPageDone = updatedActionable.slice(start, start + pageSize).every((item) => item.winnerId);
      if (winnerId && currentPageDone) {
        const nextIncomplete = updatedActionable.findIndex((item, index) => index >= start + pageSize && !item.winnerId);
        if (nextIncomplete >= 0) window.setTimeout(() => setPage(Math.floor(nextIncomplete / pageSize)), 700);
      }
      void synchronize();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存选择失败");
    } finally {
      setSaving(false);
    }
  }

  async function lockRound() {
    if (!tournament || !canLock || saving || syncState === "conflict" || leaseLocked) return;
    setSaving(true);
    setError(null);
    try {
      const payload = await enqueueTournamentRoundLock(tournament.id);
      applyLocalPayload(payload);
      setPage(0);
      window.scrollTo({ top: 0, behavior: "smooth" });
      void synchronize();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "锁定轮次失败");
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
      window.location.assign(branch.recoveryPath);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "另存本地分支失败");
      setConflictBusy(null);
    }
  }

  return (
    <div className={centerStage ? "app-shell center-stage-shell" : "app-shell"}>
      {centerStage ? (
        <header className="center-stage-header">
          <strong>{stageLabel}</strong>
          <span>{entrantsThisRound === 2 ? "冠军即将诞生" : `${currentSide} · 决赛席位之争`}</span>
        </header>
      ) : <AppHeader title={`${stageLabel} · ${currentSide}`} />}
      <main className={centerStage ? "content-column play-content center-stage-content" : "content-column play-content"}>
        {centerStage ? (
          <section className="center-stage-intro">
            <Trophy aria-hidden="true" />
            <span>CENTER STAGE</span>
            <h1>{entrantsThisRound === 2 ? "中心球场 · 冠军之夜" : `${currentSide} · 半决赛`}</h1>
            <p>{entrantsThisRound === 2 ? "本次选择将直接产生冠军，点击后立即锁定。" : "左右赛区分别决出一首歌曲，胜者会师冠军之夜。"}</p>
          </section>
        ) : null}
        <section className="play-heading">
          <div><span>第 {round.index + 1} 轮 · {currentSide}</span><h1>{tournament.name}</h1></div>
          <div><strong>{completedCount}/{actionableMatches.length}</strong><small>本轮已选择</small></div>
        </section>
        <div className="round-progress"><span style={{ width: `${actionableMatches.length ? completedCount / actionableMatches.length * 100 : 100}%` }} /></div>
        <LeaseBanner lease={lease} syncState={syncState} now={clock} busy={leaseBusy} onTakeover={() => void takeover()} />
        <SyncBanner state={syncState} pendingCount={pendingCount} onRetry={() => void synchronize()} />
        {syncState === "conflict" ? (
          <ConflictPanel
            busy={conflictBusy}
            onUseCloud={() => void useCloudProgress()}
            onSaveBranch={() => void saveAsBranch()}
          />
        ) : null}
        <div className="play-tools">
          <p className="play-tip">{entrantsThisRound === 2 ? "点击歌曲后会立即锁定冠军，无法撤回。" : "点击歌曲选择胜者；再次点击可取消，点击对手可直接改选。"}</p>
          <Link className="bracket-link" to={`/t/${id}/bracket${window.location.hash}`}><LayoutGrid aria-hidden="true" />查看对阵总览</Link>
        </div>

        <section className={centerStage ? "match-page center-stage-match-page" : "match-page"} aria-label={`第 ${currentPage + 1} 页比赛`}>
          {pageMatches.map((match, index) => (
            <article className="play-match" key={match.id}>
              <span className="match-number">{currentPage * pageSize + index + 1}</span>
              <PlaySongCard song={songById.get(match.entrantAId)} selected={match.winnerId === match.entrantAId} disabled={saving || syncState === "conflict" || leaseLocked} onChoose={() => void choose(match, match.entrantAId)} />
              <em>VS</em>
              <PlaySongCard song={match.entrantBId ? songById.get(match.entrantBId) : undefined} selected={match.winnerId === match.entrantBId} disabled={saving || syncState === "conflict" || leaseLocked} onChoose={() => match.entrantBId ? void choose(match, match.entrantBId) : undefined} />
            </article>
          ))}
        </section>

        {pageCount > 1 ? <div className="page-controls">
          <button type="button" disabled={currentPage === 0} onClick={() => setPage((value) => Math.max(value - 1, 0))}><ChevronLeft aria-hidden="true" />上一页</button>
          <span>{currentPage + 1} / {pageCount} 页</span>
          <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage((value) => Math.min(value + 1, pageCount - 1))}>下一页<ChevronRight aria-hidden="true" /></button>
        </div> : null}

        {error ? <p className="form-error setup-error" role="alert">{error}</p> : null}
        {entrantsThisRound > 2 ? <button className="primary-button lock-round-button" type="button" disabled={!canLock || saving || syncState === "conflict" || leaseLocked} onClick={() => void lockRound()}>
          <Lock aria-hidden="true" />{canLock ? (entrantsThisRound === 4 ? "锁定半决赛并进入冠军之夜" : "锁定本轮并晋级") : `还需完成 ${actionableMatches.length - completedCount} 场对决`}
        </button> : null}
        <p className="draft-status">锁定前可修改本轮任意选择 · 云端版本 {tournament.version}{pendingCount > 0 ? ` · 本地待同步 ${pendingCount}` : ""}</p>
      </main>
    </div>
  );
}

export function FinalStagePage() {
  return <PlayPage centerStage />;
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
    return <div className="sync-banner synced"><Cloud aria-hidden="true" /><span>云端进度已同步</span></div>;
  }
  if (state === "conflict") {
    return <div className="sync-banner conflict"><AlertTriangle aria-hidden="true" /><span>发现其他页面或设备的新进度，本地分支已暂停同步</span></div>;
  }
  if (state === "offline") {
    return <div className="sync-banner offline"><WifiOff aria-hidden="true" /><span>离线可继续比赛 · {pendingCount} 项变更等待联网</span><button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />重试</button></div>;
  }
  return <div className="sync-banner pending"><RefreshCw aria-hidden="true" /><span>正在按顺序同步 {pendingCount} 项变更</span></div>;
}

function PlaySongCard({
  song,
  selected,
  disabled,
  onChoose,
}: {
  song: SnapshotSong | undefined;
  selected: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  if (!song) return <div className="play-song-card disabled"><strong>轮空</strong><small>BYE</small></div>;
  const songUrl = song.mediaUrl;
  return (
    <div className={selected ? "play-song-card selected" : "play-song-card"}>
      <button type="button" className="song-choice" disabled={disabled} onClick={onChoose} aria-pressed={selected}>
        {selected ? <Check aria-hidden="true" /> : null}<strong>{song.title}</strong><small>{song.artists.join(" / ")}</small>
      </button>
      {songUrl || song.previewUrl ? <MediaControl song={song} songUrl={songUrl} /> : <span className="media-disabled">无链接</span>}
    </div>
  );
}

function MediaControl({ song, songUrl }: { song: SnapshotSong; songUrl: string | null }) {
  const pressTimer = useRef<number | null>(null);
  const stopTimer = useRef<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const longPressed = useRef(false);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => () => {
    clearPressTimer();
    stopPreview();
  }, []);

  function clearPressTimer() {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  function stopPreview() {
    if (stopTimer.current !== null) window.clearTimeout(stopTimer.current);
    stopTimer.current = null;
    audio.current?.pause();
    audio.current = null;
    setPreviewing(false);
  }

  function beginPress() {
    longPressed.current = false;
    if (!song.previewUrl) return;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      stopPreview();
      const player = new Audio(song.previewUrl ?? "");
      audio.current = player;
      setPreviewing(true);
      void player.play().catch(() => stopPreview());
      stopTimer.current = window.setTimeout(stopPreview, 30_000);
    }, 500);
  }

  function activate() {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (previewing) {
      stopPreview();
      return;
    }
    if (songUrl) window.open(songUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <button
      className={previewing ? "media-control previewing" : "media-control"}
      type="button"
      aria-label={previewing ? `停止试听 ${song.title}` : `打开 ${song.title}，长按试听`}
      onPointerDown={beginPress}
      onPointerUp={clearPressTimer}
      onPointerCancel={clearPressTimer}
      onPointerLeave={clearPressTimer}
      onContextMenu={(event) => event.preventDefault()}
      onClick={activate}
    >
      <ExternalLink aria-hidden="true" />
      {previewing ? <small>试听中</small> : null}
    </button>
  );
}
