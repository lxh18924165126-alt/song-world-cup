import { toCanvas as renderQrCode } from "qrcode";
import {
  type CloudTournament,
  type SnapshotSong,
  type TournamentMatch,
  type TournamentProgress,
} from "@song-world-cup/domain";
import {
  createBracketConnectorGeometry,
  createBracketWorld,
  type BracketWorld,
  type BracketWorldNode,
} from "../tournament/bracketCanvas";

export type BracketExportQuality = "standard" | "original";

interface BracketExportLayout {
  width: number;
  height: number;
  headerHeight: number;
  footerHeight: number;
  centerX: number;
  centerY: number;
  cardWidth: number;
  cardHeight: number;
  world: BracketWorld;
}

const COLORS = {
  background: "#07090c",
  redBright: "#ff625e",
  gold: "#f5c46b",
  text: "#f5f7fa",
  muted: "#aab4c0",
};

export function computeBracketCanvasSize(
  progress: TournamentProgress,
  quality: BracketExportQuality,
): { width: number; height: number } {
  const roundCount = progress.rounds.length;
  const firstRoundMatches = progress.rounds[0]?.matches.length ?? 1;
  const width = Math.max(1600, roundCount * 270 + 160);
  const desiredHeight = firstRoundMatches * (quality === "original" ? 72 : 42) + 300;
  return {
    width: Math.min(width, quality === "original" ? 8192 : 4096),
    height: Math.min(Math.max(desiredHeight, 1200), quality === "original" ? 32760 : 8192),
  };
}

export async function downloadBracketPng(
  tournament: CloudTournament,
  songs: SnapshotSong[],
  quality: BracketExportQuality,
  publicShareUrl: string,
): Promise<void> {
  if (!/^https?:\/\//i.test(publicShareUrl)) throw new Error("公开赛果链接不可用，无法生成二维码");
  const canvas = await renderBracketCanvas(tournament, songs, quality, publicShareUrl);
  await downloadCanvas(canvas, `${safeFilename(tournament.name)}-对阵图.png`);
}

async function renderBracketCanvas(
  tournament: CloudTournament,
  songs: SnapshotSong[],
  quality: BracketExportQuality,
  publicShareUrl: string,
): Promise<HTMLCanvasElement> {
  const layout = createExportLayout(tournament.progress, quality);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = requireContext(canvas);
  const songById = new Map(songs.map((song) => [song.id, song]));
  const matchById = new Map(tournament.progress.rounds.flatMap((round) => round.matches.map((match) => [match.id, match])));

  drawBroadcastBackground(context, layout, tournament.id);
  drawHeader(context, layout, tournament, quality);
  drawWorldDecorations(context, layout);
  drawConnectors(context, layout, matchById);
  drawMatchNodes(context, layout, matchById, songById);
  drawChampionStage(context, layout, tournament, songById);
  await drawShareQrCode(context, layout, publicShareUrl);
  drawFooter(context, layout);
  return canvas;
}

function createExportLayout(progress: TournamentProgress, quality: BracketExportQuality): BracketExportLayout {
  const { width, height } = computeBracketCanvasSize(progress, quality);
  const headerHeight = quality === "original" ? 230 : 190;
  const footerHeight = quality === "original" ? 120 : 90;
  const roundCount = Math.max(progress.rounds.length, 1);
  const firstRoundMatchesPerSide = Math.max((progress.rounds[0]?.matches.length ?? 1) / 2, 1);
  const availableWorldWidth = width - (quality === "original" ? 300 : 220);
  const availableWorldHeight = height - headerHeight - footerHeight - 80;
  const cardWidth = quality === "original" ? Math.min(300, availableWorldWidth / Math.max(roundCount * 2 - 1, 2) * 0.84) : Math.min(226, availableWorldWidth / Math.max(roundCount * 2 - 1, 2) * 0.82);
  const preferredCardHeight = quality === "original" ? 76 : 58;
  const rowPitch = Math.max(4, Math.min(quality === "original" ? 108 : 76, availableWorldHeight / firstRoundMatchesPerSide));
  const cardHeight = Math.max(3, Math.min(preferredCardHeight, rowPitch * 0.74));
  const columnGap = roundCount === 1
    ? 0
    : Math.max(cardWidth + 8, (availableWorldWidth - cardWidth) / ((roundCount - 1) * 2));
  const world = createBracketWorld(progress.bracketSize, { columnGap, rowPitch });
  return {
    width,
    height,
    headerHeight,
    footerHeight,
    centerX: width / 2,
    centerY: headerHeight + availableWorldHeight / 2 + 20,
    cardWidth,
    cardHeight,
    world,
  };
}

function drawBroadcastBackground(
  context: CanvasRenderingContext2D,
  layout: BracketExportLayout,
  tournamentId: string,
) {
  const { width, height } = layout;
  context.fillStyle = COLORS.background;
  context.fillRect(0, 0, width, height);

  const ambient = context.createRadialGradient(width / 2, height * 0.54, 0, width / 2, height * 0.54, Math.max(width, height) * 0.56);
  ambient.addColorStop(0, "rgba(141,27,22,.3)");
  ambient.addColorStop(0.25, "rgba(66,20,19,.16)");
  ambient.addColorStop(1, "rgba(7,9,12,0)");
  context.fillStyle = ambient;
  context.fillRect(0, 0, width, height);

  const gridSize = Math.max(28, Math.round(width / 72));
  context.save();
  context.strokeStyle = "rgba(255,255,255,.028)";
  context.lineWidth = 1;
  for (let x = gridSize; x < width; x += gridSize) {
    context.beginPath();
    context.moveTo(x, layout.headerHeight);
    context.lineTo(x, height - layout.footerHeight);
    context.stroke();
  }
  for (let y = layout.headerHeight; y < height - layout.footerHeight; y += gridSize) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.restore();

  drawSpotlight(context, width * 0.18, layout.headerHeight - 12, width * 0.28, height * 0.76, -0.12);
  drawSpotlight(context, width * 0.82, layout.headerHeight - 12, width * 0.28, height * 0.76, 0.12);
  drawParticles(context, layout, tournamentId);
}

function drawSpotlight(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  tilt: number,
) {
  context.save();
  context.translate(x, y);
  context.rotate(tilt);
  const light = context.createLinearGradient(0, 0, 0, height);
  light.addColorStop(0, "rgba(245,196,107,.11)");
  light.addColorStop(0.5, "rgba(255,255,255,.025)");
  light.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = light;
  context.beginPath();
  context.moveTo(-width * 0.05, 0);
  context.lineTo(width / 2, height);
  context.lineTo(-width / 2, height);
  context.closePath();
  context.fill();
  context.restore();
}

function drawParticles(context: CanvasRenderingContext2D, layout: BracketExportLayout, seed: string) {
  let state = hashSeed(seed);
  const count = Math.min(90, Math.max(28, Math.round(layout.width / 60)));
  context.save();
  for (let index = 0; index < count; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const x = (state / 0xffffffff) * layout.width;
    state = (state * 1664525 + 1013904223) >>> 0;
    const y = layout.headerHeight + (state / 0xffffffff) * (layout.height - layout.headerHeight - layout.footerHeight);
    const radius = 0.7 + index % 3 * 0.5;
    context.fillStyle = index % 5 === 0 ? "rgba(245,196,107,.62)" : "rgba(255,98,94,.34)";
    context.shadowColor = context.fillStyle;
    context.shadowBlur = radius * 5;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawHeader(
  context: CanvasRenderingContext2D,
  layout: BracketExportLayout,
  tournament: CloudTournament,
  quality: BracketExportQuality,
) {
  const padding = layout.width >= 2400 ? 84 : 58;
  const titleSize = layout.width >= 2400 ? 48 : 38;
  const headerGradient = context.createLinearGradient(0, 0, 0, layout.headerHeight);
  headerGradient.addColorStop(0, "rgba(7,9,12,.99)");
  headerGradient.addColorStop(1, "rgba(9,12,16,.88)");
  context.fillStyle = headerGradient;
  context.fillRect(0, 0, layout.width, layout.headerHeight);
  context.strokeStyle = "rgba(255,255,255,.1)";
  context.beginPath();
  context.moveTo(0, layout.headerHeight - 1);
  context.lineTo(layout.width, layout.headerHeight - 1);
  context.stroke();

  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = COLORS.redBright;
  context.font = `900 ${Math.round(titleSize * 0.36)}px system-ui, sans-serif`;
  context.fillText("SONG WORLD CUP · 完整赛事画布", padding, Math.round(layout.headerHeight * 0.3));
  context.fillStyle = COLORS.text;
  context.font = `900 ${titleSize}px system-ui, sans-serif`;
  context.fillText(fitText(context, tournament.name, layout.width * 0.62), padding, Math.round(layout.headerHeight * 0.62));
  context.fillStyle = COLORS.muted;
  context.font = `500 ${Math.round(titleSize * 0.4)}px system-ui, sans-serif`;
  context.fillText(`${tournament.progress.bracketSize} 强 · ${quality === "original" ? "桌面原始超清版" : "通用高清版"} · 已完赛公开只读`, padding, Math.round(layout.headerHeight * 0.82));
}

function drawWorldDecorations(context: CanvasRenderingContext2D, layout: BracketExportLayout) {
  const radius = Math.min(layout.width, layout.height) * 0.13;
  const finalGlow = context.createRadialGradient(layout.centerX, layout.centerY, 0, layout.centerX, layout.centerY, radius);
  finalGlow.addColorStop(0, "rgba(245,196,107,.18)");
  finalGlow.addColorStop(0.38, "rgba(229,57,53,.12)");
  finalGlow.addColorStop(1, "rgba(7,9,12,0)");
  context.fillStyle = finalGlow;
  context.fillRect(layout.centerX - radius, layout.centerY - radius, radius * 2, radius * 2);

  context.save();
  context.translate(layout.centerX, layout.centerY);
  context.strokeStyle = "rgba(245,196,107,.16)";
  context.lineWidth = Math.max(1, layout.cardHeight * 0.035);
  for (const scale of [1, 1.38, 1.82]) {
    context.beginPath();
    context.arc(0, 0, radius * 0.34 * scale, -Math.PI * 0.78, Math.PI * 0.78);
    context.stroke();
  }
  context.restore();
}

function drawConnectors(
  context: CanvasRenderingContext2D,
  layout: BracketExportLayout,
  matchById: Map<string, TournamentMatch>,
) {
  for (const node of layout.world.nodes) {
    if (!node.parentId) continue;
    const parent = layout.world.nodeById.get(node.parentId);
    if (!parent) continue;
    const from = exportNodePoint(node, layout);
    const to = exportNodePoint(parent, layout);
    const geometry = createBracketConnectorGeometry(from, to, layout.cardWidth, layout.cardWidth, 0);
    const match = matchById.get(node.id);
    const active = Boolean(match?.winnerId);
    drawConnectorPath(context, geometry, active, layout.cardHeight);
  }
}

function drawConnectorPath(
  context: CanvasRenderingContext2D,
  geometry: ReturnType<typeof createBracketConnectorGeometry>,
  active: boolean,
  cardHeight: number,
) {
  context.save();
  context.translate(geometry.left, geometry.top);
  const trace = () => {
    context.beginPath();
    context.moveTo(geometry.x1, geometry.y1);
    context.lineTo(geometry.middleX, geometry.y1);
    context.lineTo(geometry.middleX, geometry.y2);
    context.lineTo(geometry.x2, geometry.y2);
  };
  context.lineJoin = "round";
  context.lineCap = "round";
  context.strokeStyle = "rgba(151,162,174,.22)";
  context.lineWidth = Math.max(1, cardHeight * 0.035);
  trace();
  context.stroke();
  if (active) {
    context.strokeStyle = "rgba(229,57,53,.78)";
    context.shadowColor = "rgba(239,74,69,.8)";
    context.shadowBlur = Math.max(3, cardHeight * 0.12);
    context.setLineDash([Math.max(4, cardHeight * 0.14), Math.max(3, cardHeight * 0.09)]);
    context.lineWidth = Math.max(1.2, cardHeight * 0.045);
    trace();
    context.stroke();
  }
  context.restore();
}

function drawMatchNodes(
  context: CanvasRenderingContext2D,
  layout: BracketExportLayout,
  matchById: Map<string, TournamentMatch>,
  songById: Map<string, SnapshotSong>,
) {
  for (const node of layout.world.nodes) {
    const match = matchById.get(node.id);
    if (!match) continue;
    const point = exportNodePoint(node, layout);
    drawMatchNode(context, point.x, point.y, layout.cardWidth, layout.cardHeight, match, songById, node.side === "final");
  }
}

function drawMatchNode(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  match: TournamentMatch,
  songById: Map<string, SnapshotSong>,
  final: boolean,
) {
  const x = centerX - width / 2;
  const y = centerY - height / 2;
  const radius = Math.max(1.5, Math.min(12, height * 0.15));
  context.save();
  context.shadowColor = final ? "rgba(245,196,107,.34)" : "rgba(0,0,0,.55)";
  context.shadowBlur = Math.max(2, height * (final ? 0.34 : 0.18));
  context.fillStyle = final ? "rgba(40,31,18,.97)" : "rgba(15,19,24,.98)";
  roundedRect(context, x, y, width, height, radius);
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = final ? "rgba(245,196,107,.78)" : "rgba(255,255,255,.16)";
  context.lineWidth = Math.max(1, height * 0.018);
  context.stroke();

  const headerHeight = height >= 34 ? Math.max(3, height * 0.16) : 0;
  if (headerHeight > 0) {
    context.fillStyle = final ? "rgba(245,196,107,.12)" : "rgba(255,255,255,.03)";
    roundedRect(context, x, y, width, headerHeight + radius, radius);
    context.fill();
    context.fillStyle = final ? COLORS.gold : "#77818d";
    context.font = `800 ${Math.max(5, headerHeight * 0.54)}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(final ? "总决赛" : `MATCH ${match.index + 1}`, centerX, y + headerHeight * 0.55);
  }

  const slotsTop = y + headerHeight;
  const slotHeight = (height - headerHeight) / 2;
  drawEntrantSlot(context, x, slotsTop, width, slotHeight, match.entrantAId, match.winnerId, songById);
  drawEntrantSlot(context, x, slotsTop + slotHeight, width, slotHeight, match.entrantBId, match.winnerId, songById);
  context.strokeStyle = "rgba(255,255,255,.08)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x, slotsTop + slotHeight);
  context.lineTo(x + width, slotsTop + slotHeight);
  context.stroke();
  context.restore();
}

function drawEntrantSlot(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  entrantId: string | null,
  winnerId: string | null,
  songById: Map<string, SnapshotSong>,
) {
  const winner = Boolean(entrantId && entrantId === winnerId);
  const song = entrantId ? songById.get(entrantId) : undefined;
  if (winner) {
    const selected = context.createLinearGradient(x, y, x + width, y);
    selected.addColorStop(0, "rgba(145,29,25,.8)");
    selected.addColorStop(1, "rgba(78,15,15,.35)");
    context.fillStyle = selected;
    context.fillRect(x, y, width, height);
    context.fillStyle = COLORS.redBright;
    context.fillRect(x, y, Math.max(1, height * 0.07), height);
  }
  if (height < 8) return;
  const inset = Math.max(3, height * 0.25);
  const titleSize = Math.max(6, Math.min(16, height * (height > 30 ? 0.32 : 0.48)));
  context.textAlign = "left";
  context.textBaseline = height > 30 ? "alphabetic" : "middle";
  context.fillStyle = winner ? COLORS.text : "#d5dae0";
  context.font = `${winner ? 800 : 650} ${titleSize}px system-ui, sans-serif`;
  const titleY = height > 30 ? y + height * 0.48 : y + height / 2;
  context.fillText(fitText(context, song?.title ?? (entrantId ? "未知歌曲" : "轮空"), width - inset * 2), x + inset, titleY);
  if (height > 30) {
    context.fillStyle = winner ? COLORS.gold : "#77818d";
    context.font = `500 ${Math.max(6, titleSize * 0.62)}px system-ui, sans-serif`;
    context.fillText(fitText(context, song?.artists.join(" / ") ?? "BYE", width - inset * 2), x + inset, y + height * 0.78);
  }
}

function drawChampionStage(
  context: CanvasRenderingContext2D,
  layout: BracketExportLayout,
  tournament: CloudTournament,
  songById: Map<string, SnapshotSong>,
) {
  const champion = tournament.progress.championId ? songById.get(tournament.progress.championId) : undefined;
  const stageWidth = Math.min(layout.cardWidth * 1.3, layout.width * 0.18);
  const stageHeight = Math.max(34, Math.min(92, layout.cardHeight * 1.15));
  const x = layout.centerX - stageWidth / 2;
  const y = Math.min(layout.height - layout.footerHeight - stageHeight - 12, layout.centerY + layout.cardHeight / 2 + Math.max(22, layout.cardHeight * 0.45));
  context.save();
  context.shadowColor = "rgba(245,196,107,.45)";
  context.shadowBlur = stageHeight * 0.38;
  const goldPanel = context.createLinearGradient(x, y, x + stageWidth, y + stageHeight);
  goldPanel.addColorStop(0, "rgba(90,63,18,.72)");
  goldPanel.addColorStop(1, "rgba(19,17,14,.96)");
  context.fillStyle = goldPanel;
  roundedRect(context, x, y, stageWidth, stageHeight, Math.min(14, stageHeight * 0.18));
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = "rgba(245,196,107,.78)";
  context.stroke();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = COLORS.gold;
  context.font = `900 ${Math.max(7, stageHeight * 0.18)}px system-ui, sans-serif`;
  context.fillText("冠军 · CHAMPION", layout.centerX, y + stageHeight * 0.28);
  context.fillStyle = COLORS.text;
  context.font = `900 ${Math.max(9, stageHeight * 0.25)}px system-ui, sans-serif`;
  context.fillText(fitText(context, champion?.title ?? "冠军歌曲", stageWidth * 0.84), layout.centerX, y + stageHeight * 0.58);
  if (stageHeight >= 56) {
    context.fillStyle = COLORS.muted;
    context.font = `500 ${Math.max(7, stageHeight * 0.13)}px system-ui, sans-serif`;
    context.fillText(fitText(context, champion?.artists.join(" / ") ?? "", stageWidth * 0.84), layout.centerX, y + stageHeight * 0.8);
  }
  context.restore();
}

async function drawShareQrCode(
  context: CanvasRenderingContext2D,
  layout: BracketExportLayout,
  publicShareUrl: string,
) {
  const qrSize = Math.round(Math.min(layout.headerHeight * 0.66, layout.width * 0.075));
  const qrCanvas = document.createElement("canvas");
  await renderQrCode(qrCanvas, publicShareUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: qrSize,
    color: { dark: "#090b0eff", light: "#ffffffff" },
  });
  const right = layout.width >= 2400 ? 84 : 58;
  const x = layout.width - right - qrSize;
  const y = Math.round((layout.headerHeight - qrSize) / 2);
  context.save();
  context.fillStyle = "#fff";
  roundedRect(context, x - 8, y - 8, qrSize + 16, qrSize + 16, 10);
  context.fill();
  context.drawImage(qrCanvas, x, y, qrSize, qrSize);
  context.fillStyle = COLORS.gold;
  context.font = `800 ${Math.max(10, Math.round(qrSize * 0.1))}px system-ui, sans-serif`;
  context.textAlign = "right";
  context.textBaseline = "middle";
  context.fillText("扫码查看公开赛果", x - 22, y + qrSize * 0.42);
  context.fillStyle = COLORS.muted;
  context.font = `500 ${Math.max(8, Math.round(qrSize * 0.075))}px system-ui, sans-serif`;
  context.fillText("只读页面 · 无试听与跳转按钮", x - 22, y + qrSize * 0.62);
  context.restore();
}

function drawFooter(context: CanvasRenderingContext2D, layout: BracketExportLayout) {
  const y = layout.height - layout.footerHeight;
  const footer = context.createLinearGradient(0, y, 0, layout.height);
  footer.addColorStop(0, "rgba(7,9,12,.72)");
  footer.addColorStop(1, "rgba(7,9,12,.98)");
  context.fillStyle = footer;
  context.fillRect(0, y, layout.width, layout.footerHeight);
  context.strokeStyle = "rgba(255,255,255,.08)";
  context.beginPath();
  context.moveTo(0, y);
  context.lineTo(layout.width, y);
  context.stroke();
  context.fillStyle = "rgba(170,180,192,.55)";
  context.font = `800 ${Math.max(10, Math.round(layout.footerHeight * 0.2))}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("SONG WORLD CUP · 固定签表 · 红色流光表示胜者晋级路径", layout.centerX, y + layout.footerHeight / 2);
}

function exportNodePoint(node: BracketWorldNode, layout: BracketExportLayout): { x: number; y: number } {
  return { x: layout.centerX + node.x, y: layout.centerY + node.y };
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, Math.max(0, Math.min(radius, width / 2, height / 2)));
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

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 60) || "歌曲世界杯";
}
