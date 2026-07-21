import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Lock,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  FIXED_TOURNAMENT_SCALES,
  getAvailableFixedScales,
  resolveBracketSize,
  type PlaylistSnapshot,
  type TournamentDraft,
  type TournamentScale,
} from "@song-world-cup/domain";
import { AppHeader } from "../../components/AppHeader";
import { promoteBrowserSnapshot } from "../import/api";
import { getCurrentImport, promoteCurrentImport, saveImportDraft } from "../import/repository";
import { createCloudDraft } from "./api";

export function SetupPage() {
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<PlaylistSnapshot | null>(null);
  const [draft, setDraft] = useState<TournamentDraft | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCurrentImport().then((current) => {
      setSnapshot(current?.snapshot ?? null);
      setDraft(current?.draft ?? null);
      setName(current?.draft.name ?? "");
      setLoading(false);
    });
  }, []);

  const availableScales = useMemo(
    () => new Set(getAvailableFixedScales(draft?.selectedSongIds.length ?? 0)),
    [draft?.selectedSongIds.length],
  );

  async function updateScale(scale: TournamentScale) {
    if (!draft || (scale !== "all" && !availableScales.has(scale))) return;
    const nextDraft = { ...draft, scale };
    setDraft(nextDraft);
    await saveImportDraft(nextDraft);
  }

  async function persistName() {
    if (!draft) return;
    const trimmedName = name.trim();
    if (trimmedName.length < 1 || trimmedName.length > 20) return;
    const nextDraft = { ...draft, name: trimmedName };
    setDraft(nextDraft);
    setName(trimmedName);
    await saveImportDraft(nextDraft);
  }

  async function continueToDraw() {
    if (!draft || !snapshot) return;
    const trimmedName = name.trim();
    if (trimmedName.length < 1 || trimmedName.length > 20) {
      setError("赛事名称需为 1 至 20 个字符");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      let cloudSnapshot = snapshot;
      let cloudDraft = draft;
      if (snapshot.storage === "local") {
        const localSelectedIds = new Set(draft.selectedSongIds);
        const selectedPositions = new Set(snapshot.songs.filter((song) => localSelectedIds.has(song.id)).map((song) => song.sourcePosition));
        cloudSnapshot = await promoteBrowserSnapshot(snapshot);
        cloudDraft = {
          ...draft,
          snapshotId: cloudSnapshot.id,
          selectedSongIds: cloudSnapshot.songs.filter((song) => selectedPositions.has(song.sourcePosition)).map((song) => song.id),
        };
        await promoteCurrentImport(cloudSnapshot, cloudDraft);
        setSnapshot(cloudSnapshot);
        setDraft(cloudDraft);
      }
      const created = await createCloudDraft({
        snapshotId: cloudSnapshot.id,
        name: trimmedName,
        selectedSongIds: cloudDraft.selectedSongIds,
        scale: cloudDraft.scale,
      });
      const nextDraft: TournamentDraft = {
        ...cloudDraft,
        name: trimmedName,
        cloudDraftId: created.draft.id,
        cloudDraftToken: created.restoreToken,
        cloudDraftVersion: created.draft.version,
      };
      await saveImportDraft(nextDraft);
      navigate(created.recoveryPath);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建云端草稿失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="center-state">正在读取赛事设置…</div>;
  }
  if (!snapshot || !draft) {
    return (
      <div className="center-state">
        <p>没有找到可设置的赛事草稿。</p>
        <button className="secondary-button" type="button" onClick={() => navigate("/")}>返回导入</button>
      </div>
    );
  }

  const bracketSize = resolveBracketSize(draft.scale, draft.selectedSongIds.length);
  const allSongsBracketSize = resolveBracketSize("all", draft.selectedSongIds.length);

  return (
    <div className="app-shell">
      <AppHeader title="赛事设置" />
      <main>
        <section className="setup-hero">
          <h1>把你的歌单，踢进冠军之夜</h1>
          <p>用热爱投票，让每一首歌走得更远</p>
        </section>
        <div className="content-column setup-content">
          <section className="surface setup-panel" aria-labelledby="tournament-name-title">
            <div className="section-label" id="tournament-name-title">赛事名称 <span>（可编辑）</span></div>
            <div className="name-input-wrap">
              <input
                value={name}
                onChange={(event) => setName(event.target.value.slice(0, 20))}
                onBlur={() => void persistName()}
                aria-label="赛事名称"
                maxLength={20}
              />
              <span>{name.length}/20</span>
            </div>
          </section>

          <section className="surface setup-panel" aria-labelledby="scale-title">
            <div className="section-label" id="scale-title">选择赛事规模</div>
            <div className="scale-grid">
              {FIXED_TOURNAMENT_SCALES.map((scale) => {
                const enabled = availableScales.has(scale);
                const selected = draft.scale === scale;
                return (
                  <button
                    className={selected ? "scale-option selected" : "scale-option"}
                    type="button"
                    key={scale}
                    disabled={!enabled}
                    onClick={() => void updateScale(scale)}
                    aria-pressed={selected}
                  >
                    {!enabled ? <Lock aria-hidden="true" /> : null}
                    <strong>{scale} 强</strong>
                    <span>{scale - 1} 场比赛</span>
                  </button>
                );
              })}
              <button
                className={draft.scale === "all" ? "scale-option selected all-scale" : "scale-option all-scale"}
                type="button"
                onClick={() => void updateScale("all")}
                aria-pressed={draft.scale === "all"}
              >
                <strong>所有歌曲随机</strong>
                <span>{draft.selectedSongIds.length} 首 · {allSongsBracketSize} 位签表</span>
              </button>
            </div>
            <p className="scale-note">当前已选 {draft.selectedSongIds.length} 首歌曲，签表为 {bracketSize} 位。</p>
          </section>

          {error ? <p className="form-error setup-error" role="alert">{error}</p> : null}
          <button className="primary-button setup-continue" type="button" onClick={() => void continueToDraw()} disabled={submitting}>
            <span>{submitting ? "正在创建云端草稿…" : "进入抽签预览"}</span>
            <ArrowRight aria-hidden="true" />
          </button>
          <p className="privacy-note">歌单快照已保存；进入预览后会生成可恢复的云端草稿。</p>
        </div>
      </main>
    </div>
  );
}
