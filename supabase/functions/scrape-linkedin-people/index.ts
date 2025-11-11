// Supabase Edge Function para scrapper de perfis (LinkedIn) via Apify
// Executa no ambiente de funções do Supabase (Deno).

// @ts-expect-error: Import remoto usado no runtime Deno das Edge Functions
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Declaração mínima para satisfazer o TypeScript local; no deploy, o runtime é Deno
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve: (handler: (req: Request) => Promise<Response> | Response) => void;
};

type PeopleInput = {
  locations?: string[];
  maxItems?: number;
  profileScraperMode?: string; // "Short" | "Full"
  recentlyChangedJobs?: boolean;
  startPage?: number;
  searchQuery?: string;
};

const APIFY_TOKEN = Deno.env.get("APIFY_API_TOKEN");
const ACTOR_ID = Deno.env.get("APIFY_PEOPLE_ACTOR") || "M2FMdjRVeF1HPGFcc";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

if (!APIFY_TOKEN) console.error("[scrape-linkedin-people] Missing APIFY_API_TOKEN secret");
if (!SUPABASE_URL) console.error("[scrape-linkedin-people] Missing SUPABASE_URL secret");
if (!SUPABASE_SERVICE_ROLE_KEY) console.error("[scrape-linkedin-people] Missing SUPABASE_SERVICE_ROLE key");
if (!SUPABASE_ANON_KEY) console.warn("[scrape-linkedin-people] Missing SUPABASE_ANON_KEY; authenticated logging will be disabled");

const supabase = createClient(String(SUPABASE_URL), String(SUPABASE_SERVICE_ROLE_KEY));

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ensureLocations(loc: unknown): string[] {
  if (Array.isArray(loc)) {
    const arr = loc
      .map(v => String(v || "").trim())
      .filter(v => v.length > 0);
    return arr.length ? arr : [];
  }
  if (typeof loc === "string") {
    const s = loc.trim();
    return s ? [s] : [];
  }
  return [];
}

function normalizeMode(mode: unknown): string {
  const s = String(mode || "").trim().toLowerCase();
  if (s === "full") return "Full";
  return "Short"; // default
}

async function startActorRun(input: PeopleInput) {
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
    console.error("[scrape-linkedin-people] Falha ao parsear resposta do Apify", e);
  }
  if (!resp.ok) {
    console.error("[scrape-linkedin-people] Apify start falhou", { status: resp.status, body: json });
  } else {
    console.log("[scrape-linkedin-people] Apify start OK", { status: resp.status });
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

async function fetchDatasetItems(datasetId: string): Promise<unknown[]> {
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&format=json`;
  const resp = await fetch(url);
  const itemsJson = (await resp.json()) as unknown;
  return Array.isArray(itemsJson) ? (itemsJson as unknown[]) : [];
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
    const incoming = (await req.json()) as PeopleInput;
    const input: PeopleInput = {
      locations: ensureLocations(incoming.locations),
      maxItems: typeof incoming.maxItems === "number" ? incoming.maxItems : 20,
      profileScraperMode: normalizeMode(incoming.profileScraperMode),
      recentlyChangedJobs: Boolean(incoming.recentlyChangedJobs),
      startPage: typeof incoming.startPage === "number" ? incoming.startPage : 1,
      searchQuery: typeof incoming.searchQuery === "string" ? incoming.searchQuery : undefined,
    };

    console.log("[scrape-linkedin-people] actor input", input);

    const run = await startActorRun(input);
    if (!run?.id) {
      return new Response(JSON.stringify({ error: "Falha ao iniciar Actor", detail: run }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { status, defaultDatasetId } = await pollRun(run.id);
    if (status !== "SUCCEEDED" || !defaultDatasetId) {
      return new Response(JSON.stringify({ error: "Run não finalizou com sucesso", status, datasetId: defaultDatasetId }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const items = await fetchDatasetItems(defaultDatasetId);
    return new Response(JSON.stringify({ status, datasetId: defaultDatasetId, items }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e) {
    console.error("[scrape-linkedin-people] erro inesperado", e);
    return new Response(JSON.stringify({ error: "Erro interno", message: String((e as Error)?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});