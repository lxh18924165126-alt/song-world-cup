import { useState, type FormEvent } from "react";
import { Activity, Database, Radio, ShieldCheck, Users } from "lucide-react";
import { getAdminOverview, updateFeatureFlag, type AdminOverview } from "./api";

const FLAG_LABELS: Record<string, string> = {
  qq_import: "QQ 音乐导入",
  netease_import: "网易云音乐导入",
  browser_import_fallback: "浏览器备用解析",
  post_match_share: "赛后分享",
  wechat_login: "微信登录",
  qq_login: "QQ 登录",
};

export function AdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem("song-world-cup-admin-token") ?? "");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusyKey("connect");
    setError(null);
    try {
      const payload = await getAdminOverview(token);
      sessionStorage.setItem("song-world-cup-admin-token", token);
      setOverview(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "管理员认证失败");
    } finally {
      setBusyKey(null);
    }
  }

  async function toggle(key: string, enabled: boolean) {
    setBusyKey(key);
    setError(null);
    try {
      const updated = await updateFeatureFlag(token, key, enabled);
      setOverview((current) => current ? {
        ...current,
        flags: current.flags.map((flag) => flag.key === key ? updated : flag),
      } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新功能开关失败");
    } finally {
      setBusyKey(null);
    }
  }

  if (!overview) {
    return <main className="admin-login"><form onSubmit={connect}><ShieldCheck aria-hidden="true" /><h1>运营后台</h1><p>输入管理员令牌以读取真实运行数据。</p><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="X-Admin-Token" /><button disabled={!token || busyKey !== null}>{busyKey ? "正在连接…" : "进入后台"}</button>{error ? <p className="form-error" role="alert">{error}</p> : null}{import.meta.env.DEV ? <small>本地演示令牌：local-admin-token</small> : null}</form></main>;
  }

  const metrics = overview.metrics;
  return (
    <main className="admin-shell">
      <header><h1>歌曲世界杯 · 运营后台</h1><span>免费套餐模式</span><small>管理员</small></header>
      <section className="admin-metrics">
        <Metric icon={<Database />} label="今日歌单解析" value={metrics.snapshotsToday} note="最近 24 小时" />
        <Metric icon={<Activity />} label="进行中赛事" value={metrics.inProgress} note={`已完成 ${metrics.finished}`} />
        <Metric icon={<Radio />} label="开放分享" value={metrics.openShares} note={`账号 ${metrics.accounts}`} />
      </section>
      <section className="admin-columns">
        <article><h2>功能开关</h2>{overview.flags.map((flag) => <label className="admin-flag" key={flag.key}><span>{FLAG_LABELS[flag.key] ?? flag.key}</span><input type="checkbox" checked={flag.enabled} disabled={busyKey !== null} onChange={(event) => void toggle(flag.key, event.target.checked)} /></label>)}</article>
        <article><h2>限额与风控</h2><p><span>匿名解析次数 / 日</span><strong>{overview.limits.anonymousImportsPerDay}</strong></p><p><span>登录用户解析次数 / 日</span><strong>{overview.limits.accountImportsPerDay}</strong></p><p><span>编辑权保护期</span><strong>{overview.limits.editLeaseProtectionSeconds / 60} min</strong></p></article>
      </section>
      <section className="admin-audit"><h2>最近审计日志</h2>{overview.auditLogs.length === 0 ? <p>尚无后台变更</p> : <table><thead><tr><th>时间</th><th>操作</th><th>结果</th></tr></thead><tbody>{overview.auditLogs.map((log) => <tr key={log.id}><td>{new Date(log.createdAt).toLocaleString("zh-CN")}</td><td>{log.action}</td><td>成功</td></tr>)}</tbody></table>}</section>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </main>
  );
}

function Metric({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: number; note: string }) {
  return <article>{icon}<span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}
