import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { completeOauthLogin } from "./api";

export function OAuthCallbackPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const provider = params.get("provider");
  const code = params.get("code") ?? "";
  const state = params.get("state") ?? "";

  useEffect(() => {
    if (provider !== "wechat" && provider !== "qq") {
      setError("登录 Provider 无效");
      return;
    }
    completeOauthLogin(provider, code, state)
      .then(() => navigate("/mine/migrate", { replace: true }))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "登录回调失败"));
  }, [navigate, provider, code, state]);

  return <div className="center-state">{error ?? "正在完成登录…"}</div>;
}
