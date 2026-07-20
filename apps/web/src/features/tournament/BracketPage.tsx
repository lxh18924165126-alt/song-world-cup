import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Trophy } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import type { CloudTournament, SnapshotSong } from "@song-world-cup/domain";
import { loadTournamentForPlay } from "./repository";

export function BracketPage() {
  const { id = "" } = useParams();
  const [tournament, setTournament] = useState<CloudTournament | null>(null);
  const [songs, setSongs] = useState<SnapshotSong[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    let active = true;
    void loadTournamentForPlay(id, token)
      .then((payload) => {
        if (!active) return;
        setTournament(payload.tournament);
        setSongs(payload.songs);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "读取对阵失败");
      });
    return () => { active = false; };
  }, [id]);

  const songById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);

  if (!tournament) return <div className="center-state">{error ?? "正在读取完整对阵…"}</div>;

  const currentRound = tournament.progress.rounds[tournament.progress.currentRoundIndex];
  const entrants = currentRound ? currentRound.matches.length * 2 : 0;
  const returnPath = tournament.progress.status === "finished"
    ? `/t/${id}/result${window.location.hash}`
    : entrants <= 4
      ? `/t/${id}/final${window.location.hash}`
      : `/t/${id}/play${window.location.hash}`;

  return (
    <div className="app-shell bracket-shell">
      <header className="bracket-page-header">
        <div>
          <span>TOURNAMENT BRACKET</span>
          <h1>{tournament.name}</h1>
          <p>{tournament.progress.status === "finished" ? "赛事已完结" : `第 ${tournament.progress.currentRoundIndex + 1} 轮进行中`} · 云端版本 {tournament.version}</p>
        </div>
        <Link to={returnPath}><ArrowLeft aria-hidden="true" />{tournament.progress.status === "finished" ? "返回结果" : "继续比赛"}</Link>
      </header>

      <main className="bracket-board" aria-label="赛事完整对阵">
        {tournament.progress.rounds.map((round) => (
          <section className="bracket-round" key={round.index} aria-labelledby={`round-${round.index}`}>
            <header>
              <span>ROUND {round.index + 1}</span>
              <h2 id={`round-${round.index}`}>{round.matches.length * 2 === 2 ? "决赛" : `${round.matches.length * 2} 强`}</h2>
            </header>
            <div>
              {round.matches.map((match) => {
                const entrantA = songById.get(match.entrantAId);
                const entrantB = match.entrantBId ? songById.get(match.entrantBId) : undefined;
                return (
                  <article className={match.status === "locked" || match.status === "auto_bye" ? "bracket-match locked" : "bracket-match"} key={match.id}>
                    <BracketEntrant title={entrantA?.title ?? "未知歌曲"} artist={entrantA?.artists.join(" / ") ?? ""} winner={match.winnerId === match.entrantAId} />
                    <BracketEntrant title={entrantB?.title ?? "轮空"} artist={entrantB?.artists.join(" / ") ?? "BYE"} winner={Boolean(match.entrantBId && match.winnerId === match.entrantBId)} />
                  </article>
                );
              })}
            </div>
          </section>
        ))}
        {tournament.progress.championId ? (
          <section className="bracket-champion" aria-label="冠军">
            <Trophy aria-hidden="true" />
            <span>冠军</span>
            <strong>{songById.get(tournament.progress.championId)?.title ?? "冠军歌曲"}</strong>
            <small>{songById.get(tournament.progress.championId)?.artists.join(" / ")}</small>
          </section>
        ) : null}
      </main>
      <p className="bracket-scroll-tip">可横向滚动查看全部轮次 · 红色标记表示已晋级</p>
    </div>
  );
}

function BracketEntrant({ title, artist, winner }: { title: string; artist: string; winner: boolean }) {
  return (
    <div className={winner ? "bracket-entrant winner" : "bracket-entrant"}>
      <span>{winner ? <Check aria-hidden="true" /> : null}</span>
      <strong>{title}</strong>
      <small>{artist}</small>
    </div>
  );
}
