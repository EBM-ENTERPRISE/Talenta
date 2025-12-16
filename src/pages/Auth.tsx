import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import TalentaLogo from "@/components/TalentaLogo";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/utils";

const Auth = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isLogin, setIsLogin] = useState(searchParams.get("mode") !== "register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resendCooldown, setResendCooldown] = useState<number>(0);
  const [forgotCooldown, setForgotCooldown] = useState<number>(0);
  const navigate = useNavigate();

  useEffect(() => {
    setIsLogin(searchParams.get("mode") !== "register");
  }, [searchParams]);

  useEffect(() => {
    let unsub: { subscription: { unsubscribe: () => void } } | null = null;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        navigate("/", { replace: true });
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        navigate("/", { replace: true });
      }
    });
    unsub = sub;
    return () => {
      unsub?.subscription.unsubscribe();
    };
  }, [navigate]);

  const mode = searchParams.get("mode") || (isLogin ? "login" : "register");

  // Utilitários de UX
  const isEmailValid = (val: string) => /\S+@\S+\.\S+/.test(val);
  const translateError = (message?: string) => {
    const msg = (message || "").toLowerCase();
    if (msg.includes("invalid login credentials")) return "Email ou senha inválidos. Dica: verifique se digitou corretamente e se o Caps Lock está desligado.";
    if (msg.includes("email not confirmed")) return "Seu email ainda não foi confirmado. Verifique a caixa de entrada e a pasta de SPAM. Você pode reenviar o email de confirmação.";
    if (msg.includes("user already registered")) return "Este email já está cadastrado. Caso tenha esquecido a senha, use a opção de recuperação.";
    if (msg.includes("password should be at least")) return "A senha deve ter pelo menos 6 caracteres. Use uma combinação de letras, números e símbolos.";
    if (msg.includes("rate limit") || msg.includes("too many")) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
    if (msg.includes("invalid email")) return "Email inválido. Dica: verifique o formato, por exemplo: nome@dominio.com.";
    if (msg.includes("user not found")) return "Conta não encontrada. Se não tiver cadastro, crie uma conta.";
    return "Ocorreu um erro. Tente novamente.";
  };

  // Medidor de força de senha (componente interno)
  const PasswordStrengthMeter = ({ password, showInfo = true }: { password: string, showInfo?: boolean }) => {
    const lower = /[a-z]/.test(password);
    const upper = /[A-Z]/.test(password);
    const number = /\d/.test(password);
    const symbol = /[^A-Za-z0-9]/.test(password);
    const commonWeak = /(123|password|qwerty|abc|111|000)/i.test(password);

    const lengthScore = password.length >= 12 ? 2 : password.length >= 8 ? 1 : 0;
    const varietyCount = [lower, upper, number, symbol].filter(Boolean).length;
    const varietyScore = varietyCount === 4 ? 2 : varietyCount >= 2 ? 1 : 0;
    let score = lengthScore + varietyScore - (commonWeak ? 1 : 0);
    if (password.length === 0) score = 0;
    if (score < 0) score = 0;
    if (score > 4) score = 4;

    const labels = ["Muito fraca", "Fraca", "Média", "Forte", "Excelente"];
    const colors = ["bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-green-500", "bg-emerald-600"];

    const percent = ((score + 1) / 5) * 100; // 0..100
    const color = colors[score];

    return (
      <div className="mt-2 space-y-2" aria-live="polite">
        <div className="h-2 w-full rounded-full bg-foreground/10 overflow-hidden">
          <div
            className={`h-2 transition-all duration-300 ${color}`}
            style={{ width: `${percent}%` }}
            aria-hidden="true"
          />
        </div>
        {showInfo && password && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-foreground/70">Força da senha: {labels[score]}</span>
            <div className="flex gap-1 items-center text-foreground/60">
              <span className={`w-1.5 h-1.5 rounded-full ${lower ? 'bg-foreground' : 'bg-foreground/20'}`} title="letras minúsculas" />
              <span className={`w-1.5 h-1.5 rounded-full ${upper ? 'bg-foreground' : 'bg-foreground/20'}`} title="letras maiúsculas" />
              <span className={`w-1.5 h-1.5 rounded-full ${number ? 'bg-foreground' : 'bg-foreground/20'}`} title="números" />
              <span className={`w-1.5 h-1.5 rounded-full ${symbol ? 'bg-foreground' : 'bg-foreground/20'}`} title="símbolos" />
            </div>
          </div>
        )}
        {showInfo && password && score < 3 && (
          <ul className="text-[11px] text-foreground/70 list-disc pl-4">
            <li>Use 8+ caracteres</li>
            <li>Combine maiúsculas, minúsculas, números e símbolos</li>
            <li>Evite sequências comuns (ex.: 123, qwerty)</li>
          </ul>
        )}
      </div>
    );
  };
 
   const MIN_PASSWORD_LENGTH = 8;
   const getPasswordStatus = (pw: string) => {
     return {
       hasLower: /[a-z]/.test(pw),
       hasUpper: /[A-Z]/.test(pw),
       hasNumber: /\d/.test(pw),
       hasSymbol: /[^A-Za-z0-9]/.test(pw),
       hasMinLength: pw.length >= MIN_PASSWORD_LENGTH,
       meets:
         /[a-z]/.test(pw) &&
         /[A-Z]/.test(pw) &&
         /\d/.test(pw) &&
         /[^A-Za-z0-9]/.test(pw) &&
         pw.length >= MIN_PASSWORD_LENGTH,
     } as const;
   };

   // Retorna apenas uma mensagem de erro por vez para feedback dinâmico no registro
   const getFirstPasswordError = (pw: string) => {
     const s = getPasswordStatus(pw);
     if (!pw) return "Tenha pelo menos 8 caracteres e um número";
     if (!s.hasMinLength) return `Tenha pelo menos ${MIN_PASSWORD_LENGTH} caracteres`;
     if (!s.hasNumber) return "Inclua pelo menos um número (0-9)";
     if (!s.hasUpper) return "Inclua pelo menos uma letra maiúscula (A-Z)";
     if (!s.hasLower) return "Inclua pelo menos uma letra minúscula (a-z)";
     if (!s.hasSymbol) return "Inclua pelo menos um símbolo (!@#$%^&*)";
     return "";
   };
 
   // Inicializa o cooldown de 60s ao entrar no modo de confirmação
   useEffect(() => {
     if (mode === "confirm-email") {
       setResendCooldown(60);
     }
   }, [mode]);

  // Decrementa o cooldown a cada segundo até chegar a 0
  useEffect(() => {
    if (mode !== "confirm-email" || resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [mode, resendCooldown]);

  // Decrementa cooldown do forgot-password
  useEffect(() => {
    if (mode !== "forgot-password" || forgotCooldown <= 0) return;
    const interval = setInterval(() => {
      setForgotCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [mode, forgotCooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    console.log('[Auth] submit', { isLogin, email, mode });
    try {
      if (isLogin) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) {
          console.error('[Auth] signIn error', signInError);
          throw signInError;
        }
        console.log('[Auth] signIn success', { email });
        navigate("/", { replace: true });
      } else {
        const status = getPasswordStatus(password);
        if (!status.meets) {
          setError(getFirstPasswordError(password) || "Ajuste a senha para continuar");
          setLoading(false);
          return;
        }
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name } },
        });
        if (signUpError) {
          console.error('[Auth] signUp error', signUpError);
          throw signUpError;
        }
        console.log('[Auth] signUp success', { email });
        // Após registrar com email e senha, instruir usuário a confirmar o email
        navigate(`/auth?mode=confirm-email&email=${encodeURIComponent(email)}`, { replace: true });
      }
    } catch (err: any) {
      console.error('[Auth] submit error', err);
      setError(translateError(err?.message));
    } finally {
      setLoading(false);
    }
  };

  const callbackUrl = `${window.location.origin}/auth/v1/callback`;
  const passwordResetRedirectUrl = `${window.location.origin}/auth?mode=update-password`;

  const handleGoogleLogin = async () => {
    setError(null);
    setMessage(null);
    setLoading(true);
    console.log('[Auth] Google OAuth start', { redirectTo: callbackUrl });
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl,
        queryParams: { prompt: "consent", access_type: "offline" },
        scopes: "openid email profile",
      },
    });
    if (oauthError) {
      console.error('[Auth] Google OAuth error', oauthError);
      setError(translateError(oauthError.message));
      setLoading(false);
    } else {
      console.log('[Auth] Google OAuth initiated, redirecting...');
    }
  };

  const handleLinkedInLogin = async () => {
    setError(null);
    setMessage(null);
    setLoading(true);
    console.log('[Auth] LinkedIn OAuth start', { redirectTo: callbackUrl });
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "linkedin_oidc",
      options: {
        redirectTo: callbackUrl,
      },
    });
    if (oauthError) {
      console.error('[Auth] LinkedIn OAuth error', oauthError);
      setError(translateError(oauthError.message));
      setLoading(false);
    } else {
      console.log('[Auth] LinkedIn OAuth initiated, redirecting...');
    }
  };

  const handleResendConfirmation = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    // Reinicia a contagem de 60s a cada clique
    setResendCooldown(60);
    try {
      const targetEmail = searchParams.get("email") || email;
      if (!targetEmail) {
        throw new Error("Email não encontrado para reenviar confirmação.");
      }
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: targetEmail,
      });
      if (resendError) throw resendError;
      setMessage("Email de confirmação reenviado. Verifique sua caixa de entrada.");
      console.log('[Auth] resend confirmation success', { email: targetEmail });
    } catch (err: any) {
      console.error('[Auth] resend confirmation error', err);
      setError(translateError(err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    // Validação local de email para melhor UX
    if (!isEmailValid(email)) {
      setError("Digite um email válido.");
      setLoading(false);
      return;
    }
    // Reinicia cooldown a cada envio
    setForgotCooldown(60);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: passwordResetRedirectUrl,
      });
      if (resetError) throw resetError;
      setMessage("Se o email existir, enviamos um link para recuperar sua senha. Verifique também a caixa de SPAM.");
      console.log('[Auth] reset password email sent', { email, redirectTo: passwordResetRedirectUrl });
    } catch (err: any) {
      console.error('[Auth] reset password error', err);
      setError(translateError(err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      console.log('[Auth] password updated successfully');
      navigate("/", { replace: true });
    } catch (err: any) {
      console.error('[Auth] update password error', err);
      setError(translateError(err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="w-full px-6 py-6 flex items-center justify-between max-w-7xl mx-auto">
        <Link to="/">
          <TalentaLogo />
        </Link>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-[0_4px_20px_rgba(124,198,255,0.15)] p-8">
            {/* Title */}
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-foreground mb-2">
                {mode === "confirm-email"
                  ? "Confirme seu email"
                  : mode === "forgot-password"
                  ? "Recuperar senha"
                  : mode === "update-password"
                  ? "Definir nova senha"
                  : isLogin
                  ? "Bem-vindo de volta"
                  : "Criar conta"}
              </h1>
              <p className="text-foreground/70">
                {mode === "confirm-email"
                  ? "Enviamos um email de confirmação. Verifique sua caixa de entrada e clique no link para ativar sua conta."
                  : mode === "forgot-password"
                  ? "Digite seu email para receber o link de recuperação."
                  : mode === "update-password"
                  ? "Defina uma nova senha para sua conta."
                  : isLogin
                  ? "Entre para continuar na TALENTA"
                  : "Junte-se à TALENTA hoje"}
              </p>
            </div>

            {/* Social Login Buttons */}
            {(mode === "login" || mode === "register") && (
              <div className="space-y-3 mb-6">
                <Button
                  onClick={handleGoogleLogin}
                  variant="outline"
                  disabled={loading}
                  className="w-full h-11 rounded-full bg-white hover:bg-accent border-border/40"
                >
                  <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Continuar com Google
                </Button>

                <Button
                  onClick={handleLinkedInLogin}
                  variant="outline"
                  disabled={loading}
                  className="w-full h-11 rounded-full bg-white hover:bg-accent border-border/40"
                >
                  <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                  </svg>
                  Continuar com LinkedIn
                </Button>
              </div>
            )}

            {/* Divider */}
            {(mode === "login" || mode === "register") && (
              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border/40"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-white text-foreground/70">ou</span>
                </div>
              </div>
            )}

            {/* Forms por modo */}
            {mode === "confirm-email" ? (
              <div className="space-y-4">
                <div className="text-sm text-foreground/70">
                  <p>
                    Para concluir seu cadastro, acesse o email que você informou e clique no link de confirmação.
                  </p>
                  {searchParams.get("email") && (
                    <p className="mt-2">Email: <span className="font-medium">{searchParams.get("email")}</span></p>
                  )}
                </div>
                {error && <div className="text-sm text-red-600">{error}</div>}
                {message && <div className="text-sm text-green-600">{message}</div>}
                <div className="flex gap-3">
          <Button
            onClick={handleResendConfirmation}
            disabled={loading || resendCooldown > 0}
            className="flex-1 h-11 rounded-full bg-primary hover:bg-primary/90 text-foreground"
          >
            {resendCooldown > 0 ? `Reenviar em ${resendCooldown}s` : "Reenviar email de confirmação"}
          </Button>
        </div>
              </div>
            ) : mode === "forgot-password" ? (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 rounded-full"
                    required
                  />
                </div>
                {error && <div className="text-sm text-red-600">{error}</div>}
                {message && <div className="text-sm text-green-600">{message}</div>}
                <Button
                  type="submit"
                  disabled={loading || forgotCooldown > 0}
                  className="w-full h-11 rounded-full bg-primary hover:bg-primary/90 text-foreground font-medium shadow-[0_2px_10px_rgba(124,198,255,0.3)]"
                >
                  {forgotCooldown > 0 ? `Reenviar em ${forgotCooldown}s` : (loading ? "Processando..." : "Enviar link de recuperação")}
                </Button>
              </form>
            ) : mode === "update-password" ? (
              <form onSubmit={handleUpdatePassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">Nova senha</Label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="h-11 rounded-full pr-12"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Esconder senha" : "Mostrar senha"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/60 hover:text-foreground focus:outline-none"
                    >
                      {showPassword ? (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5">
                          <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-4.58 0-8.5-2.62-10.29-6.43a1 1 0 0 1 0-.94A11.05 11.05 0 0 1 5.58 7.1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M1 1l22 22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <circle cx="12" cy="12" r="3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  </div>
                  {/* Password strength meter */}
                  <PasswordStrengthMeter password={newPassword} />
                </div>
                {error && <div className="text-sm text-red-600">{error}</div>}
                {message && <div className="text-sm text-green-600">{message}</div>}
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-full bg-primary hover:bg-primary/90 text-foreground font-medium shadow-[0_2px_10px_rgba(124,198,255,0.3)]"
                >
                  {loading ? "Processando..." : "Atualizar senha"}
                </Button>
              </form>
            ) : (
              // Login/Register padrão
              <form onSubmit={handleSubmit} className="space-y-4">
                {!isLogin && (
                  <div className="space-y-2">
                    <Label htmlFor="name">Nome completo</Label>
                    <Input
                      id="name"
                      type="text"
                      placeholder="João Silva"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-11 rounded-full"
                      required
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 rounded-full"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Senha</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-11 rounded-full pr-12"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Esconder senha" : "Mostrar senha"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/60 hover:text-foreground focus:outline-none"
                    >
                      {showPassword ? (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5">
                          <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-4.58 0-8.5-2.62-10.29-6.43a1 1 0 0 1 0-.94A11.05 11.05 0 0 1 5.58 7.1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M1 1l22 22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <circle cx="12" cy="12" r="3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  </div>
                  {/* Medidor de força no registro (sem rótulos/dicas) */}
                  <PasswordStrengthMeter password={password} showInfo={false} />
                  {/* Mensagem dinâmica única de erro */}
                  {(!getPasswordStatus(password).meets) && (
                    <p className="text-[12px] text-red-600">{getFirstPasswordError(password)}</p>
                  )}
                </div>

                {isLogin && (
                  <div className="text-right">
                    <button
                      type="button"
                      className="text-sm text-primary hover:underline"
                      onClick={() => setSearchParams({ mode: "forgot-password" })}
                    >
                      Esqueceu a senha?
                    </button>
                  </div>
                )}

                {error && (!(!isLogin && !getPasswordStatus(password).meets)) && (
                  <div className="text-sm text-red-600">{error}</div>
                )}
                {message && (
                  <div className="text-sm text-green-600">{message}</div>
                )}

                <Button
                  type="submit"
                  disabled={loading || (!isLogin && !getPasswordStatus(password).meets)}
                  className="w-full h-11 rounded-full bg-primary hover:bg-primary/90 text-foreground font-medium shadow-[0_2px_10px_rgba(124,198,255,0.3)]"
                >
                  {loading ? "Processando..." : isLogin ? "Entrar" : "Criar conta"}
                </Button>
              </form>
            )}

            {/* Toggle Login/Register */}
            {(mode === "login" || mode === "register") ? (
              <div className="mt-6 text-center text-sm">
                <span className="text-foreground/70">
                  {isLogin ? "Não tem uma conta?" : "Já tem uma conta?"}
                </span>{" "}
                <button
                  onClick={() => {
                    const nextMode = isLogin ? "register" : "login";
                    setSearchParams({ mode: nextMode });
                    setIsLogin(!isLogin);
                  }}
                  className="text-primary hover:underline font-medium"
                >
                  {isLogin ? "Registrar" : "Entrar"}
                </button>
              </div>
            ) : (
              <div className="mt-6 text-center text-sm">
                <button
                  onClick={() => setSearchParams({ mode: "login" })}
                  className="text-primary hover:underline font-medium"
                >
                  Voltar ao login
                </button>
              </div>
            )}
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="w-full px-6 py-6 text-center">
        <p className="text-sm text-foreground/70">
          TALENTA © 2025 — Desenvolvido com inteligência para o futuro do trabalho.
        </p>
      </footer>
    </div>
  );
};

export default Auth;

async function handleMagicLinkLogin(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true }
  });
  if (error) {
    console.error('Falha no login por email:', error.message);
    return;
  }
  // Sucesso: verifique o email para completar o login
}
