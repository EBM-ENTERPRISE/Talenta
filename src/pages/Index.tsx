import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import * as XLSX from "xlsx";
import { Link } from "react-router-dom";
import TalentaLogo from "@/components/TalentaLogo";
import SearchInput from "@/components/SearchInput";
import ThoughtsPanel from "@/components/ThoughtsPanel";
import ResultsPanel from "@/components/ResultsPanel";
import SearchSidebar from "@/components/SearchSidebar";
import { supabase } from "@/lib/utils";
import { filterByConstraints, optimizeByConstraints, optimizeProfilesByConstraints, type SearchConstraints, type CspEval } from "@/lib/applyCspToResults";
import type { RawProfileItem } from "@/lib/constraints";

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

type SearchResult = {
  id: string;
  search_id: string;
  target_type: string;
  target_id: string;
  rank: number;
  data: Record<string, unknown>;
};

type ScrapeResponse = {
  status: string;
  defaultDatasetId: string | null;
  count: number;
  items: RawJobItem[];
  target?: "jobs" | "people";
  decision?: "forced" | "prefix" | "ia" | "heuristic";
  forwardedPath?: string;
  refinedInput?: {
    keyword?: string[];
    location?: string;
    publishedAt?: string;
    startUrls?: { url: string }[];
    saveOnlyUniqueItems?: boolean;
    search?: string;
    position?: string;
  };
  refineStatus?: "ia" | "fallback" | "none";
  searchId?: string;
};

type SearchRecord = {
  id: string;
  prompt: string;
  target?: 'job' | 'profile';
  status: "pending" | "running" | "done" | "failed";
  created_at: string;
  constraints?: {
    count?: number;
    refinedInput?: {
      keyword?: string[];
      location?: string;
    };
  };
};

const Index = () => {
  const [showResults, setShowResults] = useState(false);
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, unknown>[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentTarget, setCurrentTarget] = useState<"jobs" | "people" | null>(null);

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
    setConstraints(null);
    setEvaluations(null);
    try {
      const lower = prompt.toLowerCase();
      const peopleTriggers = [
        /\bperfil(?:es)?\b/,
        /\bpessoas?\b/,
        /\bprofissional(?:es)?\b/,
        /\bcandidatos?\b/,
        /\btalentos?\b/,
      ];
      const roleTokens = [
        "programador","desenvolvedor","developer","engenheiro de software","software engineer",
        "frontend","backend","fullstack","qa","tester","mobile","ios","android",
        "data scientist","cientista de dados","engenheiro de dados","devops","sre"
      ];
      const hasRole = roleTokens.some(w => lower.includes(w));
      const hasLocation = /\b(em|in)\s+[a-zà-úãõç\- ]+/.test(lower);
      const forceTarget = peopleTriggers.some((re) => re.test(lower)) ? "people" : (hasRole && hasLocation ? "jobs" : undefined);
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const { data, error } = await supabase.functions.invoke<ScrapeResponse>("search-router", {
        body: { prompt, forceTarget },
        headers: {
          Authorization: accessToken ? `Bearer ${accessToken}` : `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY as string}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        },
      });
      if (error) {
        console.error("[Index] scrape error", error);
        setResults([]);
        setCurrentTarget(null);
      } else {
        console.log("[Index] scrape success", { count: data?.count, target: data?.target, decision: data?.decision, path: data?.forwardedPath });
        console.log("[Index] refine output", { refineStatus: data?.refineStatus, refinedInput: data?.refinedInput, searchId: data?.searchId });
        const rawItems = Array.isArray(data?.items) ? (data!.items as unknown as Record<string, unknown>[]) : [];
        setCurrentTarget(data?.target ?? null);
        const refined = data?.refinedInput;
        if ((data?.target ?? null) === 'people') {
          const nextConstraints: SearchConstraints = {
            refinedInput: {
              keyword: Array.isArray(refined?.keyword) ? refined!.keyword : (
                typeof refined?.search === 'string' && refined!.search.trim() ? [refined!.search.trim()] : (
                  typeof refined?.position === 'string' && refined!.position.trim() ? [refined!.position.trim()] : []
                )
              ),
              location: typeof refined?.location === 'string' ? refined!.location : undefined,
            },
            keywords: Array.isArray(refined?.keyword) ? refined!.keyword : undefined,
            locationPriority: 'required',
            candidateExperienceYears: extractMinYearsFromPrompt(prompt) ?? undefined,
          };
          const outcome = optimizeProfilesByConstraints(rawItems as unknown as RawProfileItem[], nextConstraints, 10);
          setConstraints(nextConstraints);
          setEvaluations(outcome.evaluations);
          setResults(outcome.items as unknown as Record<string, unknown>[]);
        } else {
          const nextConstraints: SearchConstraints = {
            refinedInput: {
              keyword: Array.isArray(refined?.keyword) ? refined!.keyword : (
                typeof refined?.position === 'string' && refined!.position.trim() ? [refined!.position.trim()] : []
              ),
              location: typeof refined?.location === 'string' ? refined!.location : undefined,
            },
            keywords: Array.isArray(refined?.keyword) ? refined!.keyword : undefined,
            locationPriority: 'required',
            candidateExperienceYears: extractMinYearsFromPrompt(prompt) ?? undefined,
          };
          const outcome = optimizeByConstraints(rawItems as RawJobItem[], nextConstraints, 10);
          setConstraints(nextConstraints);
          setEvaluations(outcome.evaluations);
          setResults(outcome.items as unknown as Record<string, unknown>[]);
        }
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

  const handleSearchSelect = (prompt: string) => {
    handleSubmit(prompt);
  };

  const [constraints, setConstraints] = useState<SearchConstraints | null>(null);
  const [evaluations, setEvaluations] = useState<CspEval[] | null>(null);

  const handleResultsSelect = (search: SearchRecord, results: SearchResult[]) => {
    console.log('[Index] handleResultsSelect called', { searchId: search.id, count: results.length, constraints: search.constraints });
    console.log('[Index] Raw results:', results);

    // Convert saved results to the expected format
    const jobItems: RawJobItem[] = results.map(result => {
      const data = result.data as RawJobItem;
      return data;
    });

    // Apply CSP evaluation (non-filtering, just scoring/explanations)
    const yearsFromPrompt = extractMinYearsFromPrompt(search.prompt);
    const baseCons = search.constraints || null;
    const currentConstraints: SearchConstraints | null = baseCons ? { ...baseCons, candidateExperienceYears: yearsFromPrompt ?? baseCons?.candidateExperienceYears } : (yearsFromPrompt ? { candidateExperienceYears: yearsFromPrompt } as SearchConstraints : null);
    const outcome = (search.target === 'profile')
      ? optimizeProfilesByConstraints(jobItems as unknown as RawProfileItem[], currentConstraints || undefined, 10)
      : optimizeByConstraints(jobItems, currentConstraints || undefined, 10);


    setConstraints(currentConstraints);
    setEvaluations(outcome.evaluations);
    setResults(outcome.items as unknown as Record<string, unknown>[]);
    setShowResults(true);
    setLoadingResults(false);

    // Use the actual prompt from the saved search for display/editing
    setCurrentPrompt(search.prompt);
    setCurrentTarget(search.target === 'profile' ? 'people' : 'jobs');

    console.log('[Index] State updated - showResults: true, results count:', outcome.items.length);
  };

  const handleBack = () => {
    setShowResults(false);
    setCurrentPrompt("");
  };

  const exportExcel = () => {
    if (!Array.isArray(results) || results.length === 0) return;
    const sanitize = (s: string) => s.replace(/^\s*[`'"]?\s*/, "").replace(/\s*[`'"]?\s*$/, "");
    const getStr = (v: unknown): string => {
      if (typeof v === "string") return sanitize(v);
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        const t = o["linkedinText"] || o["text"] || o["name"];
        if (typeof t === "string") return sanitize(t);
      }
      return "";
    };
    const getLocation = (obj: unknown): string => {
      if (typeof obj === "string") return sanitize(obj);
      if (obj && typeof obj === "object") {
        const o = obj as Record<string, unknown>;
        const parsed = o["parsed"] as Record<string, unknown> | undefined;
        const txt = typeof o["linkedinText"] === "string" ? (o["linkedinText"] as string) : undefined;
        const ptxt = parsed && typeof parsed["text"] === "string" ? (parsed["text"] as string) : undefined;
        return sanitize(ptxt || txt || "");
      }
      return "";
    };
    const rows = results.map((raw: unknown) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      if (currentTarget === "people") {
        const first = getStr(item["firstName"]);
        const last = getStr(item["lastName"]);
        const name = (first || last) ? `${first}${first && last ? " " : ""}${last}` : (getStr(item["name"]) || getStr(item["title"]) || "");
        const resumo = getStr(item["headline"]) || getStr(item["snippet"]) || "";
        const directUrl = getStr(item["linkedinUrl"]) || getStr(item["profileUrl"]) || getStr(item["link"]);
        const publicId = getStr(item["publicIdentifier"]);
        const url = directUrl || (publicId ? `https://www.linkedin.com/in/${publicId}` : "");
        let location = getLocation(item["location"]) || getStr(item["location"]) || "";
        if (!location) {
          const profLoc = (item["profileLocation"] ?? item["geo"]) as unknown;
          location = getLocation(profLoc) || location;
        }
        if (!location) {
          const currPos = Array.isArray(item["currentPosition"]) ? (item["currentPosition"] as unknown[]) : [];
          const firstPos = (currPos[0] ?? {}) as Record<string, unknown>;
          location = getStr(firstPos["location"]) || location;
        }
        const currPos = Array.isArray(item["currentPosition"]) ? (item["currentPosition"] as unknown[]) : [];
        const firstPos = (currPos[0] ?? {}) as Record<string, unknown>;
        const posTitle = getStr(firstPos["position"]);
        const posCompany = getStr(firstPos["companyName"]);
        const descricao = (posTitle || posCompany) ? `${posTitle}${posTitle && posCompany ? " · " : ""}${posCompany}` : (resumo ? resumo.slice(0, 140) : "");
        return { Nome: name, Resumo: resumo, Localizacao: location, Descricao: descricao, LinkedIn: url };
      }
      const title = getStr(item["title"]) || getStr(item["position"]) || "";
      const companyName = getStr(item["companyName"]) || getStr(item["company"]) || "";
      const location = getStr(item["location"]) || getStr(item["city"]) || "";
      const description = getStr(item["description"]) || getStr(item["snippet"]) || "";
      const applyUrl = getStr(item["applyUrl"]) || getStr(item["url"]) || getStr(item["link"]) || "";
      const postedAt = getStr(item["postedAt"]) || getStr(item["datePosted"]) || "";
      return { Titulo: title, Empresa: companyName, Localizacao: location, Descricao: description, URL: applyUrl, Publicada: postedAt };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, currentTarget === "people" ? "Perfis" : "Vagas");
    const base = currentPrompt.trim() || (currentTarget === "people" ? "perfis" : "vagas");
    const fname = `${base.replace(/\s+/g, "_")}_${currentTarget === "people" ? "perfis" : "vagas"}.xlsx`;
    XLSX.writeFile(wb, fname);
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
            {sessionEmail && (
              <SearchSidebar onSearchSelect={handleSearchSelect} onResultsSelect={handleResultsSelect} />
            )}
            <TalentaLogo />
          </div>
          <div className="flex items-center gap-3">
            {sessionEmail ? (
              <>
              <Button 
                variant="default"
                className="h-9 px-6 bg-primary hover:bg-primary/90 text-foreground rounded-full font-medium"
                disabled={saving || results.length === 0}
                onClick={async () => {
                  console.log('[Index] salvar click', { prompt: currentPrompt, count: results.length });
                  try {
                    setSaving(true);
                    const { data: sessionData } = await supabase.auth.getSession();
                    const accessToken = sessionData.session?.access_token;
                    if (!accessToken) {
                      console.error('[Index] save-search aborted: missing user access token');
                      setSaving(false);
                      return;
                    }
                    const { data, error } = await supabase.functions.invoke<{ ok: boolean; searchId?: string; count?: number }>("save-search", {
                      body: {
                        target: currentTarget === 'people' ? 'profile' : 'job',
                        prompt: currentPrompt,
                        items: results,
                        constraints: constraints || null,
                      },
                      headers: {
                        Authorization: `Bearer ${accessToken}`,
                        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
                      },
                    });
                    if (error) {
                      console.error('[Index] save-search error', error);
                    } else {
                      console.log('[Index] save-search success', { searchId: data?.searchId, count: data?.count });
                    }
                  } catch (e) {
                    console.error('[Index] save-search exception', e);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? 'A salvar...' : 'Salvar'}
              </Button>
              <Button
                variant="outline"
                className="h-9 px-6 rounded-full font-medium"
                disabled={results.length === 0}
                onClick={exportExcel}
              >
                Exportar Excel
              </Button>
              </>
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
          <ThoughtsPanel onNewPrompt={handleNewPrompt} initialPrompt={currentPrompt} />
      <ResultsPanel results={results as unknown as RawJobItem[]} loading={loadingResults} constraints={constraints || undefined} evaluations={evaluations || undefined} target={currentTarget || undefined} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="w-full px-6 py-6 flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-4">
          {sessionEmail && (
            <SearchSidebar onSearchSelect={handleSearchSelect} onResultsSelect={handleResultsSelect} />
          )}
          <TalentaLogo />
        </div>
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

          {/* Action Buttons removidos */}
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
  const extractMinYearsFromPrompt = (text: string): number | null => {
    const t = text.toLowerCase();
    const m = t.match(/(\d+)\s*\+?\s*(anos|year)/);
    if (m) {
      const n = parseInt(m[1], 10);
      return Number.isFinite(n) ? n : null;
    }
    const r = t.match(/(\d+)\s*(a|-|–|—)\s*(\d+)\s*anos/);
    if (r) {
      const n = parseInt(r[1], 10);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
