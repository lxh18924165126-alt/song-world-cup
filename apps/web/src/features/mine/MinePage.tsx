import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Clock3, Link2, LogOut, Play, Trophy, UserRound } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import type { CloudTournament } from "@song-world-cup/domain";
import { appRelativePath } from "../../app/paths";
import { AppHeader } from "../../components/AppHeader";
import { listCachedTournaments } from "../tournament/repository";
import { getAccountTournaments, logout, mockLogin } from "../auth/api";
import { getStoredSession, type StoredAuthSession } from "../auth/session";

interface MineRecord {
  tournament: CloudTournament;
  token: string | null;
  accountOwned: boolean;
}

export function MinePage() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<MineRecord[]>([]);
  const [session, setSession] = useState<StoredAuthSession | null>(() => getStoredSession());
  const [displayName, setDisplayName] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [recoveryLink, setRecoveryLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [local, accountPayload] = await Promise.all([
          listCachedTournaments(),
          session ? getAccountTournaments() : Promise.resolve(null),
        ]);
        const merged = new Map<string, MineRecord>(local.map((record) => [record.id, {
          tournament: record.tournament,
          token: record.token,
          accountOwned: false,
        }]));
        for (const item of accountPayload?.tournaments ?? []) {
          const existing = merged.get(item.tournament.id);
          merged.set(item.tournament.id, {
            tournament: item.tournament,
            token: existing?.token ?? null,
            accountOwned: true,
          });
        }
        setRecords([...merged.values()].sort((left, right) => right.tournament.updatedAt.localeCompare(left.tournament.updatedAt)));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "读取本地赛事失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

  const groups = useMemo(() => ({
    inProgress: records.filter((record) => record.tournament.progress.status === "in_progress"),
    finished: records.filter((record) => record.tournament.progress.status === "finished"),
  }), [records]);

  function recover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const url = new URL(recoveryLink, window.location.origin);
      const routePath = appRelativePath(url.pathname);
      if (url.origin !== window.location.origin || !routePath || !/^\/t\/[^/]+\/(play|result)$/.test(routePath)) {
        throw new Error("请输入本站赛事恢复链接");
      }
      navigate(`${routePath}${url.hash}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "恢复链接无效");
    }
  }

  async function login(provider: "wechat" | "qq") {
    if (!displayName.trim() || accountBusy) return;
    setAccountBusy(true);
    setError(null);
    try {
      const nextSession = await mockLogin(provider, displayName);
      setSession(nextSession);
      navigate("/mine/migrate");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setAccountBusy(false);
    }
  }

  async function signOut() {
    setAccountBusy(true);
    await logout();
    setSession(null);
    setAccountBusy(false);
  }

  return (
    <div className="app-shell">
      <AppHeader title="我的赛事" />
      <main className="content-column mine-content">
        <header className="mine-hero"><Trophy aria-hidden="true" /><div><h1>我的赛事</h1><p>管理与继续此设备保存的赛事</p></div></header>
        <section className="surface account-panel">
          {session ? (
            <><div><UserRound aria-hidden="true" /><span><strong>{session.account.displayName}</strong><small>{session.account.provider === "wechat" ? "微信" : "QQ"} 模拟 Provider · 已登录</small></span></div><Link to="/mine/migrate">迁移本地赛事</Link><button type="button" disabled={accountBusy} onClick={() => void signOut()}><LogOut aria-hidden="true" />退出</button></>
          ) : (
            <><div><UserRound aria-hidden="true" /><span><strong>登录后跨设备管理</strong><small>当前使用模拟 Provider；正式凭证待平台联调</small></span></div><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} placeholder="输入演示昵称" /><button type="button" disabled={accountBusy || !displayName.trim()} onClick={() => void login("wechat")}>微信登录</button><button type="button" disabled={accountBusy || !displayName.trim()} onClick={() => void login("qq")}>QQ 登录</button></>
          )}
        </section>
        <form className="surface recovery-form" onSubmit={recover}>
          <Link2 aria-hidden="true" />
          <label className="sr-only" htmlFor="recovery-link">赛事恢复链接</label>
          <input id="recovery-link" value={recoveryLink} onChange={(event) => setRecoveryLink(event.target.value)} placeholder="粘贴恢复链接找回赛事" />
          <button type="submit" disabled={!recoveryLink.trim()}>恢复</button>
        </form>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {loading ? <div className="center-inline">正在读取本地赛事…</div> : null}
        {!loading && records.length === 0 ? <section className="surface mine-empty"><h2>此设备还没有赛事</h2><p>导入公开歌单并正式开赛后，赛事会自动出现在这里。</p><Link to="/">创建第一场赛事</Link></section> : null}
        <TournamentGroup title="进行中" records={groups.inProgress} />
        <TournamentGroup title="已完成" records={groups.finished} />
        <p className="mine-note">赛事恢复令牌仅保存在本设备；更换设备时请使用恢复链接，或登录后迁移到账号。</p>
      </main>
    </div>
  );
}

function TournamentGroup({ title, records }: { title: string; records: MineRecord[] }) {
  if (records.length === 0) return null;
  return (
    <section className="mine-group">
      <div className="mine-group-heading"><span /> <h2>{title}</h2><small>{records.length}</small></div>
      <div className="mine-list">{records.map((record) => <TournamentListItem key={record.tournament.id} record={record} />)}</div>
    </section>
  );
}

function TournamentListItem({ record }: { record: MineRecord }) {
  const { tournament } = record;
  const finished = tournament.progress.status === "finished";
  const round = tournament.progress.rounds[tournament.progress.currentRoundIndex];
  const tokenHash = record.token ? `#token=${encodeURIComponent(record.token)}` : "";
  const path = `/t/${tournament.id}/${finished ? "result" : "play"}${tokenHash}`;
  return (
    <article className="surface mine-item">
      <div className="mine-item-mark">{finished ? <Trophy aria-hidden="true" /> : <Play aria-hidden="true" />}</div>
      <div className="mine-item-copy"><h3>{tournament.name}</h3><p>{tournament.progress.bracketSize} 强 · {finished ? "冠军已产生" : `第 ${(round?.index ?? 0) + 1} 轮`}{record.accountOwned ? " · 已绑定账号" : ""}</p><small><Clock3 aria-hidden="true" />最后更新：{formatDate(tournament.updatedAt)}</small></div>
      <Link to={path}>{finished ? "查看结果" : "继续比赛"}</Link>
    </article>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
