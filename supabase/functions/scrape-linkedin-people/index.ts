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
  searchId?: string;
};

const APIFY_TOKEN = Deno.env.get("APIFY_API_TOKEN");
const ACTOR_ID = Deno.env.get("APIFY_PEOPLE_ACTOR") || "M2FMdjRVeF1HPGFcc";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const GOOGLE_CSE_KEY = Deno.env.get("GOOGLE_CSE_API_KEY");
const GOOGLE_CSE_CX = Deno.env.get("GOOGLE_CSE_CX");

if (!APIFY_TOKEN) console.error("[scrape-linkedin-people] Missing APIFY_API_TOKEN secret");
if (!SUPABASE_URL) console.error("[scrape-linkedin-people] Missing SUPABASE_URL secret");
if (!SUPABASE_SERVICE_ROLE_KEY) console.error("[scrape-linkedin-people] Missing SUPABASE_SERVICE_ROLE key");
if (!SUPABASE_ANON_KEY) console.warn("[scrape-linkedin-people] Missing SUPABASE_ANON_KEY; authenticated logging will be disabled");
if (!GOOGLE_CSE_KEY || !GOOGLE_CSE_CX) console.warn("[scrape-linkedin-people] Google CSE credentials not set; Apify will be used if available");

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

function buildGoogleQuery(input: PeopleInput): string {
  const q: string[] = [];
  if (input.searchQuery && input.searchQuery.trim()) q.push(input.searchQuery.trim());
  if (Array.isArray(input.locations) && input.locations.length) q.push(input.locations.join(" "));
  q.push("site:linkedin.com/in");
  return q.join(" ").trim();
}

function extractPublicIdentifier(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex(p => p.toLowerCase() === "in");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    return null;
  } catch {
    return null;
  }
}

function capitalizeNameSlug(slug: string): string {
  const parts = slug.split('-').filter(p => p && !/\d/.test(p));
  if (!parts.length) return slug;
  return parts.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}

function extractNameFromTitle(title: string): string | null {
  let t = title || '';
  t = t.replace(/\s*\|\s*LinkedIn.*$/i, '').replace(/\s*-\s*LinkedIn.*$/i, '');
  const byHyphen = t.split(/\s*-\s*/);
  if (byHyphen.length >= 1 && byHyphen[0].trim().length > 0) {
    const candidate = byHyphen[0].trim();
    if (/^[a-zA-ZÀ-ÿ' ]{3,}$/.test(candidate)) return candidate;
  }
  const byPipe = t.split(/\s*\|\s*/);
  if (byPipe.length >= 1 && byPipe[0].trim().length > 0) {
    const candidate = byPipe[0].trim();
    if (/^[a-zA-ZÀ-ÿ' ]{3,}$/.test(candidate)) return candidate;
  }
  return null;
}

async function fetchGoogleCse(input: PeopleInput): Promise<unknown[]> {
  if (!GOOGLE_CSE_KEY || !GOOGLE_CSE_CX) return [];
  const items: unknown[] = [];
  const max = typeof input.maxItems === "number" ? input.maxItems : 20;
  const startPage = typeof input.startPage === "number" ? input.startPage : 1;
  const perPage = 10;
  let start = (startPage - 1) * perPage + 1;
  while (items.length < max) {
    const q = buildGoogleQuery(input);
    const params = new URLSearchParams({ key: GOOGLE_CSE_KEY, cx: GOOGLE_CSE_CX, q, start: String(start), num: String(perPage) });
    const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
    const resp = await fetch(url);
    if (!resp.ok) break;
    const json = await resp.json();
    const pageItems = Array.isArray(json?.items) ? json.items : [];
    if (pageItems.length === 0) break;
    for (const it of pageItems) {
      const link = String(it?.link || "");
      const title = String(it?.title || "");
      const snippet = String(it?.snippet || "");
      const publicIdentifier = link ? extractPublicIdentifier(link) : null;
      const fromTitle = extractNameFromTitle(title);
      const fromSlug = publicIdentifier ? capitalizeNameSlug(publicIdentifier) : null;
      const name = fromTitle || fromSlug || null;
      items.push({ profileUrl: link, title, snippet, publicIdentifier, name });
      if (items.length >= max) break;
    }
    start += perPage;
  }
  return items;
}

function sanitizeStr(s: string): string {
  return String(s || '').replace(/^\s*[`'"]?\s*/, '').replace(/\s*[`'"]?\s*$/, '').trim();
}

function composeNameFromItem(item: Record<string, unknown>): string | null {
  const first = typeof item['firstName'] === 'string' ? sanitizeStr(item['firstName'] as string) : '';
  const last = typeof item['lastName'] === 'string' ? sanitizeStr(item['lastName'] as string) : '';
  const full = typeof item['fullName'] === 'string' ? sanitizeStr(item['fullName'] as string) : '';
  if ((first || last) && (first + ' ' + last).trim().length >= 3) return (first + ' ' + last).trim();
  if (full && full.length >= 3) return full;
  const pid = typeof item['publicIdentifier'] === 'string' ? sanitizeStr(item['publicIdentifier'] as string) : '';
  if (pid) return capitalizeNameSlug(pid);
  const t = typeof item['title'] === 'string' ? sanitizeStr(item['title'] as string) : '';
  const byTitle = extractNameFromTitle(t);
  return byTitle;
}

function ensureProfileUrlFromItem(item: Record<string, unknown>): string | null {
  const direct = ['linkedinUrl','profileUrl','link','url'].map(k => typeof item[k] === 'string' ? sanitizeStr(item[k] as string) : '').find(v => v && v.length > 0) || '';
  if (direct) return direct;
  const pid = typeof item['publicIdentifier'] === 'string' ? sanitizeStr(item['publicIdentifier'] as string) : '';
  return pid ? `https://www.linkedin.com/in/${pid}` : null;
}

function augmentApifyItems(items: unknown[]): unknown[] {
  return items.map((raw: unknown) => {
    const obj = (raw ?? {}) as Record<string, unknown>;
    const name = composeNameFromItem(obj);
    const profileUrl = ensureProfileUrlFromItem(obj);
    const headline = typeof obj['headline'] === 'string' ? sanitizeStr(obj['headline'] as string) : undefined;
    if (name || profileUrl || headline) {
      return { ...obj, name: name ?? obj['name'], profileUrl: profileUrl ?? obj['profileUrl'], headline: headline ?? obj['headline'] };
    }
    return obj;
  });
}

async function ensureLinkedinSource(): Promise<number | null> {
  const name = "linkedin_people";
  const base_url = "https://www.linkedin.com";
  const type = "linkedin";
  const { data: existing } = await supabase
    .from("scrape_sources")
    .select("id")
    .eq("name", name)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id as number;
  const { data: inserted } = await supabase
    .from("scrape_sources")
    .insert({ name, base_url, type })
    .select("id")
    .maybeSingle();
  return inserted?.id ? (inserted.id as number) : null;
}

function guessExternalId(obj: Record<string, unknown>): string | null {
  const idKeys = ["id", "publicIdentifier", "linkedinUrl", "profileUrl", "link", "url"];
  for (const k of idKeys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return sanitizeStr(v as string);
  }
  return null;
}

function parseDate(apifyDate: unknown): string | null {
  if (typeof apifyDate === "string") {
    const d = new Date(apifyDate);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  if (apifyDate && typeof apifyDate === "object") {
    const o = apifyDate as Record<string, unknown>;
    const y = typeof o["year"] === "number" ? o["year"] as number : undefined;
    const m = typeof o["month"] === "number" ? o["month"] as number : undefined;
    if (y) {
      const mm = m && m >= 1 && m <= 12 ? String(m).padStart(2, "0") : "01";
      return `${y}-${mm}-01`;
    }
  }
  return null;
}

async function upsertProfiles(items: unknown[]): Promise<string[]> {
  const rows = items.map((raw: unknown) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const first = typeof o["firstName"] === "string" ? sanitizeStr(o["firstName"] as string) : "";
    const last = typeof o["lastName"] === "string" ? sanitizeStr(o["lastName"] as string) : "";
    const full_name = (first || last) ? `${first}${first && last ? " " : ""}${last}` : (typeof o["name"] === "string" ? sanitizeStr(o["name"] as string) : null);
    const headline = typeof o["headline"] === "string" ? sanitizeStr(o["headline"] as string) : null;
    const locObj = o["location"] as Record<string, unknown> | undefined;
    let location: string | null = null;
    if (locObj && typeof locObj === "object") {
      const parsed = locObj["parsed"] as Record<string, unknown> | undefined;
      const txt = typeof locObj["linkedinText"] === "string" ? sanitizeStr(locObj["linkedinText"] as string) : null;
      const ptxt = parsed && typeof parsed["text"] === "string" ? sanitizeStr(parsed["text"] as string) : null;
      location = ptxt || txt || null;
    } else if (typeof o["location"] === "string") {
      location = sanitizeStr(o["location"] as string);
    }
    return { full_name, headline, location };
  });
  const { data } = await supabase
    .from("profiles")
    .insert(rows)
    .select("id");
  const ids = Array.isArray(data) ? data.map(r => r.id as string) : [];
  return ids;
}

async function upsertIngestedProfiles(sourceId: number, items: unknown[], profileIds: string[]): Promise<string[]> {
  const rows = items.map((raw: unknown, idx: number) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const external_id = guessExternalId(o);
    return { external_id, source_id: sourceId, profile_id: profileIds[idx] || null, raw: o };
  });
  const chunks: typeof rows[] = [];
  const size = 200;
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  const insertedIds: string[] = [];
  for (const ch of chunks) {
    const { data } = await supabase
      .from("ingested_profiles")
      .insert(ch)
      .select("id");
    if (Array.isArray(data)) insertedIds.push(...data.map(r => r.id as string));
  }
  return insertedIds;
}

async function upsertExperiences(items: unknown[], profileIds: string[]): Promise<void> {
  const rows: { profile_id: string; title: string; company: string | null; start_date: string | null; end_date: string | null; location: string | null; description: string | null }[] = [];
  items.forEach((raw, idx) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const arr = Array.isArray(o["experience"]) ? (o["experience"] as unknown[]) : [];
    arr.forEach((e: unknown) => {
      const ex = (e ?? {}) as Record<string, unknown>;
      const title = typeof ex["position"] === "string" ? sanitizeStr(ex["position"] as string) : "";
      const company = typeof ex["companyName"] === "string" ? sanitizeStr(ex["companyName"] as string) : null;
      const location = typeof ex["location"] === "string" ? sanitizeStr(ex["location"] as string) : null;
      const description = typeof ex["description"] === "string" ? sanitizeStr(ex["description"] as string) : null;
      const start_date = parseDate(ex["startDate"]);
      const end_date = parseDate(ex["endDate"]);
      if (title && profileIds[idx]) rows.push({ profile_id: profileIds[idx], title, company, start_date, end_date, location, description });
    });
  });
  if (rows.length) {
    const chunks: typeof rows[] = [];
    const size = 200;
    for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
    for (const ch of chunks) {
      await supabase.from("experiences").insert(ch);
    }
  }
}

async function upsertEducation(items: unknown[], profileIds: string[]): Promise<void> {
  const rows: { profile_id: string; school: string; degree: string | null; field: string | null; start_date: string | null; end_date: string | null }[] = [];
  items.forEach((raw, idx) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const arrTop = Array.isArray(o["profileTopEducation"]) ? (o["profileTopEducation"] as unknown[]) : [];
    const arrOther = Array.isArray(o["education"]) ? (o["education"] as unknown[]) : [];
    const arr = [...arrTop, ...arrOther];
    arr.forEach((e: unknown) => {
      const ed = (e ?? {}) as Record<string, unknown>;
      const school = typeof ed["schoolName"] === "string" ? sanitizeStr(ed["schoolName"] as string) : (typeof ed["school"] === "string" ? sanitizeStr(ed["school"] as string) : "");
      const degree = typeof ed["degree"] === "string" ? sanitizeStr(ed["degree"] as string) : null;
      const field = typeof ed["field"] === "string" ? sanitizeStr(ed["field"] as string) : null;
      const start_date = parseDate(ed["startDate"]);
      const end_date = parseDate(ed["endDate"]);
      if (school && profileIds[idx]) rows.push({ profile_id: profileIds[idx], school, degree, field, start_date, end_date });
    });
  });
  if (rows.length) {
    const chunks: typeof rows[] = [];
    const size = 200;
    for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
    for (const ch of chunks) {
      await supabase.from("education").insert(ch);
    }
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

    let items: unknown[] = [];
    let status = "SUCCEEDED";
    let datasetId: string | null = null;
    if (APIFY_TOKEN && ACTOR_ID) {
      const run = await startActorRun(input);
      if (run?.id) {
        const polled = await pollRun(run.id);
        status = polled.status || status;
        datasetId = polled.defaultDatasetId || datasetId;
        if (status === "SUCCEEDED" && datasetId) {
          items = await fetchDatasetItems(datasetId);
          items = augmentApifyItems(items);
        }
      }
    }
    if (!items.length) {
      items = await fetchGoogleCse(input);
      datasetId = datasetId || null;
      status = items.length ? "SUCCEEDED" : "FAILED";
    }
    const count = Array.isArray(items) ? items.length : 0;
    let searchId: string | undefined = input.searchId;
    try {
      if (count > 0) {
        const sourceId = await ensureLinkedinSource();
        if (sourceId) {
          const profileIds = await upsertProfiles(items);
          const ingestedIds = await upsertIngestedProfiles(sourceId, items, profileIds);
          const authHeader = req.headers.get("Authorization") || undefined;
          const authed = createClient(String(SUPABASE_URL), authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : String(SUPABASE_ANON_KEY));
          const { data: user } = await authed.auth.getUser();
          const uid = user?.user?.id || null;
          if (uid) {
            const { data: createdSearch } = await supabase
              .from("searches")
              .insert({ user_id: uid, target: "profile", prompt: input.searchQuery || "", status: "done" })
              .select("id")
              .maybeSingle();
            searchId = createdSearch?.id || searchId;
            if (searchId) {
              const resultRows = ingestedIds.map((ingId, idx) => ({
                search_id: searchId,
                target_type: "profile",
                target_id: profileIds[idx] || ingId,
                rank: idx + 1,
                data: items[idx] as Record<string, unknown>,
              }));
              const chunks: typeof resultRows[] = [];
              const size = 200;
              for (let i = 0; i < resultRows.length; i += size) chunks.push(resultRows.slice(i, i + size));
              for (const ch of chunks) {
                await supabase.from("search_results").insert(ch);
              }
            }
          }
          await upsertExperiences(items, profileIds);
          await upsertEducation(items, profileIds);
        }
      }
    } catch (_e) { void 0; }
    return new Response(JSON.stringify({ status, datasetId, items, count, searchId }), {
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