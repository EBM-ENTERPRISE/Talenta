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
  location?: string;
  publishedAt?: string;
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

if (!APIFY_TOKEN) console.error("[scrape-linkedin-jobs] Missing APIFY_API_TOKEN secret");
if (!SUPABASE_URL) console.error("[scrape-linkedin-jobs] Missing SUPABASE_URL secret");
if (!SUPABASE_SERVICE_ROLE_KEY) console.error("[scrape-linkedin-jobs] Missing SUPABASE_SERVICE_ROLE key");

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
    const input = (await req.json()) as ScrapeInput;

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

    return new Response(JSON.stringify({ status, defaultDatasetId, count: items.length, items }), {
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