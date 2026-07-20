import { Crown, Trophy } from "lucide-react";
import {
  deriveTournamentResult,
  type CloudTournament,
  type SnapshotSong,
} from "@song-world-cup/domain";

export function ResultSummary({
  tournament,
  songs,
  playlist,
}: {
  tournament: CloudTournament;
  songs: SnapshotSong[];
  playlist?: { title: string; coverUrl: string | null };
}) {
  const result = deriveTournamentResult(tournament.progress);
  const songById = new Map(songs.map((song) => [song.id, song]));
  const champion = songById.get(result.championId);
  const runnerUp = songById.get(result.runnerUpId);
  const semifinalists = result.semifinalistIds.map((id) => songById.get(id)).filter(Boolean);

  return (
    <>
      <section className="result-hero">
        <Trophy aria-hidden="true" />
        <span>比赛已结束</span>
        <h1>{tournament.name}</h1>
        <p>{playlist ? `${playlist.title} · ` : ""}{tournament.progress.bracketSize} 强 · {result.playedMatchCount} 场对决</p>
      </section>
      <section className="surface champion-panel">
        <div className="champion-copy">
          <span><Crown aria-hidden="true" />冠军</span>
          <h2>{champion?.title ?? "冠军歌曲"}</h2>
          <p>{champion?.artists.join(" / ")}</p>
          <small>{result.championWinCount} 场胜利 · 从签表一路晋级</small>
        </div>
        <Trophy className="champion-trophy" aria-hidden="true" />
      </section>
      <section className="result-podium">
        <article className="surface"><span>亚军</span><strong>{runnerUp?.title ?? "—"}</strong><small>{runnerUp?.artists.join(" / ")}</small></article>
        <article className="surface"><span>并列四强</span><strong>{semifinalists.map((song) => song?.title).join(" / ") || "—"}</strong><small>{semifinalists.map((song) => song?.artists.join(" / ")).join(" · ")}</small></article>
      </section>
      <section className="surface result-timeline">
        <h2>完整赛果</h2>
        <div>{tournament.progress.rounds.map((round, index) => <span key={round.index}>{index === tournament.progress.rounds.length - 1 ? "冠军" : `${2 ** (tournament.progress.rounds.length - index)} 强`}</span>)}</div>
      </section>
    </>
  );
}
