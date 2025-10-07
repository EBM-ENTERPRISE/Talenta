import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/utils";

const AuthCallback = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const handleCallback = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const next = url.searchParams.get("next") || "/";
      console.log('[AuthCallback] start', { codePresent: !!code, next });

      // PKCE: trocar 'code' por sessão
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          console.log('[AuthCallback] exchange success, redirect', { next });
          // limpar parâmetros sensíveis da URL
          window.history.replaceState(null, '', url.origin + url.pathname + (next ? `?next=${encodeURIComponent(next)}` : ''));
          navigate(next, { replace: true });
          return;
        } else {
          console.error('[AuthCallback] exchange error', error);
        }
      }

      // Fallback para fluxo implícito: tokens no hash
      if (url.hash) {
        const params = new URLSearchParams(url.hash.replace('#', ''));
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        const type = params.get('type');
        console.log('[AuthCallback] implicit hash detected', { type, hasAccessToken: !!access_token, hasRefreshToken: !!refresh_token });
        if (access_token && refresh_token) {
          const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (!error && data.session) {
            console.log('[AuthCallback] setSession success, redirect', { next });
            // limpar o hash da URL
            window.history.replaceState(null, '', url.origin + url.pathname + (next ? `?next=${encodeURIComponent(next)}` : ''));
            navigate(next, { replace: true });
            return;
          } else {
            console.error('[AuthCallback] setSession error', error);
          }
        }
      }

      // Em caso de erro ou ausência de dados, volta para a página de auth
      console.warn('[AuthCallback] missing code/hash or error, redirect to /auth');
      navigate("/auth", { replace: true });
    };

    handleCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-foreground/70">Processando autenticação...</p>
    </div>
  );
};

export default AuthCallback;