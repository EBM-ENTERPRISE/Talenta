// Supabase Edge Function (Deno) para acionar o Actor do Apify e ingerir resultados
// Executa no ambiente de funções do Supabase (Deno). Não expõe tokens no frontend.

// @ts-expect-error: Import remoto usado no runtime Deno das Edge Functions
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Declaração mínima para satisfazer o TypeScript local; no deploy, o runtime é Deno
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve: (handler: (req: Request) => Promise<Response> | Response) => void;
};

type ScrapeInput = {
  startUrls?: { url: string }[];
  keyword?: string[];
  search?: string;
  position?: string;
  location?: string;
  publishedAt?: string;
  saveOnlyUniqueItems?: boolean;
};

type RefineResponse = {
  keyword: string[];
  location?: string;
  publishedAt?: string; // e.g., r86400, r604800
  startUrls?: { url: string }[];
  saveOnlyUniqueItems?: boolean;
};

type ApifyJobItem = {
  id?: string;
  jobId?: string;
  url?: string;
  link?: string;
  title?: string;
  position?: string;
  companyName?: string;
  company?: string;
  location?: string;
  city?: string;
  description?: string;
  snippet?: string;
  applyUrl?: string;
  postedAt?: string;
  datePosted?: string;
  [key: string]: unknown;
};

const APIFY_TOKEN = Deno.env.get("APIFY_API_TOKEN");
const ACTOR_ID = Deno.env.get("APIFY_API_ATOR") || "2rJKkhh7vjpX7pvjg";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");

if (!APIFY_TOKEN) console.error("[scrape-linkedin-jobs] Missing APIFY_API_TOKEN secret");
if (!SUPABASE_URL) console.error("[scrape-linkedin-jobs] Missing SUPABASE_URL secret");
if (!SUPABASE_SERVICE_ROLE_KEY) console.error("[scrape-linkedin-jobs] Missing SUPABASE_SERVICE_ROLE key");
if (!GROQ_API_KEY) console.warn("[scrape-linkedin-jobs] Missing GROQ_API_KEY; prompt refinement will be skipped");

const supabase = createClient(String(SUPABASE_URL), String(SUPABASE_SERVICE_ROLE_KEY));

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function startActorRun(input: ScrapeInput) {
  const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await resp.json();
  return json?.data;
}

async function pollRun(actorRunId: string) {
  let status = "RUNNING";
  let defaultDatasetId: string | null = null;
  for (let i = 0; i < 120 && status === "RUNNING"; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/runs/${actorRunId}?token=${APIFY_TOKEN}`;
    const resp = await fetch(url);
    const json = await resp.json();
    status = json?.data?.status ?? status;
    defaultDatasetId = json?.data?.defaultDatasetId ?? defaultDatasetId;
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED_OUT"].includes(status)) break;
  }
  return { status, defaultDatasetId };
}

async function fetchDatasetItems(datasetId: string): Promise<ApifyJobItem[]> {
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&format=json`;
  const resp = await fetch(url);
  const itemsJson = (await resp.json()) as unknown;
  return Array.isArray(itemsJson) ? (itemsJson as ApifyJobItem[]) : [];
}

function buildLinkedinUrl(keywords: string[], location?: string, publishedAt?: string): string {
  const params = new URLSearchParams();
  if (keywords.length) params.set("keywords", keywords.join(" "));
  if (location) params.set("location", location);
  if (publishedAt) params.set("f_TPR", publishedAt);
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

function detectLocationFromPrompt(prompt: string): string | undefined {
  const m = prompt.match(/(?:em|in)\s+([^,.\n]+)/i);
  return m ? m[1].trim() : undefined;
}

function extractRoleFromPrompt(prompt: string): string | undefined {
  // tenta capturar "vaga de X" ou "de X em Y" ou "para X"
  const patterns = [
    /vaga\s+de\s+([^,.\n]+?)(?=\s+em\s+|$)/i,
    /de\s+([^,.\n]+?)\s+em\s+/i,
    /para\s+([^,.\n]+?)(?=\s+em\s+|$)/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return undefined;
}

function normalizeKeywords(keywords: string[] | undefined, prompt: string): string[] {
  const stop = new Set([
    "quero","procuro","busco","uma","um","vaga","vagas","em","para","de","no","na","o","a",
  ]);
  // se conseguimos extrair cargo diretamente do prompt, prioriza
  const role = extractRoleFromPrompt(prompt);
  const base = role ? [role] : (Array.isArray(keywords) ? keywords : [prompt]);
  const cleaned: string[] = [];
  for (const k of base) {
    const t = String(k)
      .toLowerCase()
      .replace(/["'`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const words = t.split(" ").filter(w => !stop.has(w));
    if (words.length) cleaned.push(words.join(" "));
  }
  // remove duplicados e itens muito curtos
  const unique = Array.from(new Set(cleaned)).filter(s => s.length >= 3);
  return unique.length ? unique : [prompt.trim()];
}

async function refinePromptWithGroq(prompt: string): Promise<RefineResponse> {
  if (!GROQ_API_KEY) {
    // Fallback simples quando não há chave GROQ: extrai palavras por espaço e tenta detectar cidade após "em"
    const location = detectLocationFromPrompt(prompt);
    const keywords = normalizeKeywords(undefined, prompt);
    const url = buildLinkedinUrl(keywords, location, "r604800");
    return { keyword: keywords, location, publishedAt: "r604800", startUrls: [{ url }], saveOnlyUniqueItems: false };
  }

  const system = `Transforme pedidos de vagas em JSON para scraper. Regras:
- keyword: EXTRAIA APENAS o cargo/área (sem frases como "quero uma vaga..."). Ex.: ["desenvolvedor web"].
- location: cidade e país, se houver. Ex.: "Lisboa, Portugal".
- publishedAt: r86400 ou r604800.
- startUrls: URL de busca do LinkedIn montada com keywords + location.
- saveOnlyUniqueItems: boolean.
Retorne APENAS JSON válido, sem texto adicional.`;
  const user = `Prompt: "${prompt}"
Exemplos:
- "quero uma vaga de desenvolvedor web em lisboa" -> {"keyword":["desenvolvedor web"],"location":"Lisboa, Portugal","publishedAt":"r604800"}
- "data scientist porto" -> {"keyword":["data scientist"],"location":"Porto, Portugal","publishedAt":"r604800"}
Diretivas:
- Remova palavras de enchimento (quero, vaga, em, para, de etc.).
- keyword deve conter só o cargo (1–3 termos).`;

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "groq/compound-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  const data = await resp.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  let parsed: RefineResponse | null = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    // tentar extrair bloco de JSON
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        parsed = null;
      }
    }
  }
  if (!parsed) {
    // fallback
    const location = detectLocationFromPrompt(prompt);
    const keywords = normalizeKeywords(undefined, prompt);
    const url = buildLinkedinUrl(keywords, location, "r604800");
    return { keyword: keywords, location, publishedAt: "r604800", startUrls: [{ url }], saveOnlyUniqueItems: false };
  }
  // garantir campos mínimos
  const keywords = normalizeKeywords(parsed.keyword, prompt);
  const publishedAt = parsed.publishedAt ?? "r604800";
  const location = parsed.location ?? detectLocationFromPrompt(prompt);
  const startUrls = parsed.startUrls && parsed.startUrls.length ? parsed.startUrls : [{ url: buildLinkedinUrl(keywords, location, publishedAt) }];
  return {
    keyword: keywords,
    location,
    publishedAt,
    startUrls,
    saveOnlyUniqueItems: parsed.saveOnlyUniqueItems ?? false,
  };
}

async function ensureLinkedinSource() {
  const sourceName = "linkedin_jobs_apify";
  const { data: existing, error: selErr } = await supabase
    .from("scrape_sources")
    .select("id")
    .eq("name", sourceName)
    .limit(1)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing?.id) return existing.id as number;
  const { data: inserted, error: insErr } = await supabase
    .from("scrape_sources")
    .insert({ name: sourceName, base_url: "https://www.linkedin.com", type: "linkedin" })
    .select("id")
    .single();
  if (insErr) throw insErr;
  return inserted.id as number;
}

async function upsertIngestedJobs(sourceId: number, items: ApifyJobItem[]) {
  const rows = items.map((item: ApifyJobItem) => ({
    external_id: item.id ?? item.jobId ?? item.url ?? item.link ?? null,
    source_id: sourceId,
    raw: item,
  }));
  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from("ingested_jobs").upsert(chunk);
    if (error) console.error("[scrape-linkedin-jobs] upsert chunk error", error);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const incoming = (await req.json()) as (ScrapeInput & { prompt?: string });

    // Se veio um prompt livre, refinar com Groq e montar o input do Actor
    let input: ScrapeInput = incoming;
    let refineStatus: "ia" | "fallback" | "none" = "none";
    if (incoming.prompt && incoming.prompt.trim().length > 0) {
      const refined = await refinePromptWithGroq(incoming.prompt.trim());
      console.log("[scrape-linkedin-jobs] refined", refined);
      refineStatus = GROQ_API_KEY ? "ia" : "fallback";
      const kws = normalizeKeywords(refined.keyword, incoming.prompt);
      input = {
        startUrls: refined.startUrls && refined.startUrls.length ? refined.startUrls : [{ url: buildLinkedinUrl(kws, refined.location, refined.publishedAt) }],
        keyword: kws,
        search: kws.join(" "),
        position: kws.join(" "),
        location: refined.location,
        publishedAt: refined.publishedAt,
        saveOnlyUniqueItems: refined.saveOnlyUniqueItems,
      };
    }

    const sourceId = await ensureLinkedinSource();

    const run = await startActorRun(input);
    if (!run?.id) {
      return new Response(JSON.stringify({ error: "Falha ao iniciar Actor", detail: run }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { status, defaultDatasetId } = await pollRun(run.id);
    if (status !== "SUCCEEDED" || !defaultDatasetId) {
      return new Response(
        JSON.stringify({ error: "Run não concluído com sucesso", status, defaultDatasetId }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const items = await fetchDatasetItems(defaultDatasetId);
    await upsertIngestedJobs(sourceId, items);

    return new Response(JSON.stringify({ status, defaultDatasetId, count: items.length, items, refinedInput: input, refineStatus }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[scrape-linkedin-jobs] error", err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});