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

// Tipo mínimo para resposta de Chat Completions da OpenAI que usamos
type OpenAIChatCompletion = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string; type?: string; code?: string };
};

const APIFY_TOKEN = Deno.env.get("APIFY_API_TOKEN");
// Support both correct and legacy env var names for the Apify Actor ID
const ACTOR_ID = Deno.env.get("APIFY_API_ACTOR") || Deno.env.get("APIFY_API_ATOR") || "2rJKkhh7vjpX7pvjg";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

if (!APIFY_TOKEN) console.error("[scrape-linkedin-jobs] Missing APIFY_API_TOKEN secret");
if (!SUPABASE_URL) console.error("[scrape-linkedin-jobs] Missing SUPABASE_URL secret");
if (!SUPABASE_SERVICE_ROLE_KEY) console.error("[scrape-linkedin-jobs] Missing SUPABASE_SERVICE_ROLE key");
if (!OPENAI_API_KEY) console.warn("[scrape-linkedin-jobs] Missing OPENAI_API_KEY; prompt refinement will be skipped");
if (!SUPABASE_ANON_KEY) console.warn("[scrape-linkedin-jobs] Missing SUPABASE_ANON_KEY; authenticated logging will be disabled");

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
  let json: unknown = null;
  try {
    json = await resp.json();
  } catch (e) {
    console.error("[startActorRun] Falha ao parsear resposta do Apify", e);
  }
  if (!resp.ok) {
    console.error("[startActorRun] Apify start falhou", { status: resp.status, body: json });
  } else {
    console.log("[startActorRun] Apify start OK", { status: resp.status });
  }
  const data = (json as { data?: unknown })?.data as { id?: string } | undefined;
  return data;
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

function ensureStartUrls(
  current: unknown,
  keywords: string[],
  location?: string,
  publishedAt?: string,
): { url: string }[] {
  const defUrl = buildLinkedinUrl(keywords, location, publishedAt || "r604800");
  // Array de strings
  if (Array.isArray(current) && current.every(v => typeof v === 'string')) {
    const arr = (current as string[]).filter(u => typeof u === 'string' && u.trim().length > 0).map(u => ({ url: String(u).trim() }));
    return arr.length ? arr : [{ url: defUrl }];
  }
  // Array de objetos { url }
  if (Array.isArray(current) && current.every(v => typeof v === 'object' && v != null)) {
    const arr = (current as Array<{ url?: string }>).map(o => ({ url: String(o.url || '').trim() })).filter(o => o.url.length > 0);
    return arr.length ? arr : [{ url: defUrl }];
  }
  // Objeto simples { url }
  if (current && typeof current === 'object' && (current as { url?: string }).url) {
    const u = String((current as { url?: string }).url || '').trim();
    return u ? [{ url: u }] : [{ url: defUrl }];
  }
  // String simples
  if (typeof current === 'string') {
    const u = String(current).trim();
    return u ? [{ url: u }] : [{ url: defUrl }];
  }
  // Fallback
  return [{ url: defUrl }];
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

function normalizeJobItem(item: ApifyJobItem): ApifyJobItem {
  const isGeneric = (t?: string) => {
    const s = (t || '').trim().toLowerCase();
    return !s || s === 'vaga' || s.length <= 3;
  };
  const pickTitle = () => {
    if (!isGeneric(item.title)) return item.title as string;
    const jt = (item as Record<string, unknown>)['jobTitle'];
    if (typeof jt === 'string' && !isGeneric(jt)) return jt;
    if (!isGeneric(item.position)) return item.position as string;
    // tenta primeira linha da descrição
    const desc = String(item.description || item.snippet || '').trim();
    const firstLine = desc.split(/\n|\.\s/)[0];
    if (firstLine && !isGeneric(firstLine)) return firstLine;
    return item.title || item.position || 'Vaga';
  };
  // de-dup de localização tipo "Lisboa, Lisbon, Portugal"
  const normalizedLocation = (() => {
    const loc = String(item.location || '').trim();
    if (!loc) return item.location;
    // remove duplicatas de cidade em PT/EN
    const parts = loc.split(',').map(p => p.trim());
    const seen = new Set<string>();
    const filtered = parts.filter(p => {
      const key = p.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return filtered.join(', ');
  })();

  return {
    ...item,
    title: pickTitle(),
    location: normalizedLocation,
  };
}

async function fetchWithTimeout(url: string, ms = 3000): Promise<Response | null> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(id);
    return res;
  } catch {
    clearTimeout(id);
    return null;
  }
}

function cleanTitleText(txt: string): string {
  let t = txt.trim();
  // remove sufixos comuns
  t = t.replace(/\s*[|\-–—]\s*[^|\-–—]+$/u, '').trim();
  t = t.replace(/\s*\([^)]*\)\s*$/, '').trim();
  // colapsa espaços
  t = t.replace(/\s+/g, ' ');
  return t;
}

function extractTitleFromHtml(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  if (og && og[1]) {
    const t = cleanTitleText(og[1]);
    if (t && t.length > 3) return t;
  }
  const mt = html.match(/<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  if (mt && mt[1]) {
    const t = cleanTitleText(mt[1]);
    if (t && t.length > 3) return t;
  }
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1 && h1[1]) {
    const t = cleanTitleText(h1[1]);
    if (t && t.length > 3) return t;
  }
  const h2 = html.match(/<h2[^>]*>([^<]+)<\/h2>/i);
  if (h2 && h2[1]) {
    const t = cleanTitleText(h2[1]);
    if (t && t.length > 3) return t;
  }
  const ti = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (ti && ti[1]) {
    const t = cleanTitleText(ti[1]);
    if (t && t.length > 3) return t;
  }
  return null;
}

async function enrichGenericTitles(items: ApifyJobItem[], max = 5): Promise<ApifyJobItem[]> {
  const isGeneric = (t?: string) => {
    const s = (t || '').trim().toLowerCase();
    return !s || s === 'vaga' || s.length <= 3;
  };
  let count = 0;
  for (let i = 0; i < items.length && count < max; i++) {
    const it = items[i];
    if (!isGeneric(it.title)) continue;
    const url = String(it.applyUrl || it.url || it.link || '').trim();
    if (!url) continue;
    const res = await fetchWithTimeout(url, 3000);
    if (!res || !res.ok) continue;
    const html = await res.text();
    const t = extractTitleFromHtml(html);
    if (t && !isGeneric(t)) {
      it.title = t;
      count++;
    }
  }
  return items;
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
      // evita termos com ponto que possam confundir sistemas de busca (ex.: node.js)
      .replace(/\./g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const words = t.split(" ").filter(w => !stop.has(w));
    if (words.length) cleaned.push(words.join(" "));
  }
  // remove duplicados e itens muito curtos
  const unique = Array.from(new Set(cleaned)).filter(s => s.length >= 3);
  return unique.length ? unique : [prompt.trim()];
}

async function refinePromptWithOpenAI(prompt: string): Promise<RefineResponse> {
  if (!OPENAI_API_KEY) {
    // Fallback simples quando não há chave GROQ: extrai palavras por espaço e tenta detectar cidade após "em"
    console.warn("[refinePromptWithOpenAI] OPENAI_API_KEY ausente; usando fallback simples");
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

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
    }),
  });
  const t0 = Date.now();
  console.log("[refinePromptWithOpenAI] chamada OpenAI enviada", { model: "gpt-4o-mini", promptChars: prompt.length });
  let data: unknown;
  try {
    data = await resp.json();
  } catch (e) {
    console.error("[refinePromptWithOpenAI] falha ao ler JSON da OpenAI", e);
    const location = detectLocationFromPrompt(prompt);
    const keywords = normalizeKeywords(undefined, prompt);
    const url = buildLinkedinUrl(keywords, location, "r604800");
    return { keyword: keywords, location, publishedAt: "r604800", startUrls: [{ url }], saveOnlyUniqueItems: false };
  }
  console.log("[refinePromptWithOpenAI] resposta OpenAI", { ok: resp.ok, status: resp.status, durationMs: Date.now() - t0 });
  if (!resp.ok) {
    const errInfo = (data as OpenAIChatCompletion)?.error;
    console.warn("[refinePromptWithOpenAI] OpenAI retornou status não-sucesso", { status: resp.status, error: errInfo });
    const location = detectLocationFromPrompt(prompt);
    const keywords = normalizeKeywords(undefined, prompt);
    const url = buildLinkedinUrl(keywords, location, "r604800");
    return { keyword: keywords, location, publishedAt: "r604800", startUrls: [{ url }], saveOnlyUniqueItems: false };
  }
  const content: string = ((data as OpenAIChatCompletion)?.choices?.[0]?.message?.content) ?? "";
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
    console.warn("[refinePromptWithOpenAI] falha ao parsear conteúdo da OpenAI; usando fallback", { contentPreview: content.slice(0, 120) });
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

async function upsertIngestedJobs(sourceId: number, items: ApifyJobItem[]): Promise<string[]> {
  const rows = items.map((item: ApifyJobItem) => ({
    id: crypto.randomUUID(),
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
  return rows.map(r => r.id as string);
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

    // Se veio um prompt livre, refinar com OpenAI e montar o input do Actor
    let input: ScrapeInput = incoming;
    let refineStatus: "ia" | "fallback" | "none" = "none";
    if (incoming.prompt && incoming.prompt.trim().length > 0) {
      const refined = await refinePromptWithOpenAI(incoming.prompt.trim());
      console.log("[scrape-linkedin-jobs] refined", refined);
      refineStatus = OPENAI_API_KEY ? "ia" : "fallback";
      const kws = normalizeKeywords(refined.keyword, incoming.prompt);
      input = {
        startUrls: ensureStartUrls(refined.startUrls, kws, refined.location, refined.publishedAt),
        keyword: kws,
        search: kws.join(" "),
        position: kws.join(" "),
        location: refined.location,
        publishedAt: refined.publishedAt,
        saveOnlyUniqueItems: refined.saveOnlyUniqueItems,
      };
    }

    // Normaliza startUrls também quando veio input manual sem prompt
    const kwsForEnsure = normalizeKeywords(input.keyword, incoming.prompt ?? input.search ?? "");
    input.startUrls = ensureStartUrls(input.startUrls, kwsForEnsure, input.location, input.publishedAt);

    console.log("[scrape-linkedin-jobs] actor input", {
      startUrls: input.startUrls,
      keyword: input.keyword,
      search: input.search,
      location: input.location,
      publishedAt: input.publishedAt,
    });

    // Insert search row for authenticated users (RLS enforced via anon token)
    let searchId: string | null = null;
    const authed = getAuthedClient(req);
    if (authed && (incoming.prompt || input.search)) {
      const { data: userRes } = await authed.auth.getUser();
      const userId = userRes?.user?.id;
      if (userId) {
        const constraints = {
          refinedInput: input,
          refineStatus,
        } as Record<string, unknown>;
        const { data: inserted, error: insertErr } = await authed
          .from("searches")
          .insert({
            user_id: userId,
            target: "job",
            prompt: incoming.prompt ?? input.search ?? "",
            constraints,
            status: "running",
          })
          .select("id")
          .single();
        if (insertErr) {
          console.warn("[scrape-linkedin-jobs] failed to insert search", insertErr.message);
        } else {
          searchId = inserted?.id ?? null;
        }
      }
    }

    const sourceId = await ensureLinkedinSource();

    const run = await startActorRun(input);
    if (!run?.id) {
      // mark search as failed if applicable
      if (authed && searchId) {
        await authed
          .from("searches")
          .update({ status: "failed", constraints: { refinedInput: input, refineStatus, error: "Falha ao iniciar Actor", runDetail: run } })
          .eq("id", searchId);
      }
      return new Response(JSON.stringify({ error: "Falha ao iniciar Actor", detail: run }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { status, defaultDatasetId } = await pollRun(run.id);
    if (status !== "SUCCEEDED" || !defaultDatasetId) {
      if (authed && searchId) {
        await authed
          .from("searches")
          .update({ status: "failed", constraints: { refinedInput: input, refineStatus, status, defaultDatasetId } })
          .eq("id", searchId);
      }
      return new Response(
        JSON.stringify({ error: "Run não concluído com sucesso", status, defaultDatasetId }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const items = await fetchDatasetItems(defaultDatasetId);
    const normalizedItems = items.map(normalizeJobItem);
    await enrichGenericTitles(normalizedItems, 5);
    const ingestedIds = await upsertIngestedJobs(sourceId, normalizedItems);

    // Se houver busca autenticada, salva resultados vinculando ao item ingerido
    if (searchId) {
      const resultsRows = normalizedItems.map((item, idx) => ({
        search_id: searchId,
        target_type: 'job',
        target_id: ingestedIds[idx],
        rank: idx + 1,
        data: item,
      }));
      const chunkSize = 200;
      for (let i = 0; i < resultsRows.length; i += chunkSize) {
        const chunk = resultsRows.slice(i, i + chunkSize);
        const { error } = await supabase.from('search_results').upsert(chunk);
        if (error) console.error('[scrape-linkedin-jobs] insert search_results error', error);
      }
    }

    // update search status to done with metadata
    if (authed && searchId) {
      await authed
        .from("searches")
        .update({ status: "done", constraints: { refinedInput: input, refineStatus, defaultDatasetId, count: normalizedItems.length } })
        .eq("id", searchId);
    }

    return new Response(JSON.stringify({ status, defaultDatasetId, count: normalizedItems.length, items: normalizedItems, refinedInput: input, refineStatus, searchId }), {
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
function getAuthedClient(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createClient(String(SUPABASE_URL), String(SUPABASE_ANON_KEY), {
    global: { headers: { Authorization: auth } },
  });
}