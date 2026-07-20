import QRCode from "qrcode";
import {
  deriveTournamentResult,
  type CloudTournament,
  type SnapshotSong,
  type TournamentProgress,
} from "@song-world-cup/domain";

export type BracketExportQuality = "standard" | "original";

export function computeBracketCanvasSize(
  progress: TournamentProgress,
  quality: BracketExportQuality,
): { width: number; height: number } {
  const roundCount = progress.rounds.length;
  const firstRoundMatches = progress.rounds[0]?.matches.length ?? 1;
  const width = Math.max(1600, roundCount * 270 + 160);
  const desiredHeight = firstRoundMatches * (quality === "original" ? 72 : 42) + 220;
  return {
    width: Math.min(width, quality === "original" ? 8192 : 4096),
    height: Math.min(Math.max(desiredHeight, 1200), quality === "original" ? 32760 : 8192),
  };
}

export async function downloadBracketPng(
  tournament: CloudTournament,
  songs: SnapshotSong[],
  quality: BracketExportQuality,
): Promise<void> {
  const { width, height } = computeBracketCanvasSize(tournament.progress, quality);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = requireContext(canvas);
  fillBackground(context, width, height);
  context.fillStyle = "#f5c46b";
  context.font = "700 24px sans-serif";
  context.fillText("SONG WORLD CUP · 完整对阵", 70, 62);
  context.fillStyle = "#f5f7fa";
  context.font = "900 42px sans-serif";
  context.fillText(tournament.name, 70, 116);
  context.fillStyle = "#aab4c0";
  context.font = "20px sans-serif";
  context.fillText(`${tournament.progress.bracketSize} 强 · ${quality === "original" ? "原始超清版" : "通用高清版"}`, 70, 154);

  const songById = new Map(songs.map((song) => [song.id, song]));
  const top = 200;
  const availableHeight = height - top - 70;
  const columnWidth = (width - 120) / tournament.progress.rounds.length;
  for (const [roundIndex, round] of tournament.progress.rounds.entries()) {
    const centerX = 60 + columnWidth * roundIndex + columnWidth / 2;
    context.fillStyle = roundIndex === tournament.progress.rounds.length - 1 ? "#f5c46b" : "#aab4c0";
    context.font = "700 18px sans-serif";
    context.textAlign = "center";
    context.fillText(roundLabel(roundIndex, tournament.progress.rounds.length), centerX, top - 20);
    const gap = availableHeight / Math.max(round.matches.length, 1);
    const cardHeight = Math.max(3, Math.min(52, gap * 0.72));
    for (const [matchIndex, match] of round.matches.entries()) {
      const y = top + gap * (matchIndex + 0.5);
      if (roundIndex < tournament.progress.rounds.length - 1) {
        const nextRound = tournament.progress.rounds[roundIndex + 1];
        const nextGap = availableHeight / Math.max(nextRound?.matches.length ?? 1, 1);
        const nextY = top + nextGap * (Math.floor(matchIndex / 2) + 0.5);
        context.strokeStyle = "rgba(229,57,53,.45)";
        context.lineWidth = Math.max(1, cardHeight / 18);
        context.beginPath();
        context.moveTo(centerX + columnWidth * 0.36, y);
        context.lineTo(centerX + columnWidth * 0.5, y);
        context.lineTo(centerX + columnWidth * 0.5, nextY);
        context.lineTo(centerX + columnWidth * 0.64, nextY);
        context.stroke();
      }
      context.fillStyle = match.winnerId ? "rgba(229,57,53,.25)" : "#171d24";
      context.strokeStyle = match.winnerId ? "rgba(239,74,69,.72)" : "rgba(255,255,255,.15)";
      context.lineWidth = 1;
      context.beginPath();
      context.roundRect(centerX - columnWidth * 0.36, y - cardHeight / 2, columnWidth * 0.72, cardHeight, Math.min(10, cardHeight / 3));
      context.fill();
      context.stroke();
      if (cardHeight >= 20) {
        context.fillStyle = "#f5f7fa";
        context.font = `${Math.max(10, Math.min(16, cardHeight * 0.34))}px sans-serif`;
        context.textAlign = "left";
        const winner = match.winnerId ? songById.get(match.winnerId)?.title : null;
        context.fillText(fitText(context, winner ?? "待定", columnWidth * 0.64), centerX - columnWidth * 0.31, y + 5);
      }
    }
  }
  context.textAlign = "left";
  await downloadCanvas(canvas, `${safeFilename(tournament.name)}-对阵图.png`);
}

export async function downloadResultPoster(
  tournament: CloudTournament,
  songs: SnapshotSong[],
  shareUrl: string,
): Promise<void> {
  const result = deriveTournamentResult(tournament.progress);
  const songById = new Map(songs.map((song) => [song.id, song]));
  const champion = songById.get(result.championId);
  const runnerUp = songById.get(result.runnerUpId);
  const semifinalists = result.semifinalistIds.map((id) => songById.get(id)).filter(Boolean);
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const context = requireContext(canvas);
  fillBackground(context, canvas.width, canvas.height);
  const glow = context.createRadialGradient(540, 430, 20, 540, 430, 700);
  glow.addColorStop(0, "rgba(229,57,53,.26)");
  glow.addColorStop(1, "rgba(9,11,14,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 1080, 1920);
  context.textAlign = "center";
  context.fillStyle = "#f5c46b";
  context.font = "700 25px sans-serif";
  context.fillText("SONG WORLD CUP", 540, 122);
  context.fillStyle = "#f5f7fa";
  context.font = "900 64px sans-serif";
  context.fillText(fitText(context, tournament.name, 900), 540, 220);
  context.fillStyle = "#aab4c0";
  context.font = "26px sans-serif";
  context.fillText(`${tournament.progress.bracketSize} 强 · 最终结果`, 540, 270);

  drawPanel(context, 90, 330, 900, 420, "#f5c46b");
  context.fillStyle = "#f5c46b";
  context.font = "700 26px sans-serif";
  context.fillText("冠军", 180, 400);
  context.fillStyle = "#f5f7fa";
  context.font = "900 82px sans-serif";
  context.textAlign = "left";
  context.fillText(fitText(context, champion?.title ?? "冠军歌曲", 700), 150, 540);
  context.fillStyle = "#aab4c0";
  context.font = "32px sans-serif";
  context.fillText(fitText(context, champion?.artists.join(" / ") ?? "", 700), 150, 600);
  context.fillStyle = "#f5c46b";
  context.font = "700 28px sans-serif";
  context.fillText(`${result.championWinCount} 场胜利`, 150, 684);

  drawPanel(context, 90, 790, 430, 230, "rgba(255,255,255,.24)");
  drawPanel(context, 560, 790, 430, 230, "rgba(255,255,255,.24)");
  context.fillStyle = "#aab4c0";
  context.font = "25px sans-serif";
  context.fillText("亚军", 130, 850);
  context.fillText("并列四强", 600, 850);
  context.fillStyle = "#f5f7fa";
  context.font = "700 38px sans-serif";
  context.fillText(fitText(context, runnerUp?.title ?? "—", 350), 130, 930);
  context.fillText(fitText(context, semifinalists.map((song) => song?.title).join(" / ") || "—", 350), 600, 930);

  drawPanel(context, 90, 1070, 900, 360, "rgba(255,255,255,.2)");
  context.fillStyle = "#aab4c0";
  context.font = "25px sans-serif";
  context.fillText("扫码查看只读最终赛果", 140, 1145);
  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, shareUrl, { width: 230, margin: 2, color: { dark: "#090b0e", light: "#f5f7fa" } });
  context.drawImage(qrCanvas, 690, 1125, 230, 230);
  context.fillStyle = "#f5f7fa";
  context.font = "700 34px sans-serif";
  context.fillText("最终对决已开放", 140, 1220);
  context.fillStyle = "#aab4c0";
  context.font = "24px sans-serif";
  context.fillText(`${result.playedMatchCount} 场对决 · 只读分享`, 140, 1272);

  context.textAlign = "center";
  context.fillStyle = "#707985";
  context.font = "22px sans-serif";
  context.fillText("分享页不公开原歌单链接，也不提供媒体按钮", 540, 1545);
  context.fillStyle = "#f5c46b";
  context.font = "700 24px sans-serif";
  context.fillText("歌曲世界杯 · 在你的歌单里决出冠军", 540, 1740);
  await downloadCanvas(canvas, `${safeFilename(tournament.name)}-结果海报.png`);
}

function fillBackground(context: CanvasRenderingContext2D, width: number, height: number) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#090b0e");
  gradient.addColorStop(0.5, "#11161c");
  gradient.addColorStop(1, "#090b0e");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function drawPanel(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, stroke: string) {
  context.fillStyle = "#11161c";
  context.strokeStyle = stroke;
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(x, y, width, height, 28);
  context.fill();
  context.stroke();
}

function roundLabel(index: number, count: number): string {
  if (index === count - 1) return "决赛";
  if (index === count - 2) return "半决赛";
  return `${2 ** (count - index)} 强`;
}

function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1);
  return `${result}…`;
}

function requireContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法生成 PNG");
  return context;
}

async function downloadCanvas(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG 生成失败")), "image/png");
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 60) || "歌曲世界杯";
}
