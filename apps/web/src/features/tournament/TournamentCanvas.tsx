import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Check, ChevronLeft, ChevronRight, ExternalLink, LayoutGrid, Lock, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import type {
  CloudTournament,
  SnapshotSong,
  TournamentMatch,
  TournamentProgress,
  TournamentSide,
} from "@song-world-cup/domain";
import { AppHeader } from "../../components/AppHeader";
import {
  calculateMatchCapacity,
  cameraTargetForStep,
  canvasMetricsForWidth,
  createBracketConnectorGeometry,
  createBracketWorld,
  createRoundCanvasSteps,
  findCanvasStepByMatchId,
  initialCanvasStepIndex,
  parentNodeIds,
  projectMobileCanvasStep,
  promotionFocusPointForStep,
  visibleCanvasStepIndexes,
  MOBILE_STANDARD_LAYOUT,
  type BracketWorld,
  type BracketWorldNode,
  type CanvasMatchStep,
  type CanvasViewportSize,
} from "./bracketCanvas";

type CanvasAnchor = string | "round-gate" | null;

interface TournamentCanvasProps {
  tournament: CloudTournament;
  songs: SnapshotSong[];
  saving: boolean;
  interactionDisabled: boolean;
  error: string | null;
  statusContent: ReactNode;
  conflictContent: ReactNode;
  onChoose: (match: TournamentMatch, entrantId: string) => Promise<CloudTournament | null>;
  onLockRound: () => Promise<CloudTournament | null>;
}

const CAMERA_DURATION_MS = 560;
const AUTO_ADVANCE_DELAY_MS = 700;
const EMPTY_NODE_OVERRIDES = new Map<string, BracketWorldNode>();

export function TournamentCanvas({
  tournament,
  songs,
  saving,
  interactionDisabled,
  error,
  statusContent,
  conflictContent,
  onChoose,
  onLockRound,
}: TournamentCanvasProps) {
  const round = tournament.progress.rounds[tournament.progress.currentRoundIndex];
  if (!round) return <div className="center-state">赛事轮次数据不可用</div>;

  const viewportRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const autoMoveTimer = useRef<number | null>(null);
  const cameraTimer = useRef<number | null>(null);
  const viewport = useObservedSize(viewportRef);
  const reducedMotion = useReducedMotion();
  const lowPerformance = useMemo(() => {
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    return (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
      || (deviceMemory !== undefined && deviceMemory <= 4);
  }, []);
  const songById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);
  const roundIndex = round.index;
  const entrantsThisRound = round.matches.length * 2;
  const capacity = calculateMatchCapacity(viewport, entrantsThisRound);
  const metrics = useMemo(() => canvasMetricsForWidth(viewport.width), [viewport.width]);
  const world = useMemo(
    () => createBracketWorld(tournament.progress.bracketSize, metrics),
    [metrics, tournament.progress.bracketSize],
  );
  const steps = useMemo(() => createRoundCanvasSteps(round, capacity), [capacity, round]);
  const initialIndex = initialCanvasStepIndex(steps);
  const [anchor, setAnchor] = useState<CanvasAnchor>(null);
  const [cameraMoving, setCameraMoving] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const anchoredIndex = anchor === "round-gate" ? steps.length : findCanvasStepByMatchId(steps, anchor);
  const activeIndex = anchoredIndex >= 0 ? anchoredIndex : initialIndex;
  const activeStep = activeIndex < steps.length ? steps[activeIndex] : null;
  const actionableMatches = round.matches.filter((match) => match.status !== "auto_bye");
  const completedCount = actionableMatches.filter((match) => match.winnerId).length;
  const canLock = round.matches.every((match) => Boolean(match.winnerId));
  const stage = stageForEntrants(entrantsThisRound);
  const currentSide = activeStep?.side ?? (entrantsThisRound === 2 ? "final" : "left");
  const stageLabel = stageLabelFor(entrantsThisRound);
  const sideLabel = sideLabelFor(currentSide);
  const currentStepLabel = activeStep
    ? `${sideLabel} · 第 ${activeIndex + 1} 组，共 ${steps.length} 组`
    : "本轮晋级汇总";

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, []);

  useEffect(() => {
    setAnchor((current) => {
      if (current === "round-gate" && canLock) return current;
      if (current !== "round-gate" && findCanvasStepByMatchId(steps, current) >= 0) return current;
      return steps[initialIndex]?.matches[0]?.id ?? "round-gate";
    });
  }, [canLock, initialIndex, roundIndex, steps]);

  useEffect(() => () => {
    clearTimer(autoMoveTimer);
    clearTimer(cameraTimer);
  }, []);

  const virtualIndexes = visibleCanvasStepIndexes(
    Math.min(activeIndex, Math.max(steps.length - 1, 0)),
    steps.length,
  );
  const virtualSteps = virtualIndexes.flatMap((index) => steps[index] ? [steps[index]!] : []);
  const virtualMatches = new Map(virtualSteps.flatMap((step) => step.matches.map((match) => [match.id, match])));
  const promotionIds = new Set(virtualSteps.flatMap((step) => parentNodeIds(step, world)));
  const activeMatchIds = new Set(activeStep?.matches.map((match) => match.id) ?? []);
  const activeParentIds = new Set(activeStep ? parentNodeIds(activeStep, world) : []);
  const mobileProjectionEnabled = viewport.width <= 720
    && (stage === "standard" || stage === "quarterfinal");
  const mobileNodeOverrides = useMemo(
    () => activeStep && mobileProjectionEnabled
      ? projectMobileCanvasStep(activeStep, world, metrics.rowPitch)
      : EMPTY_NODE_OVERRIDES,
    [activeStep, metrics.rowPitch, mobileProjectionEnabled, world],
  );
  const cameraTarget = activeStep ? cameraTargetForStep(activeStep, world, {
    viewport,
    mobileLayout: viewport.width > 720
      ? null
      : stage === "standard" ? "top" : stage === "quarterfinal" ? "center" : null,
    nodeOverrides: mobileNodeOverrides,
  }) : { x: 0, y: 0 };
  const stageFocus = activeStep ? promotionFocusPointForStep(activeStep, world, mobileNodeOverrides) : cameraTarget;
  const finalNode = stage === "final" && activeStep?.matches[0]
    ? world.nodeById.get(activeStep.matches[0].id)
    : undefined;
  const semifinalEchoes = useMemo(() => {
    if (stage !== "final" || roundIndex <= 0) return [];
    const previousRound = tournament.progress.rounds[roundIndex - 1];
    if (!previousRound) return [];
    const echoWidth = matchNodeWidth("semifinal", viewport.width);
    const echoDistance = viewport.width / 2 + echoWidth * 0.2;
    return previousRound.matches.flatMap((match) => {
      const source = world.nodeById.get(match.id);
      if (!source || source.side === "final") return [];
      return [{
        match,
        node: {
          ...source,
          x: source.side === "left" ? -echoDistance : echoDistance,
          y: 0,
        },
      }];
    });
  }, [roundIndex, stage, tournament.progress.rounds, viewport.width, world]);
  const nextIncompleteIndex = steps.findIndex(
    (step, index) => index > activeIndex && step.matches.some((match) => !match.winnerId),
  );

  async function choose(match: TournamentMatch, entrantId: string) {
    if (cameraMoving || saving || interactionDisabled) return;
    clearTimer(autoMoveTimer);
    const selectedWinner = match.winnerId === entrantId ? null : entrantId;
    const updated = await onChoose(match, entrantId);
    if (!updated || updated.progress.status === "finished" || !selectedWinner) return;
    const updatedRound = updated.progress.rounds[updated.progress.currentRoundIndex];
    if (!updatedRound || updatedRound.index !== roundIndex) return;
    const updatedSteps = createRoundCanvasSteps(updatedRound, capacity);
    const updatedIndex = findCanvasStepByMatchId(updatedSteps, match.id);
    const updatedStep = updatedSteps[updatedIndex];
    if (!updatedStep || updatedStep.matches.some((candidate) => !candidate.winnerId)) return;
    const nextIndex = updatedSteps.findIndex(
      (candidate, index) => index > updatedIndex && candidate.matches.some((item) => !item.winnerId),
    );
    autoMoveTimer.current = window.setTimeout(() => {
      if (nextIndex >= 0) {
        const next = updatedSteps[nextIndex];
        moveCamera(next?.matches[0]?.id ?? null, `${sideLabelFor(next?.side ?? "left")}第 ${nextIndex + 1} 组`);
      } else {
        moveCamera("round-gate", "本轮对阵已完成，请确认锁定晋级结果");
      }
    }, reducedMotion ? 0 : AUTO_ADVANCE_DELAY_MS);
  }

  function moveCamera(nextAnchor: CanvasAnchor, nextAnnouncement: string) {
    if (!nextAnchor) return;
    clearTimer(cameraTimer);
    setCameraMoving(!reducedMotion);
    setAnchor(nextAnchor);
    setAnnouncement(nextAnnouncement);
    const finish = () => {
      setCameraMoving(false);
      headingRef.current?.focus({ preventScroll: true });
    };
    if (reducedMotion) {
      window.requestAnimationFrame(finish);
    } else {
      cameraTimer.current = window.setTimeout(finish, CAMERA_DURATION_MS);
    }
  }

  function goPrevious() {
    const previousIndex = activeIndex === steps.length ? steps.length - 1 : activeIndex - 1;
    const previous = steps[previousIndex];
    if (previous) moveCamera(previous.matches[0]?.id ?? null, `${sideLabelFor(previous.side)}第 ${previousIndex + 1} 组`);
  }

  function goNextIncomplete() {
    if (nextIncompleteIndex >= 0) {
      const next = steps[nextIncompleteIndex];
      if (next) moveCamera(next.matches[0]?.id ?? null, `${sideLabelFor(next.side)}第 ${nextIncompleteIndex + 1} 组`);
      return;
    }
    if (canLock && entrantsThisRound > 2) moveCamera("round-gate", "本轮对阵已完成，请确认锁定晋级结果");
  }

  function jumpToStep(index: number) {
    const step = steps[index];
    if (step) moveCamera(step.matches[0]?.id ?? null, `${sideLabelFor(step.side)}第 ${index + 1} 组`);
  }

  async function lockRound() {
    if (!canLock || saving || interactionDisabled || cameraMoving) return;
    const updated = await onLockRound();
    if (!updated || updated.progress.status === "finished") return;
    const nextRound = updated.progress.rounds[updated.progress.currentRoundIndex];
    if (nextRound) {
      const nextSteps = createRoundCanvasSteps(
        nextRound,
        calculateMatchCapacity(viewport, nextRound.matches.length * 2),
      );
      setAnchor(nextSteps[initialCanvasStepIndex(nextSteps)]?.matches[0]?.id ?? null);
      setAnnouncement(`第 ${nextRound.index + 1} 轮开始`);
    }
  }

  return (
    <div className={`app-shell tournament-canvas-shell stage-${stage} capacity-${capacity}${lowPerformance ? " low-performance" : ""}`}>
      <AppHeader title={`${stageLabel} · ${sideLabel}`} />
      <main className="tournament-canvas-main">
        <section className="canvas-hud" aria-label="赛事进度与状态">
          <div className="canvas-heading">
            <div>
              <span>第 {roundIndex + 1} 轮 · {stageLabel} · {currentStepLabel}</span>
              <h1>{tournament.name}</h1>
            </div>
            <div><strong>{completedCount}/{actionableMatches.length}</strong><small>本轮已选择</small></div>
          </div>
          <div className="round-progress"><span style={{ width: `${actionableMatches.length ? completedCount / actionableMatches.length * 100 : 100}%` }} /></div>
          <div className="canvas-hud-row">
            <p>点击歌曲选择胜者；完成本组后镜头会前往最近未完成组。</p>
            <Link className="bracket-link" to={`/t/${tournament.id}/bracket${window.location.hash}`}><LayoutGrid aria-hidden="true" />对阵总览</Link>
          </div>
          <div className="canvas-status-stack">{statusContent}</div>
          {error ? <p className="form-error canvas-error" role="alert">{error}</p> : null}
        </section>

        <section
          className={cameraMoving ? "tournament-canvas-viewport camera-moving" : "tournament-canvas-viewport"}
          ref={viewportRef}
          aria-label="固定淘汰赛签表画布"
          style={{
            "--stage-focus-x": `calc(50% + ${stageFocus.x - cameraTarget.x}px)`,
          } as CSSProperties}
        >
          <div className="canvas-grid" aria-hidden="true" />
          <div className="canvas-spotlight" aria-hidden="true" />
          {stage === "final" ? (
            <>
              <div className="final-trophy-backdrop" aria-hidden="true"><Trophy /></div>
              <div className="final-particles" aria-hidden="true"><span /><span /><span /><span /><span /></div>
            </>
          ) : null}
          <div
            className="bracket-camera"
            style={{
              "--camera-x": `${-cameraTarget.x}px`,
              "--camera-y": `${-cameraTarget.y}px`,
            } as CSSProperties}
          >
            {stage === "final" && finalNode ? semifinalEchoes.map(({ match, node }) => (
              <div className="final-semifinal-approach" key={`final-approach-${match.id}`}>
                <FinalSemifinalEcho match={match} node={node} songById={songById} />
                <BracketConnector
                  from={node}
                  to={finalNode}
                  fromWidth={matchNodeWidth("semifinal", viewport.width)}
                  toWidth={matchNodeWidth("final", viewport.width)}
                  active={Boolean(match.winnerId)}
                  highlighted={false}
                  className="final-approach-connector"
                />
              </div>
            )) : null}
            {[...virtualMatches.values()].map((match) => {
              const node = mobileNodeOverrides.get(match.id) ?? world.nodeById.get(match.id);
              if (!node) return null;
              const active = activeMatchIds.has(match.id);
              return (
                <CanvasMatchNode
                  key={match.id}
                  match={match}
                  node={node}
                  songById={songById}
                  active={active}
                  stage={stage}
                  disabled={!active || saving || interactionDisabled || cameraMoving}
                  onChoose={(entrantId) => void choose(match, entrantId)}
                />
              );
            })}
            {[...promotionIds].map((nodeId) => {
              const node = mobileNodeOverrides.get(nodeId) ?? world.nodeById.get(nodeId);
              if (!node) return null;
              const entrants = entrantsForNode(node, tournament.progress);
              return (
                <PromotionNode
                  key={`promotion-${nodeId}`}
                  node={node}
                  entrantIds={entrants}
                  songById={songById}
                  highlighted={activeParentIds.has(nodeId)}
                  stage={stageForNode(node, world)}
                />
              );
            })}
            {virtualSteps.flatMap((step) => step.matches).map((match) => {
              const source = world.nodeById.get(match.id);
              const from = mobileNodeOverrides.get(match.id) ?? source;
              const to = source?.parentId
                ? mobileNodeOverrides.get(source.parentId) ?? world.nodeById.get(source.parentId)
                : undefined;
              if (!from || !to) return null;
              return (
                <BracketConnector
                  key={`connector-${match.id}`}
                  from={from}
                  to={to}
                  fromWidth={matchNodeWidth(stage, viewport.width)}
                  toWidth={promotionNodeWidth(viewport.width)}
                  active={Boolean(match.winnerId)}
                  highlighted={activeMatchIds.has(match.id)}
                />
              );
            })}
            {activeIndex === steps.length ? (
              <RoundGate
                roundNumber={roundIndex + 1}
                entrantsThisRound={entrantsThisRound}
                saving={saving}
                disabled={!canLock || interactionDisabled || cameraMoving}
                onLock={() => void lockRound()}
              />
            ) : null}
          </div>
          <div className="canvas-stage-watermark" aria-hidden="true">
            {stage === "final" ? <Trophy /> : null}
            <span>{stage === "final" ? "冠军之夜" : stage === "semifinal" ? "决赛席位之争" : stage === "quarterfinal" ? "八强舞台" : `${entrantsThisRound} 强`}</span>
          </div>
          {conflictContent ? <div className="canvas-conflict-overlay">{conflictContent}</div> : null}
        </section>

        <nav className="canvas-navigation" aria-label="对阵组导航">
          <button type="button" disabled={cameraMoving || activeIndex <= 0} onClick={goPrevious}><ChevronLeft aria-hidden="true" />上一组</button>
          <label>
            <span>{activeIndex === steps.length ? "本轮汇总" : `${activeIndex + 1} / ${steps.length} 组`}</span>
            <input
              type="range"
              min={0}
              max={Math.max(steps.length - 1, 0)}
              value={Math.min(activeIndex, Math.max(steps.length - 1, 0))}
              disabled={cameraMoving || steps.length <= 1}
              aria-label="当前轮对阵组"
              onChange={(event) => jumpToStep(Number(event.currentTarget.value))}
            />
          </label>
          <button
            type="button"
            disabled={cameraMoving || (nextIncompleteIndex < 0 && (!canLock || entrantsThisRound <= 2 || activeIndex === steps.length))}
            onClick={goNextIncomplete}
          >
            {nextIncompleteIndex >= 0 ? "下一未完成" : entrantsThisRound <= 2 ? "选择即锁定" : "前往锁轮"}<ChevronRight aria-hidden="true" />
          </button>
        </nav>
      </main>
      <h2 className="sr-only" tabIndex={-1} ref={headingRef}>{stageLabel} · {currentStepLabel}</h2>
      <div className="sr-only" aria-live="polite">{announcement}</div>
    </div>
  );
}

function CanvasMatchNode({
  match,
  node,
  songById,
  active,
  stage,
  disabled,
  onChoose,
}: {
  match: TournamentMatch;
  node: BracketWorldNode;
  songById: Map<string, SnapshotSong>;
  active: boolean;
  stage: CanvasStage;
  disabled: boolean;
  onChoose: (entrantId: string) => void;
}) {
  return (
    <article
      className={`canvas-match-node play-match ${active ? "active" : "virtual"} stage-${stage}`}
      style={nodeStyle(node)}
      data-world-node={node.id}
      data-active={active ? "true" : "false"}
      aria-hidden={active ? undefined : true}
    >
      {stage === "final" ? <span className="final-match-crown" aria-hidden="true">👑</span> : null}
      <header><span>#{match.index + 1}</span><strong>{match.side === "final" ? "总决赛" : "对阵"}</strong></header>
      <PlaySongCard
        song={songById.get(match.entrantAId)}
        selected={match.winnerId === match.entrantAId}
        disabled={disabled}
        mediaDisabled={!active}
        onChoose={() => onChoose(match.entrantAId)}
      />
      <em>VS</em>
      <PlaySongCard
        song={match.entrantBId ? songById.get(match.entrantBId) : undefined}
        selected={Boolean(match.entrantBId && match.winnerId === match.entrantBId)}
        disabled={disabled}
        mediaDisabled={!active}
        onChoose={() => match.entrantBId ? onChoose(match.entrantBId) : undefined}
      />
    </article>
  );
}

function FinalSemifinalEcho({
  match,
  node,
  songById,
}: {
  match: TournamentMatch;
  node: BracketWorldNode;
  songById: Map<string, SnapshotSong>;
}) {
  const entrantA = songById.get(match.entrantAId);
  const entrantB = match.entrantBId ? songById.get(match.entrantBId) : undefined;
  return (
    <article
      className={`final-semifinal-echo side-${node.side}`}
      style={nodeStyle(node)}
      aria-hidden="true"
    >
      <header><span>4 进 2</span><strong>半决赛</strong></header>
      <div><strong>{entrantA?.title ?? "半决赛歌曲"}</strong><small>{entrantA?.artists.join(" / ") ?? ""}</small></div>
      <em>VS</em>
      <div><strong>{entrantB?.title ?? "半决赛歌曲"}</strong><small>{entrantB?.artists.join(" / ") ?? ""}</small></div>
    </article>
  );
}

function PromotionNode({
  node,
  entrantIds,
  songById,
  highlighted,
  stage,
}: {
  node: BracketWorldNode;
  entrantIds: [string | null, string | null];
  songById: Map<string, SnapshotSong>;
  highlighted: boolean;
  stage: CanvasStage;
}) {
  return (
    <article
      className={`promotion-node stage-${stage}${highlighted ? " highlighted" : ""}`}
      style={nodeStyle(node)}
      data-world-node={node.id}
      aria-hidden={!highlighted}
    >
      <header>
        {node.side === "final" ? <Trophy aria-hidden="true" /> : null}
        <span className="promotion-label-desktop">{node.side === "final" ? "总决赛" : "晋级节点"}</span>
        <span className="promotion-label-mobile">{node.side === "final" ? "总决赛" : "下一轮"}</span>
      </header>
      <PromotionSlot entrantId={entrantIds[0]} songById={songById} />
      <PromotionSlot entrantId={entrantIds[1]} songById={songById} />
    </article>
  );
}

function PromotionSlot({ entrantId, songById }: { entrantId: string | null; songById: Map<string, SnapshotSong> }) {
  const song = entrantId ? songById.get(entrantId) : undefined;
  return <div className={song ? "filled" : "pending"}><strong>{song?.title ?? "等待胜者"}</strong><small>{song?.artists.join(" / ") ?? "WINNER"}</small></div>;
}

function BracketConnector({
  from,
  to,
  fromWidth,
  toWidth,
  active,
  highlighted,
  className = "",
}: {
  from: BracketWorldNode;
  to: BracketWorldNode;
  fromWidth: number;
  toWidth: number;
  active: boolean;
  highlighted: boolean;
  className?: string;
}) {
  const geometry = createBracketConnectorGeometry(from, to, fromWidth, toWidth);
  return (
    <svg
      className={`bracket-connector${active ? " active" : ""}${highlighted ? " highlighted" : ""}${className ? ` ${className}` : ""}`}
      style={{ left: geometry.left, top: geometry.top, width: geometry.width, height: geometry.height }}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={`M ${geometry.x1} ${geometry.y1} H ${geometry.middleX} V ${geometry.y2} H ${geometry.x2}`} />
    </svg>
  );
}

function RoundGate({
  roundNumber,
  entrantsThisRound,
  saving,
  disabled,
  onLock,
}: {
  roundNumber: number;
  entrantsThisRound: number;
  saving: boolean;
  disabled: boolean;
  onLock: () => void;
}) {
  return (
    <section className="round-gate" style={{ left: 0, top: 0 }} aria-labelledby="round-gate-title">
      <span>ROUND {roundNumber} COMPLETE</span>
      <Trophy aria-hidden="true" />
      <h2 id="round-gate-title">本轮晋级席位已就绪</h2>
      <p>你仍可返回此前对阵修改选择；确认后本轮将锁定并生成下一轮。</p>
      <button type="button" disabled={disabled} onClick={onLock}><Lock aria-hidden="true" />{saving ? "正在锁定…" : entrantsThisRound === 4 ? "锁定半决赛并进入冠军之夜" : "锁定本轮并晋级"}</button>
    </section>
  );
}

function PlaySongCard({
  song,
  selected,
  disabled,
  mediaDisabled,
  onChoose,
}: {
  song: SnapshotSong | undefined;
  selected: boolean;
  disabled: boolean;
  mediaDisabled: boolean;
  onChoose: () => void;
}) {
  if (!song) return <div className="play-song-card disabled"><strong>轮空</strong><small>BYE</small></div>;
  return (
    <div className={selected ? "play-song-card selected" : "play-song-card"}>
      <button
        type="button"
        className="song-choice"
        disabled={disabled}
        onClick={onChoose}
        aria-label={`${selected ? "取消" : "选择"} ${song.title} 晋级`}
        aria-pressed={selected}
      >
        {selected ? <Check aria-hidden="true" /> : null}
        {selected ? <span className="mobile-selection-label">已晋级</span> : null}
        <strong>{song.title}</strong><small>{song.artists.join(" / ")}</small>
      </button>
      {song.mediaUrl || song.previewUrl ? <MediaControl song={song} disabled={mediaDisabled} /> : <span className="media-disabled">无链接</span>}
    </div>
  );
}

function MediaControl({ song, disabled }: { song: SnapshotSong; disabled: boolean }) {
  const pressTimer = useRef<number | null>(null);
  const stopTimer = useRef<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const longPressed = useRef(false);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => () => {
    clearTimer(pressTimer);
    stopPreview();
  }, []);

  function stopPreview() {
    clearTimer(stopTimer);
    audio.current?.pause();
    audio.current = null;
    setPreviewing(false);
  }

  function beginPress() {
    if (disabled) return;
    longPressed.current = false;
    if (!song.previewUrl) return;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      stopPreview();
      const player = new Audio(song.previewUrl ?? "");
      audio.current = player;
      setPreviewing(true);
      void player.play().catch(stopPreview);
      stopTimer.current = window.setTimeout(stopPreview, 30_000);
    }, 500);
  }

  function activate() {
    if (disabled) return;
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (previewing) {
      stopPreview();
      return;
    }
    if (song.mediaUrl) window.open(song.mediaUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <button
      className={previewing ? "media-control previewing" : "media-control"}
      type="button"
      disabled={disabled}
      aria-label={previewing ? `停止试听 ${song.title}` : `打开 ${song.title}，长按试听`}
      onPointerDown={beginPress}
      onPointerUp={() => clearTimer(pressTimer)}
      onPointerCancel={() => clearTimer(pressTimer)}
      onPointerLeave={() => clearTimer(pressTimer)}
      onContextMenu={(event) => event.preventDefault()}
      onClick={activate}
    >
      <ExternalLink aria-hidden="true" />
      {previewing ? <small>试听中</small> : null}
    </button>
  );
}

function useObservedSize(ref: RefObject<HTMLElement | null>): CanvasViewportSize {
  const [size, setSize] = useState<CanvasViewportSize>(() => ({
    width: typeof window === "undefined" ? 390 : window.innerWidth,
    height: typeof window === "undefined" ? 640 : window.innerHeight,
  }));

  useLayoutEffect(() => {
    const target = ref.current;
    if (!target) return;
    const updateSize = (width: number, height: number) => {
      const roundedWidth = Math.round(width);
      const roundedHeight = Math.round(height);
      setSize((current) => current.width === roundedWidth && current.height === roundedHeight
        ? current
        : { width: roundedWidth, height: roundedHeight });
    };
    const initialBounds = target.getBoundingClientRect();
    updateSize(initialBounds.width, initialBounds.height);
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function entrantsForNode(node: BracketWorldNode, progress: TournamentProgress): [string | null, string | null] {
  const generated = progress.rounds[node.roundIndex]?.matches.find((match) => match.index === node.index);
  if (generated) return [generated.entrantAId, generated.entrantBId];
  const childRound = progress.rounds[node.roundIndex - 1];
  if (!childRound) return [null, null];
  const firstChild = childRound.matches.find((match) => match.index === node.index * 2);
  const secondChild = childRound.matches.find((match) => match.index === node.index * 2 + 1);
  return [firstChild?.winnerId ?? null, secondChild?.winnerId ?? null];
}

function nodeStyle(node: BracketWorldNode): CSSProperties {
  return { left: node.x, top: node.y };
}

function matchNodeWidth(stage: CanvasStage, viewportWidth: number): number {
  if (viewportWidth <= 720) {
    if (stage === "final") return Math.min(310, viewportWidth - 48);
    return stage === "semifinal" ? 184 : MOBILE_STANDARD_LAYOUT.matchWidth;
  }
  if (stage === "final") return 390;
  return stage === "semifinal" ? 320 : 276;
}

function promotionNodeWidth(viewportWidth: number): number {
  return viewportWidth <= 720 ? MOBILE_STANDARD_LAYOUT.promotionWidth : 210;
}

type CanvasStage = "standard" | "quarterfinal" | "semifinal" | "final";

function stageForEntrants(entrants: number): CanvasStage {
  if (entrants === 2) return "final";
  if (entrants === 4) return "semifinal";
  if (entrants === 8) return "quarterfinal";
  return "standard";
}

function stageForNode(node: BracketWorldNode, world: BracketWorld): CanvasStage {
  return stageForEntrants(world.bracketSize / 2 ** node.roundIndex);
}

function stageLabelFor(entrants: number): string {
  if (entrants === 2) return "总决赛";
  if (entrants === 4) return "半决赛";
  if (entrants === 8) return "八强";
  return `${entrants} 进 ${entrants / 2}`;
}

function sideLabelFor(side: TournamentSide): string {
  if (side === "right") return "右赛区";
  if (side === "final") return "冠军之夜";
  return "左赛区";
}

function clearTimer(timer: RefObject<number | null>) {
  if (timer.current !== null) window.clearTimeout(timer.current);
  timer.current = null;
}
