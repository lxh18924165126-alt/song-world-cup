import { useState } from "react";
import { CircleHelp, Home, ListChecks, MoreHorizontal, Trophy, X } from "lucide-react";
import { Link } from "react-router-dom";

export function AppHeader({ title }: { title?: string }) {
  const [openPanel, setOpenPanel] = useState<"rules" | "more" | null>(null);

  return (
    <header className="app-header">
      <Link className="brand" to="/" aria-label="返回歌曲世界杯首页">
        <span className="brand-mark"><Trophy aria-hidden="true" /></span>
        <span>歌曲世界杯</span>
      </Link>
      {title ? <strong className="page-title">{title}</strong> : null}
      <nav className="header-actions" aria-label="辅助导航">
        <button
          className="icon-action"
          type="button"
          aria-label="查看规则"
          aria-expanded={openPanel === "rules"}
          onClick={() => setOpenPanel((panel) => panel === "rules" ? null : "rules")}
        >
          <CircleHelp aria-hidden="true" />
          <span>规则</span>
        </button>
        <button
          className="icon-action"
          type="button"
          aria-label="更多操作"
          aria-expanded={openPanel === "more"}
          onClick={() => setOpenPanel((panel) => panel === "more" ? null : "more")}
        >
          <MoreHorizontal aria-hidden="true" />
          <span>更多</span>
        </button>
      </nav>
      {openPanel ? (
        <section className="header-popover" role="dialog" aria-label={openPanel === "rules" ? "核心规则" : "快捷入口"}>
          <div className="popover-heading">
            <strong>{openPanel === "rules" ? "核心规则" : "快捷入口"}</strong>
            <button type="button" aria-label="关闭" onClick={() => setOpenPanel(null)}><X aria-hidden="true" /></button>
          </div>
          {openPanel === "rules" ? (
            <ul>
              <li>仅导入无需登录即可查看的 QQ 音乐或网易云音乐公开歌单。</li>
              <li>重复歌曲保留为独立参赛条目。</li>
              <li>正式开始后歌曲、签位与晋级路径全部锁定。</li>
              <li>完赛分享默认关闭，只能由创建者主动开放。</li>
            </ul>
          ) : (
            <div className="quick-links">
              <Link to="/" onClick={() => setOpenPanel(null)}><Home aria-hidden="true" />导入新歌单</Link>
              <Link to="/mine" onClick={() => setOpenPanel(null)}><Trophy aria-hidden="true" />我的赛事</Link>
              <Link to="/import/check" onClick={() => setOpenPanel(null)}><ListChecks aria-hidden="true" />继续检查歌曲</Link>
            </div>
          )}
        </section>
      ) : null}
    </header>
  );
}
