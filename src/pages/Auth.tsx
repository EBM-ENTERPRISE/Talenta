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
  const navigate = useNavigate();

  useEffect(() => {
    setIsLogin(searchParams.get("mode") !== "register");
  }, [searchParams]);

  // Utilitários de UX
  const translateError = (msg: string) => {
    const map: Record<string, string> = {
      "Invalid login credentials": "Email ou senha incorretos",
      "Email not confirmed": "Confirme seu email antes de entrar",
      "User already registered": "Este email já está cadastrado",
      "Password should be at least 6 characters": "A senha precisa ter pelo menos 6 caracteres",
      "Unable to validate email address: invalid format": "Formato de email inválido",
    };
    return map[msg] || msg;
  };

  const MIN_PASSWORD_LENGTH = 8;
  const getPasswordStatus = (pw: string) => {
    const hasMinLength = pw.length >= MIN_PASSWORD_LENGTH;
    const hasNumber = /\d/.test(pw);
    const hasUpper = /[A-Z]/.test(pw);
    const hasLower = /[a-z]/.test(pw);
    const hasSymbol = /[^A-Za-z0-9]/.test(pw);
    return {
      hasMinLength,
      hasNumber,
      hasUpper,
      hasLower,
      hasSymbol,
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    console.log('[Auth] submit', { isLogin, email });
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
        // Login direto após registro (sem confirmação de email)
        navigate("/", { replace: true });
      }
    } catch (err) {
      console.error('[Auth] submit error', err);
      setError(translateError((err as Error)?.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="w-full px-6 py-6">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <Link to="/" className="flex items-center gap-3">
            <TalentaLogo />
            <span className="text-xl font-semibold">TALENTA</span>
          </Link>
          <Link to="/">
            <Button variant="ghost" size="sm" className="rounded-full">
              Voltar ao site
            </Button>
          </Link>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md space-y-6">
          {/* Title */}
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">
              {isLogin ? "Entrar na sua conta" : "Criar sua conta"}
            </h1>
            <p className="text-foreground/70">
              {isLogin ? "Bem-vindo de volta!" : "Comece sua jornada conosco"}
            </p>
          </div>

          {/* Formulário de Login/Registro básico */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="name">Nome completo</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Seu nome"
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
              {!isLogin && (
                <p className="text-xs text-foreground/60">
                  Mínimo 8 caracteres, incluindo maiúsculas, minúsculas, números e símbolos
                </p>
              )}
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}

            <Button
              type="submit"
              disabled={loading || (!isLogin && !getPasswordStatus(password).meets)}
              className="w-full h-11 rounded-full bg-primary hover:bg-primary/90 text-foreground font-medium shadow-[0_2px_10px_rgba(124,198,255,0.3)]"
            >
              {loading ? "Processando..." : isLogin ? "Entrar" : "Criar conta"}
            </Button>
          </form>

          {/* Toggle Login/Register */}
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