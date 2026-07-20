import { useEffect, useMemo, useState } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import type { CachedTournamentRecord } from "../../storage/database";
import { claimTournaments, getAccountTournaments } from "../auth/api";
import { getStoredSession } from "../auth/session";
import { listCachedTournaments, pendingTournamentEventCount } from "../tournament/repository";

interface Candidate {
  record: CachedTournamentRecord;
  pendingCount: number;
}

export function MigrationPage() {
  const navigate = useNavigate();
  const session = getStoredSession();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    void (async () => {
      try {
        const [local, account] = await Promise.all([listCachedTournaments(), getAccountTournaments()]);
        const ownedIds = new Set(account.tournaments.map((item) => item.tournament.id));
        const anonymous = local.filter((record) => !ownedIds.has(record.id));
        const pendingCounts = await Promise.all(anonymous.map((record) => pendingTournamentEventCount(record.id)));
        const next = anonymous.map((record, index) => ({ record, pendingCount: pendingCounts[index] ?? 0 }));
        setCandidates(next);
        setSelected(new Set(next.filter((candidate) => candidate.pendingCount === 0).map((candidate) => candidate.record.id)));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "读取可迁移赛事失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [session?.account.id]);

  const selectedCandidates = useMemo(() => candidates.filter((candidate) => selected.has(candidate.record.id)), [candidates, selected]);

  if (!session) return <Navigate replace to="/mine" />;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function claim() {
    if (selectedCandidates.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await claimTournaments(selectedCandidates.map(({ record }) => ({ id: record.id, token: record.token })));
      navigate("/mine", { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "迁移失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="migration-page">
      <header><div><small>MIGRATION</small><h1>选择要绑定的匿名赛事</h1><p>只有此设备确实持有恢复权限、且没有待同步操作的赛事才能认领。</p></div><span><ShieldCheck aria-hidden="true" />{session.account.displayName}</span></header>
      <main>
        {loading ? <div className="center-inline">正在核验本地恢复权限…</div> : null}
        {!loading && candidates.length === 0 ? <section className="migration-empty"><h2>没有待迁移赛事</h2><p>此设备的赛事都已绑定，或尚未正式开赛。</p></section> : null}
        <section className="migration-list">{candidates.map(({ record, pendingCount }) => {
          const disabled = pendingCount > 0;
          const checked = selected.has(record.id);
          return <button className={checked ? "migration-item checked" : "migration-item"} type="button" disabled={disabled} onClick={() => toggle(record.id)} key={record.id}><span className="migration-check">{checked ? <Check aria-hidden="true" /> : null}</span><span><strong>{record.tournament.name}</strong><small>{record.tournament.progress.status === "finished" ? "已完成" : "进行中"} · {record.tournament.progress.bracketSize} 强{disabled ? ` · ${pendingCount} 项待同步，暂不可迁移` : ""}</small></span></button>;
        })}</section>
        <section className="migration-summary"><h2>迁移摘要</h2><p><span>已选赛事</span><strong>{selectedCandidates.length} 届</strong></p><p><span>迁移后的结果</span><strong>绑定至当前账号</strong></p><p><span>匿名恢复链接</span><strong>将立即失效</strong></p></section>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </main>
      <footer><button type="button" onClick={() => navigate("/mine")}>稍后再说</button><button type="button" disabled={busy || selectedCandidates.length === 0} onClick={() => void claim()}>{busy ? "正在迁移…" : "确认迁移"}</button></footer>
    </div>
  );
}
