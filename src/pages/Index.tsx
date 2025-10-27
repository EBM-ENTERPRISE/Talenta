import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import TalentaLogo from "@/components/TalentaLogo";
import SearchInput from "@/components/SearchInput";
import ActionButtons from "@/components/ActionButtons";
import ThoughtsPanel from "@/components/ThoughtsPanel";
import ResultsPanel from "@/components/ResultsPanel";
import { supabase } from "@/lib/utils";

type RawJobItem = {
  title?: string;
  position?: string;
  companyName?: string;
  company?: string;
  location?: string;
  city?: string;
  description?: string;
  snippet?: string;
  applyUrl?: string;
  url?: string;
  link?: string;
  postedAt?: string;
  datePosted?: string;
};

const Index = () => {
  const [showResults, setShowResults] = useState(false);
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [results, setResults] = useState<RawJobItem[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[Index] auth state change', { event, email: session?.user?.email });
      setSessionEmail(session?.user?.email ?? null);
    });
    // fetch initial session
    supabase.auth.getSession().then(({ data }) => {
      console.log('[Index] initial session', { email: data.session?.user?.email });
      setSessionEmail(data.session?.user?.email ?? null);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (prompt: string) => {
    setCurrentPrompt(prompt);
    setShowResults(true);
    setLoadingResults(true);
    try {
      const { data, error } = await supabase.functions.invoke<{
        status: string;
        defaultDatasetId: string | null;
        count: number;
        items: RawJobItem[];
      }>("scrape-linkedin-jobs", {
        body: { prompt },
      });
      if (error) {
        console.error("[Index] scrape error", error);
        setResults([]);
      } else {
        console.log("[Index] scrape success", { count: data?.count });
        setResults(Array.isArray(data?.items) ? data.items : []);
      }
    } catch (err) {
      console.error("[Index] scrape exception", err);
      setResults([]);
    } finally {
      setLoadingResults(false);
    }
  };

  const handleNewPrompt = (prompt: string) => {
    setCurrentPrompt(prompt);
    // Here you would trigger a new search with the updated prompt
  };

  const handleBack = () => {
    setShowResults(false);
    setCurrentPrompt("");
  };

  if (showResults) {
    return (
      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <header className="w-full px-6 py-4 flex items-center justify-between border-b border-border/40 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={handleBack}
              className="hover:bg-accent"
            >
              ← Voltar
            </Button>
            <TalentaLogo />
          </div>
          <div className="flex items-center gap-3">
            {sessionEmail ? (
              <Button 
                variant="default"
                className="h-9 px-6 bg-primary hover:bg-primary/90 text-foreground rounded-full font-medium"
                onClick={() => {
                  console.log('[Index] salvar click', { prompt: currentPrompt });
                  // TODO: implementar salvar
                }}
              >
                Salvar
              </Button>
            ) : (
              <Link to="/auth?mode=login">
                <Button 
                  variant="default"
                  className="h-9 px-6 bg-primary hover:bg-primary/90 text-foreground rounded-full font-medium"
                >
                  Login
                </Button>
              </Link>
            )}
          </div>
        </header>

        {/* Results View */}
        <div className="flex-1 flex overflow-hidden">
          <ThoughtsPanel onNewPrompt={handleNewPrompt} />
          <ResultsPanel results={results} loading={loadingResults} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="w-full px-6 py-6 flex items-center justify-between max-w-7xl mx-auto">
        <TalentaLogo />
        <div className="flex items-center gap-3">
          {sessionEmail ? (
            <>
              <span className="text-sm text-foreground/80">{sessionEmail}</span>
              <Button
                variant="outline"
                onClick={async () => { 
                  console.log('[Index] signOut click');
                  const { error } = await supabase.auth.signOut();
                  if (error) {
                    console.error('[Index] signOut error', error);
                  } else {
                    console.log('[Index] signOut success');
                  }
                }}
                className="h-11 px-6 rounded-full"
              >
                Sair
              </Button>
            </>
          ) : (
            <>
              <Link to="/auth?mode=login">
                <Button 
                  variant="default"
                  className="h-11 px-8 bg-primary hover:bg-primary/90 text-foreground rounded-full font-medium transition-all hover:scale-105 shadow-[0_2px_10px_rgba(124,198,255,0.3)]"
                >
                  Login
                </Button>
              </Link>
              <Link to="/auth?mode=register">
                <Button 
                  variant="default"
                  className="h-11 px-8 bg-primary hover:bg-primary/90 text-foreground rounded-full font-medium transition-all hover:scale-105 shadow-[0_2px_10px_rgba(124,198,255,0.3)]"
                >
                  Registrar
                </Button>
              </Link>
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
        <div className="w-full max-w-4xl mx-auto text-center space-y-8">
          {/* Heading */}
          <div className="space-y-4">
            <h1 className="text-5xl md:text-6xl font-bold text-foreground">
              O que procuras hoje?
            </h1>
            <p className="text-lg md:text-xl text-foreground/80 max-w-2xl mx-auto">
              Descreve o tipo de vaga ou o profissional ideal — a TALENTA encontra os melhores resultados para ti.
            </p>
          </div>

          {/* Search Input */}
          <SearchInput onSubmit={handleSubmit} />

          {/* Action Buttons */}
          <ActionButtons />
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

export default Index;
