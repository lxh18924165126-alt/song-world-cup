import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Info,
  Lock,
  Play,
  RefreshCw,
  Scale,
  Shuffle,
  Trophy,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  CloudTournamentDraft,
  DrawMatch,
  SnapshotSong,
} from "@song-world-cup/domain";
import { AppHeader } from "../../components/AppHeader";
import { getCurrentImport, saveImportDraft } from "../import/repository";
import { getCloudDraft, redrawCloudDraft } from "./api";
import { startTournament } from "../tournament/api";

export function DrawPreviewPage() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const [draft, setDraft] = useState<CloudTournamentDraft | null>(null);
  const [songs, setSongs] = useState<SnapshotSong[]>([]);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [redrawing, setRedrawing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hashToken = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    setToken(hashToken);
    getCloudDraft(id, hashToken)
      .then((payload) => {
        setDraft(payload.draft);
        setSongs(payload.songs);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "恢复云端草稿失败"))
      .finally(() => setLoading(false));
  }, [id]);

  const songById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);

  async function redraw() {
    if (!draft || !token) return;
    setRedrawing(true);
    setError(null);
    try {
      const payload = await redrawCloudDraft(draft.id, token, draft.version);
      setDraft(payload.draft);
      const current = await getCurrentImport();
      if (current && current.draft.cloudDraftId === draft.id) {
        await saveImportDraft({ ...current.draft, cloudDraftVersion: payload.draft.version });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重新抽签失败");
    } finally {
      setRedrawing(false);
    }
  }

  async function copyRecoveryLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function start() {
    if (!draft || !token) return;
    setStarting(true);
    setError(null);
    try {
      const payload = await startTournament(draft.id, token);
      navigate(payload.recoveryPath);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "正式开始失败");
    } finally {
      setStarting(false);
    }
  }

  if (loading) {
    return <div className="center-state">正在恢复云端抽签草稿…</div>;
  }
  if (!draft) {
    return (
      <div className="center-state">
        <p>{error ?? "云端草稿不可用"}</p>
        <button className="secondary-button" type="button" onClick={() => navigate("/setup")}>返回赛事设置</button>
      </div>
    );
  }

  const leftMatches = draft.draw.firstRound.filter((match) => match.side === "left");
  const rightMatches = draft.draw.firstRound.filter((match) => match.side === "right");
  const leftByes = leftMatches.filter((match) => match.status === "auto_bye").length;
  const rightByes = rightMatches.filter((match) => match.status === "auto_bye").length;

  return (
    <div className="app-shell">
      <AppHeader title="抽签预览" />
      <main className="content-column draw-content">
        <section className="draw-heading">
          <Trophy aria-hidden="true" />
          <h1>抽签完成，预览本次对阵</h1>
          <p>正式开始后，晋级路径将固定不可更改</p>
        </section>

        <section className="surface draw-summary" aria-labelledby="summary-title">
          <div className="draw-section-heading">
            <h2 id="summary-title">本次设置摘要</h2>
            <button type="button" onClick={() => void copyRecoveryLink()}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? "已复制" : "复制恢复链接"}
            </button>
          </div>
          <div className="summary-grid">
            <SummaryItem label="赛事名称" value={draft.name} detail={new Date(draft.createdAt).toLocaleString("zh-CN")} />
            <SummaryItem label="赛制模式" value={draft.scale === "all" ? `${draft.draw.bracketSize} 位全曲签表` : `${draft.scale} 强随机`} detail={draft.scale === "all" ? "所有歌曲随机" : "固定数量模式"} />
            <SummaryItem label="参赛歌曲" value={`${draft.draw.entrantIds.length} 首`} detail={`候选 ${draft.eligibleSongIds.length} 首`} />
            <SummaryItem label="晋级路径" value="开赛后固定" detail="不可重抽" />
          </div>
        </section>

        <section className="surface bracket-preview" aria-labelledby="bracket-title">
          <div className="draw-section-heading"><h2 id="bracket-title">对阵预览</h2><span>共 {draft.draw.roundCount} 轮比赛</span></div>
          <div className="bracket-stage" aria-label="左右赛区签表摘要">
            <div className="zone left-zone"><strong>左赛区 {draft.draw.bracketSize / 2} 强</strong><BracketSteps size={draft.draw.bracketSize / 2} /></div>
            <div className="final-cup"><span>决赛</span><Trophy aria-hidden="true" /></div>
            <div className="zone right-zone"><strong>右赛区 {draft.draw.bracketSize / 2} 强</strong><BracketSteps size={draft.draw.bracketSize / 2} reverse /></div>
          </div>
          <div className="bye-summary">
            <div><span>左赛区轮空</span><strong>{leftByes} 个</strong></div>
            <div><span>右赛区轮空</span><strong>{rightByes} 个</strong></div>
            <div><span>总轮空</span><strong>{draft.draw.byeCount} 个</strong></div>
            <div><span>首轮有效对决</span><strong>{draft.draw.playableMatchCount} 场</strong></div>
          </div>
        </section>

        <section className="surface match-samples" aria-labelledby="sample-title">
          <div className="draw-section-heading"><h2 id="sample-title">首轮部分对阵示例</h2><span>每侧前 4 场</span></div>
          <div className="sample-columns">
            <MatchColumn matches={leftMatches.slice(0, 4)} songById={songById} side="left" />
            <MatchColumn matches={rightMatches.slice(0, 4)} songById={songById} side="right" />
          </div>
        </section>

        <section className="surface draw-rules" aria-label="抽签规则">
          <Rule icon={<Shuffle />} title="完全随机" text="歌曲集合与签位按当前赛制随机生成。" />
          <Rule icon={<Scale />} title="均衡轮空" text="轮空尽量均匀分布在左右赛区。" />
          <Rule icon={<Lock />} title="开赛后不可重抽" text="正式开赛会锁定歌曲、签位和晋级路径。" />
        </section>

        {draft.scale !== "all" ? (
          <p className="draw-warning"><Info aria-hidden="true" />固定数量模式重新抽签会同时重新选择参赛歌曲并重新生成对阵。</p>
        ) : null}
        {error ? <p className="form-error setup-error" role="alert">{error}</p> : null}
        <div className="draw-actions">
          <button className="secondary-draw-button" type="button" onClick={() => navigate("/setup")}><ArrowLeft aria-hidden="true" />返回设置</button>
          <button className="primary-button" type="button" onClick={() => void redraw()} disabled={redrawing}>
            <RefreshCw aria-hidden="true" />{redrawing ? "重新抽签中…" : "重新抽签"}
          </button>
          <button className="primary-button start-button" type="button" onClick={() => void start()} disabled={starting}>
            <Play aria-hidden="true" />{starting ? "正在锁定签表…" : "正式开始"}
          </button>
        </div>
        <p className="draft-status">云端草稿版本 {draft.version} · 恢复链接已就绪</p>
      </main>
    </div>
  );
}

function SummaryItem({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function BracketSteps({ size, reverse = false }: { size: number; reverse?: boolean }) {
  const steps = [size, Math.max(size / 2, 1), Math.max(size / 4, 1)].map((value) => Math.round(value));
  return <div className={reverse ? "bracket-steps reverse" : "bracket-steps"}>{steps.map((step, index) => <span key={`${step}-${index}`}>{step} 强</span>)}</div>;
}

function MatchColumn({
  matches,
  songById,
  side,
}: {
  matches: DrawMatch[];
  songById: Map<string, SnapshotSong>;
  side: "left" | "right";
}) {
  return (
    <div className={`match-column ${side}`}>
      {matches.map((match, index) => (
        <article key={match.index}>
          <span>{index + 1}</span>
          <SongName entrantId={match.entrantAId} songById={songById} />
          <em>VS</em>
          <SongName entrantId={match.entrantBId} songById={songById} />
        </article>
      ))}
    </div>
  );
}

function SongName({ entrantId, songById }: { entrantId: string | null; songById: Map<string, SnapshotSong> }) {
  if (!entrantId) return <strong className="bye-label">轮空<small>BYE</small></strong>;
  const song = songById.get(entrantId);
  return <strong>{song?.title ?? "未知歌曲"}<small>{song?.artists.join(" / ") ?? ""}</small></strong>;
}

function Rule({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <article><span aria-hidden="true">{icon}</span><div><strong>{title}</strong><p>{text}</p></div></article>;
}
