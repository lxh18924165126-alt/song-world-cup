import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "../features/import/HomePage";
import { SongCheckPage } from "../features/import/SongCheckPage";
import { DrawPreviewPage } from "../features/draft/DrawPreviewPage";
import { SetupPage } from "../features/draft/SetupPage";
import { FinalStagePage, PlayPage } from "../features/tournament/PlayPage";
import { BracketPage } from "../features/tournament/BracketPage";
import { PublicSharePage } from "../features/results/PublicSharePage";
import { ResultPage } from "../features/results/ResultPage";
import { MinePage } from "../features/mine/MinePage";
import { MigrationPage } from "../features/mine/MigrationPage";
import { OAuthCallbackPage } from "../features/auth/OAuthCallbackPage";
import { AdminPage } from "../features/admin/AdminPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/import/check" element={<SongCheckPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/draw-preview/:id" element={<DrawPreviewPage />} />
      <Route path="/t/:id/play" element={<PlayPage />} />
      <Route path="/t/:id/bracket" element={<BracketPage />} />
      <Route path="/t/:id/final" element={<FinalStagePage />} />
      <Route path="/t/:id/result" element={<ResultPage />} />
      <Route path="/share/:token" element={<PublicSharePage />} />
      <Route path="/mine" element={<MinePage />} />
      <Route path="/mine/migrate" element={<MigrationPage />} />
      <Route path="/auth/callback" element={<OAuthCallbackPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
