import { useState, type FormEvent } from "react";
import { Music2, Trophy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { parsePlaylistReference } from "@song-world-cup/domain";
import { AppHeader } from "../../components/AppHeader";
import { resolvePlaylist } from "./api";
import { createImportDraft } from "./repository";

export function HomePage() {
  const navigate = useNavigate();
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      parsePlaylistReference(playlistUrl);
      setIsLoading(true);
      const snapshot = await resolvePlaylist(playlistUrl);
      await createImportDraft(snapshot);
      navigate("/import/check");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "歌单解析失败，请稍后重试");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <AppHeader />
      <main>
        <section className="stadium-hero">
          <div className="stadium-lights stadium-lights-left" />
          <div className="stadium-lights stadium-lights-right" />
          <div className="hero-copy">
            <Trophy className="hero-trophy" aria-hidden="true" />
            <h1>把你的歌单，踢进冠军之夜</h1>
            <p><span>随机抽签</span> · <span>逐场对决</span> · <span>选出冠军歌曲</span></p>
          </div>
        </section>

        <div className="content-column home-content">
          <section className="surface import-panel" aria-labelledby="import-title">
            <div className="section-heading">
              <span className="step-number">1</span>
              <div>
                <h2 id="import-title">粘贴音乐歌单链接</h2>
                <p>支持 QQ 音乐与网易云音乐的公开歌单</p>
              </div>
            </div>
            <form onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="playlist-url">QQ 音乐或网易云音乐公开歌单链接</label>
              <div className="input-wrap">
                <input
                  id="playlist-url"
                  value={playlistUrl}
                  onChange={(event) => setPlaylistUrl(event.target.value)}
                  placeholder="QQ 音乐或网易云音乐公开歌单链接"
                  inputMode="url"
                  autoComplete="url"
                  aria-invalid={error ? "true" : "false"}
                />
                {playlistUrl ? (
                  <button className="clear-button" type="button" onClick={() => setPlaylistUrl("")}>清空</button>
                ) : null}
              </div>
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <button className="primary-button" type="submit" disabled={isLoading || !playlistUrl.trim()}>
                <Music2 aria-hidden="true" />
                {isLoading ? "正在解析并保存快照…" : "解析歌单"}
              </button>
            </form>
          </section>

          <p className="privacy-note">导入成功会立即创建不可变歌单快照，不会修改音乐平台中的原歌单。</p>
        </div>
      </main>
    </div>
  );
}
