import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ListFilter, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { PlaylistSnapshot, TournamentDraft } from "@song-world-cup/domain";
import { AppHeader } from "../../components/AppHeader";
import { getCurrentImport, saveImportDraft } from "./repository";

export function SongCheckPage() {
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<PlaylistSnapshot | null>(null);
  const [draft, setDraft] = useState<TournamentDraft | null>(null);
  const [query, setQuery] = useState("");
  const [onlyExcluded, setOnlyExcluded] = useState(false);
  const [loading, setLoading] = useState(true);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("zh-CN"));

  useEffect(() => {
    getCurrentImport().then((current) => {
      setSnapshot(current?.snapshot ?? null);
      setDraft(current?.draft ?? null);
      setLoading(false);
    });
  }, []);

  const selectedIds = useMemo(() => new Set(draft?.selectedSongIds ?? []), [draft?.selectedSongIds]);
  const filteredSongs = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.songs.filter((song) => {
      if (onlyExcluded && selectedIds.has(song.id)) return false;
      if (!deferredQuery) return true;
      const haystack = `${song.title} ${song.artists.join(" ")}`.toLocaleLowerCase("zh-CN");
      return haystack.includes(deferredQuery);
    });
  }, [deferredQuery, onlyExcluded, selectedIds, snapshot]);

  async function updateSelected(nextIds: string[]) {
    if (!draft) return;
    const nextDraft = { ...draft, selectedSongIds: nextIds };
    setDraft(nextDraft);
    await saveImportDraft(nextDraft);
  }

  function toggleSong(songId: string) {
    void updateSelected(selectedIds.has(songId)
      ? draft?.selectedSongIds.filter((id) => id !== songId) ?? []
      : [...(draft?.selectedSongIds ?? []), songId]);
  }

  if (loading) {
    return <div className="center-state">正在读取本地歌单快照…</div>;
  }

  if (!snapshot || !draft) {
    return (
      <div className="center-state">
        <p>没有找到可继续的歌单检查记录。</p>
        <button className="secondary-button" type="button" onClick={() => navigate("/")}>返回导入</button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <AppHeader title="检查歌曲" />
      <main className="content-column check-content">
        <p className="scope-note">以下操作仅影响本次赛事的抽签范围，不会修改音乐平台中的原歌单。</p>
        <section className="playlist-summary surface">
          {snapshot.coverUrl ? <img src={snapshot.coverUrl} alt="" /> : <div className="cover-placeholder"><ListFilter /></div>}
          <div>
            <h1>{snapshot.title}</h1>
            <p>{snapshot.songs.length} 首歌曲 · 导入于 {new Date(snapshot.importedAt).toLocaleString("zh-CN")}</p>
          </div>
        </section>

        <div className="check-tools">
          <label className="search-box">
            <Search aria-hidden="true" />
            <span className="sr-only">搜索歌曲名或歌手</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索歌曲名或歌手" />
          </label>
          <button className={onlyExcluded ? "filter-button active" : "filter-button"} type="button" onClick={() => setOnlyExcluded((value) => !value)}>
            <ListFilter aria-hidden="true" />
            仅看已排除
          </button>
        </div>

        <section className="song-list surface" aria-label="歌曲选择列表">
          <div className="song-list-toolbar">
            <strong>已选择 <em>{draft.selectedSongIds.length}</em> / {snapshot.songs.length}</strong>
            <div>
              <button type="button" onClick={() => void updateSelected(snapshot.songs.map((song) => song.id))}>全选</button>
              <button type="button" onClick={() => void updateSelected([])}>取消全选</button>
              <button className="danger-text" type="button" onClick={() => void updateSelected(snapshot.songs.map((song) => song.id))}>恢复全部</button>
            </div>
          </div>
          <div className="song-rows">
            {filteredSongs.map((song) => {
              const selected = selectedIds.has(song.id);
              return (
                <button className={selected ? "song-row selected" : "song-row"} key={song.id} type="button" onClick={() => toggleSong(song.id)}>
                  <span className="checkbox" aria-hidden="true">{selected ? <Check /> : null}</span>
                  <span className="song-index">{song.sourcePosition + 1}</span>
                  <span className="song-copy"><strong>{song.title}</strong><small>{song.artists.join(" / ")}</small></span>
                  <span className="row-more">•••</span>
                </button>
              );
            })}
          </div>
          <footer>已排除 {snapshot.songs.length - draft.selectedSongIds.length} 首歌曲</footer>
        </section>

        <button className="primary-button continue-button" type="button" disabled={draft.selectedSongIds.length < 2} onClick={() => navigate("/setup")}>
          <span><strong>进入赛事设置</strong><small>将使用 {draft.selectedSongIds.length} 首歌曲</small></span>
          <ArrowRight aria-hidden="true" />
        </button>
      </main>
    </div>
  );
}
