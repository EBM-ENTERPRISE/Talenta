// Supabase Edge Function: roteador de buscas (jobs vs people)
// Decide qual scraper chamar com base no prompt do usuário.


declare const Deno: {
  env: { get(name: string): string | undefined };
  serve: (handler: (req: Request) => Promise<Response> | Response) => void;
};

type RouteTarget = "jobs" | "people";

// Tipo mínimo para resposta de Chat Completions da OpenAI que usamos
type OpenAIChatCompletion = {
  choices?: Array<{ message?: { content?: string } }>; 
  error?: { message?: string; type?: string; code?: string };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

if (!SUPABASE_URL) console.error("[search-router] Missing SUPABASE_URL secret");
if (!OPENAI_API_KEY) console.warn("[search-router] Missing OPENAI_API_KEY; classificação cairá em heurística");


const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getFunctionsBaseUrl(): string | null {
  const url = String(SUPABASE_URL || "");
  const m = url.match(/^https?:\/\/([^.]+)\.supabase\.co/i);
  const ref = m?.[1];
  return ref ? `https://${ref}.functions.supabase.co` : null;
}

function detectLocation(prompt: string): string | undefined {
  const m = prompt.match(/(?:em|in)\s+([^,.\n]+)/i);
  return m ? m[1].trim() : undefined;
}

function extractRole(prompt: string): string | undefined {
  const patterns = [
    /vaga\s+de\s+([^,.\n]+?)(?=\s+em\s+|$)/i,
    /de\s+([^,.\n]+?)\s+em\s+/i,
    /para\s+([^,.\n]+?)(?=\s+em\s+|$)/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m && m[1]) return m[1].trim();
  }
  // fallback: pegue primeiras 3 palavras relevantes
  const cleaned = prompt
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ");
  const stop = new Set(["quero","procuro","busco","uma","um","vaga","vagas","em","para","de","no","na","o","a"]);
  const words = cleaned.filter(w => !stop.has(w));
  return words.slice(0, 3).join(" ") || undefined;
}

function extractPeopleQuery(prompt: string): string | undefined {
  const loc = detectLocation(prompt)?.toLowerCase() || "";
  const locTokens = loc ? loc.replace(/[,]/g, " ").split(/\s+/).filter(Boolean) : [];
  const cleaned = prompt
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ");
  const stop = new Set(["quero","procuro","busco","uma","um","vaga","vagas","em","para","de","no","na","o","a"]);
  const filtered = cleaned.filter(w => !stop.has(w) && !locTokens.includes(w));
  const unique = Array.from(new Set(filtered)).filter(s => s.length >= 2);
  return unique.slice(0, 3).join(" ") || undefined;
}

function heuristicTarget(prompt: string): RouteTarget {
  const p = prompt.toLowerCase();
  // Disparadores diretos para perfis/pessoas, independentes de profissão
  const immediatePeople = [
    /\bperfil(?:es)?\b/,
    /\bpessoas?\b/,
    /\bprofissionais?\b/,
    /\bprofissional\b/,
    /\bcandidatos?\b/,
    /\btalentos?\b/,
    /\blinkedin\b/,
    /\bgithub\b/,
    /\bbehance\b/,
    /\bdribbble\b/,
    /\bcurr[ií]culo\b|\bcv\b/,
    /\bcontato\b|\bcontact\b/,
    /\bemail\b|\btelefone\b/
  ];
  if (immediatePeople.some(re => re.test(p))) return "people";

  // Palavras-chave amplas e multi-setor
  const peopleHints = [
    "perfil linkedin","perfil","perfis","pessoa","pessoas","profissional","profissionais","candidato","candidatos",
    "talento","talentos","curriculo","currículo","contato","contact","email","telefone",
    // áreas diversas
    "médico","medico","advogado","designer","design","arquitet(o|a)","engenheiro","engenharia","marketing","comercial",
    "vendas","vendedor","recursos humanos","rh","recrutador","recruiter","financeiro","finanças","contabilidade",
    "professor","docente","analista","consultor","gestor","gerente","operador","técnico","tecnico","enfermeiro",
    "psicólogo","psicologo","nutricionista","farmacêutico","farmaceutico"
  ];
  const jobHints = [
    "vaga","vagas","emprego","trabalho","oportunidade","job","posição","posicao","contrata","hiring","opening",
    "salário","salario","benefícios","beneficios","clt","pj","full-time","part-time","candidatar","aplicar","apply"
  ];
  const roleTokens = [
    "programador","desenvolvedor","developer","engenheiro de software","software engineer",
    "frontend","backend","fullstack","qa","tester","mobile","ios","android",
    "data scientist","cientista de dados","engenheiro de dados","devops","sre"
  ];
  const peopleScore = peopleHints.reduce((acc, w) => acc + (p.includes(w) ? 1 : 0), 0);
  const jobScore = jobHints.reduce((acc, w) => acc + (p.includes(w) ? 1 : 0), 0);
  if (jobScore > peopleScore) return "jobs";
  const hasRole = roleTokens.some(w => p.includes(w));
  const hasLocation = /\b(em|in)\s+[a-zà-úãõç\- ]+/.test(p);
  if (hasRole && hasLocation) return "jobs";
  if (hasRole && peopleScore === 0) return "jobs";
  return "people";
}

function computeScores(prompt: string): { peopleScore: number; jobScore: number; hasJobHint: boolean; hasPeopleHint: boolean } {
  const p = prompt.toLowerCase();
  const peopleHints = [
    "perfil linkedin","perfil","perfis","pessoa","pessoas","profissional","profissionais","candidato","candidatos",
    "talento","talentos","curriculo","currículo","contato","contact","email","telefone",
    "médico","medico","advogado","designer","design","arquitet","engenheiro","engenharia","marketing","comercial",
    "vendas","vendedor","recursos humanos","rh","recrutador","recruiter","financeiro","finanças","contabilidade",
    "professor","docente","analista","consultor","gestor","gerente","operador","técnico","tecnico","enfermeiro",
    "psicólogo","psicologo","nutricionista","farmacêutico","farmaceutico",
    // termos comuns de cargos
    "programador","developer","desenvolvedor","data scientist","engenheiro de dados","frontend","backend","fullstack"
  ];
  const jobHints = [
    "vaga","vagas","emprego","trabalho","oportunidade","job","posição","posicao","contrata","hiring","opening",
    "salário","salario","benefícios","beneficios","clt","pj","full-time","part-time","candidatar","aplicar","apply"
  ];
  const peopleScore = peopleHints.reduce((acc, w) => acc + (p.includes(w) ? 1 : 0), 0);
  const jobScore = jobHints.reduce((acc, w) => acc + (p.includes(w) ? 1 : 0), 0);
  return { peopleScore, jobScore, hasJobHint: jobScore > 0, hasPeopleHint: peopleScore > 0 };
}

async function classifyTarget(prompt: string): Promise<RouteTarget> {
  // Se não houver chave, use heurística abrangente
  if (!OPENAI_API_KEY) {
    return heuristicTarget(prompt);
  }

  const system = `Classifique o pedido em 'jobs' (buscar vagas) ou 'people' (buscar perfis). Responda APENAS JSON: {"target":"jobs|people"}.`;
  const user = `Prompt: "${prompt}"`;
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [ { role: "system", content: system }, { role: "user", content: user } ],
      temperature: 0,
      response_format: { type: "json_object" }
    }),
  });
  let data: unknown;
  try { data = await resp.json(); } catch { return "jobs"; }
  const content: string = ((data as OpenAIChatCompletion)?.choices?.[0]?.message?.content) ?? "";
  try {
    const parsed = JSON.parse(content);
    const t = parsed?.target;
    if (t === "people" || t === "jobs") {
      const { peopleScore, jobScore, hasJobHint } = computeScores(prompt);
      const hasRoleWithLocation = /\b(em|in)\s+[a-zà-úãõç\- ]+/.test(prompt.toLowerCase()) && /programador|desenvolvedor|developer|engenheiro de software|software engineer|frontend|backend|fullstack|qa|tester|mobile|ios|android|data scientist|cientista de dados|engenheiro de dados|devops|sre/.test(prompt.toLowerCase());
      if (t === "jobs" && !hasJobHint && peopleScore >= jobScore && !hasRoleWithLocation) return "people";
      return t;
    }
  } catch (e) {
    console.warn("[search-router] falha ao parsear conteúdo de classificação", { preview: content.slice(0, 120) });
    // Fallback extra: se o conteúdo mencionar explicitamente, respeite
    const low = content.toLowerCase();
    if (/("|\b)people(\b|"|')/.test(low)) return "people";
    if (/("|\b)jobs?(\b|"|')/.test(low)) return "jobs";
  }
  // Fallback final: heurística abrangente
  return heuristicTarget(prompt);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    const reqHeaders = req.headers.get("Access-Control-Request-Headers") || "authorization, x-client-info, apikey, content-type";
    const reqMethod = req.headers.get("Access-Control-Request-Method") || "POST";
    const dynamicCors = {
      ...corsHeaders,
      "Access-Control-Allow-Headers": reqHeaders,
      "Access-Control-Allow-Methods": reqMethod,
    } as Record<string, string>;
    return new Response("ok", { status: 200, headers: dynamicCors });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), { status: 405, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }

  try {
    const body = await req.json();
    const rawPrompt: string = String(body?.prompt || "").trim();
    if (!rawPrompt) {
      return new Response(JSON.stringify({ error: "prompt obrigatório" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }
    // Suporte a override explícito via corpo da requisição ou prefixo no prompt
    let decisionSource: "forced" | "prefix" | "ia" | "heuristic" = "ia";
    let effectivePrompt = rawPrompt;
    const overrideRaw = String(body?.target || body?.forceTarget || "").toLowerCase();
    let target: RouteTarget | null = null;

    if (overrideRaw === "people" || overrideRaw === "jobs") {
      target = overrideRaw as RouteTarget;
      decisionSource = "forced";
    } else {
      const peoplePrefix = effectivePrompt.match(/^\s*(people|pessoas|perfil|profissional(?:es)?)\s*:\s*(.*)$/i);
      if (peoplePrefix) {
        target = "people";
        effectivePrompt = peoplePrefix[2].trim();
        decisionSource = "prefix";
      } else {
        const jobsPrefix = effectivePrompt.match(/^\s*(jobs?|vagas?|emprego|job)\s*:\s*(.*)$/i);
        if (jobsPrefix) {
          target = "jobs";
          effectivePrompt = jobsPrefix[2].trim();
          decisionSource = "prefix";
        }
      }
    }

    if (!target) {
      // Primeiro tenta IA; fallback será heurística dentro da função
      target = await classifyTarget(effectivePrompt);
      // Se OPENAI_API_KEY ausente, classifyTarget já usa heurística, marcamos source apropriadamente
      decisionSource = OPENAI_API_KEY ? "ia" : "heuristic";
      if (target === "jobs") {
        const { peopleScore, jobScore, hasJobHint } = computeScores(effectivePrompt);
        if (!hasJobHint && peopleScore >= jobScore) {
          target = "people";
          decisionSource = "heuristic";
        }
      }
    }
    const base = getFunctionsBaseUrl();
    if (!base) {
      return new Response(JSON.stringify({ error: "Base de Functions não disponível" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    let targetPath = "/scrape-linkedin-jobs";
    let payload: Record<string, unknown> = {};

    if (target === "people") {
      targetPath = "/scrape-linkedin-people";
      payload = {
        locations: detectLocation(effectivePrompt) ? [detectLocation(effectivePrompt)!] : undefined,
        profileScraperMode: "Full",
        maxItems: typeof body?.maxItems === "number" ? body.maxItems : 20,
        recentlyChangedJobs: false,
        searchQuery: extractPeopleQuery(effectivePrompt) || extractRole(effectivePrompt) || effectivePrompt,
      };
    } else {
      payload = { prompt: effectivePrompt };
    }

    console.log("[search-router] encaminhando", { target, path: targetPath, payload });

    // Encaminhar autenticação para o scraper alvo para evitar 401
    const incomingAuth = req.headers.get("authorization") || "";
    const incomingApiKey = req.headers.get("apikey") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const forwardHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (incomingAuth) forwardHeaders["Authorization"] = incomingAuth;
    else if (anonKey) forwardHeaders["Authorization"] = `Bearer ${anonKey}`;
    if (incomingApiKey) forwardHeaders["apikey"] = incomingApiKey;
    else if (anonKey) forwardHeaders["apikey"] = anonKey;

    const resp = await fetch(`${base}${targetPath}`, {
      method: "POST",
      headers: forwardHeaders,
      body: JSON.stringify(payload),
    });
    const resultText = await resp.text();
    const contentType = resp.headers.get("Content-Type") || "application/json";
    // Tenta normalizar a resposta em um envelope com metadados da roteamento
    let parsed: unknown = null;
    try { parsed = JSON.parse(resultText); } catch { parsed = null; }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const items = Array.isArray(obj.items) ? obj.items : [];
      const count = typeof obj.count === "number" ? obj.count : (Array.isArray(items) ? items.length : 0);
      const defaultDatasetId = (obj.defaultDatasetId as string | undefined) ?? (obj.datasetId as string | undefined) ?? null;
      const envelope = {
        target,
        decision: decisionSource,
        forwardedPath: targetPath,
        ...obj,
        count,
        defaultDatasetId,
        ...(target === "people" ? {
          refinedInput: {
            keyword: typeof (payload as Record<string, unknown>)?.["searchQuery"] === "string" && (payload as Record<string, unknown>)["searchQuery"] ? [String((payload as Record<string, unknown>)["searchQuery"]) ] : [],
            location: Array.isArray((payload as Record<string, unknown>)?.["locations"]) && ((payload as Record<string, unknown>)["locations"] as unknown[]).length > 0 ? String(((payload as Record<string, unknown>)["locations"] as unknown[])[0]) : undefined,
          },
          refineStatus: "fallback",
        } : {}),
      } as Record<string, unknown>;
      return new Response(JSON.stringify(envelope), { status: resp.status, headers: { "Content-Type": "application/json", ...corsHeaders, "X-Route-Target": target, "X-Route-Decision": decisionSource, "X-Route-Path": targetPath } });
    }
    // Se não for JSON, repassa bruto
    return new Response(resultText, { status: resp.status, headers: { "Content-Type": contentType, ...corsHeaders, "X-Route-Target": target, "X-Route-Decision": decisionSource, "X-Route-Path": targetPath } });
  } catch (e) {
    console.error("[search-router] erro inesperado", e);
    return new Response(JSON.stringify({ error: "Erro interno", message: String((e as Error)?.message || e) }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
});
