// Supabase Edge Function para salvar resultados da pesquisa no banco
// Recebe target (job|profile), prompt, items e constraints opcionais.

// @ts-expect-error: Import remoto usado no runtime Deno das Edge Functions
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve: (handler: (req: Request) => Promise<Response> | Response) => void;
};

type Target = 'job' | 'profile';

type SaveBody = {
  target: Target;
  prompt: string;
  items: unknown[]; // lista exibida na UI
  constraints?: Record<string, unknown> | null;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

if (!SUPABASE_URL) console.error("[save-search] Missing SUPABASE_URL secret");
if (!SUPABASE_SERVICE_ROLE_KEY) console.error("[save-search] Missing SUPABASE_SERVICE_ROLE key");
if (!SUPABASE_ANON_KEY) console.warn("[save-search] Missing SUPABASE_ANON_KEY; authenticated logging may be disabled");

const serviceClient = createClient(String(SUPABASE_URL), String(SUPABASE_SERVICE_ROLE_KEY));

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getAuthedClient(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createClient(String(SUPABASE_URL), String(SUPABASE_ANON_KEY), {
    global: { headers: { Authorization: auth } },
  });
}

async function ensureSourceId(target: Target): Promise<number> {
  const sourceName = target === 'job' ? 'linkedin_jobs_apify' : 'linkedin_people_apify';
  const { data: existing, error: selErr } = await serviceClient
    .from("scrape_sources")
    .select("id")
    .eq("name", sourceName)
    .limit(1)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing?.id) return existing.id as number;
  const { data: inserted, error: insErr } = await serviceClient
    .from("scrape_sources")
    .insert({ name: sourceName, base_url: "https://www.linkedin.com", type: "linkedin" })
    .select("id")
    .single();
  if (insErr) throw insErr;
  return inserted.id as number;
}

function getPropAsString(obj: Record<string, unknown>, key: string): string | null {
  const val = obj[key];
  if (typeof val === 'string') {
    const s = val.trim();
    return s ? s : null;
  }
  if (typeof val === 'number') {
    return String(val);
  }
  return null;
}

function guessExternalId(item: Record<string, unknown>): string | null {
  const keys = ['id', 'jobId', 'url', 'link', 'profileUrl', 'publicIdentifier'];
  for (const k of keys) {
    const s = getPropAsString(item, k);
    if (s && s.trim().length > 0) return s;
  }
  return null;
}

function sanitizeStr(s: string | null): string | null {
  if (!s) return null;
  return s.replace(/^\s*[`'"]?\s*/, '').replace(/\s*[`'"]?\s*$/, '').trim() || null;
}

function composeNameFromItem(item: Record<string, unknown>): string | null {
  const first = sanitizeStr(getPropAsString(item, 'firstName'));
  const last = sanitizeStr(getPropAsString(item, 'lastName'));
  const full = sanitizeStr(getPropAsString(item, 'fullName'));
  if ((first || last) && ((first || '') + ' ' + (last || '')).trim().length >= 3) return ((first || '') + ' ' + (last || '')).trim();
  if (full && full.length >= 3) return full;
  const name = sanitizeStr(getPropAsString(item, 'name'));
  return name;
}

function extractLocation(item: Record<string, unknown>): string | null {
  const loc = item['location'];
  if (typeof loc === 'string') return sanitizeStr(loc);
  if (loc && typeof loc === 'object') {
    const o = loc as Record<string, unknown>;
    const parsed = o['parsed'] as Record<string, unknown> | undefined;
    const txt = typeof o['linkedinText'] === 'string' ? sanitizeStr(o['linkedinText'] as string) : null;
    const ptxt = parsed && typeof parsed['text'] === 'string' ? sanitizeStr(parsed['text'] as string) : null;
    return ptxt || txt || null;
  }
  return null;
}

function parseDate(obj: unknown): string | null {
  if (typeof obj === 'string') {
    const d = new Date(obj);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>;
    const y = o['year'] as number | undefined;
    const m = o['month'] as number | undefined;
    if (typeof y === 'number') {
      const mm = typeof m === 'number' && m >= 1 && m <= 12 ? String(m).padStart(2, '0') : '01';
      return `${y}-${mm}-01`;
    }
  }
  return null;
}

async function upsertProfiles(items: unknown[]): Promise<string[]> {
  const rows = items.map((raw: unknown) => {
    const obj = (raw ?? {}) as Record<string, unknown>;
    const full_name = composeNameFromItem(obj);
    const headline = sanitizeStr(getPropAsString(obj, 'headline'));
    const location = extractLocation(obj);
    return { full_name, headline, location };
  });
  const { data } = await serviceClient
    .from('profiles')
    .insert(rows)
    .select('id');
  const ids = Array.isArray(data) ? data.map(r => String(r.id)) : [];
  return ids;
}

async function upsertExperiences(items: unknown[], profileIds: string[]): Promise<void> {
  const rows: { profile_id: string; title: string; company: string | null; start_date: string | null; end_date: string | null; location: string | null; description: string | null }[] = [];
  items.forEach((raw, idx) => {
    const obj = (raw ?? {}) as Record<string, unknown>;
    const arr = Array.isArray(obj['experience']) ? (obj['experience'] as unknown[]) : [];
    arr.forEach((e) => {
      const ex = (e ?? {}) as Record<string, unknown>;
      const title = sanitizeStr(getPropAsString(ex, 'position')) || '';
      const company = sanitizeStr(getPropAsString(ex, 'companyName'));
      const location = sanitizeStr(getPropAsString(ex, 'location'));
      const description = sanitizeStr(getPropAsString(ex, 'description'));
      const start_date = parseDate(ex['startDate']);
      const end_date = parseDate(ex['endDate']);
      if (title && profileIds[idx]) rows.push({ profile_id: profileIds[idx], title, company, start_date, end_date, location, description });
    });
  });
  if (rows.length) {
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await serviceClient.from('experiences').insert(chunk);
    }
  }
}

async function upsertEducation(items: unknown[], profileIds: string[]): Promise<void> {
  const rows: { profile_id: string; school: string; degree: string | null; field: string | null; start_date: string | null; end_date: string | null }[] = [];
  items.forEach((raw, idx) => {
    const obj = (raw ?? {}) as Record<string, unknown>;
    const top = Array.isArray(obj['profileTopEducation']) ? (obj['profileTopEducation'] as unknown[]) : [];
    const edu = Array.isArray(obj['education']) ? (obj['education'] as unknown[]) : [];
    [...top, ...edu].forEach((e) => {
      const ed = (e ?? {}) as Record<string, unknown>;
      const school = sanitizeStr(getPropAsString(ed, 'schoolName')) || sanitizeStr(getPropAsString(ed, 'school')) || '';
      const degree = sanitizeStr(getPropAsString(ed, 'degree'));
      const field = sanitizeStr(getPropAsString(ed, 'field'));
      const start_date = parseDate(ed['startDate']);
      const end_date = parseDate(ed['endDate']);
      if (school && profileIds[idx]) rows.push({ profile_id: profileIds[idx], school, degree, field, start_date, end_date });
    });
  });
  if (rows.length) {
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await serviceClient.from('education').insert(chunk);
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
    const authed = getAuthedClient(req);
    if (!authed) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const body = (await req.json()) as SaveBody;
    const target: Target = body.target === 'profile' ? 'profile' : 'job';
    const prompt = String(body.prompt || '').trim();
    const items = Array.isArray(body.items) ? body.items : [];
    const constraints = body.constraints ?? null;

    if (!prompt) {
      return new Response(JSON.stringify({ error: "Prompt ausente" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    if (items.length === 0) {
      return new Response(JSON.stringify({ error: "Sem itens para salvar" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { data: userRes } = await authed.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "Sessão inválida" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const sourceId = await ensureSourceId(target);

    // Ingest items to ingested_jobs or ingested_profiles
    const ingestedIds: string[] = [];
    const chunkSize = 200;
    if (target === 'job') {
      const rows = items.map((raw: unknown) => {
        const obj = (raw ?? {}) as Record<string, unknown>;
        return {
          id: crypto.randomUUID(),
          external_id: guessExternalId(obj),
          source_id: sourceId,
          raw: obj,
        } as Record<string, unknown>;
      });
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await serviceClient.from('ingested_jobs').upsert(chunk);
        if (error) console.error('[save-search] upsert ingested_jobs error', error);
      }
      ingestedIds.push(...rows.map(r => String(r.id)));
    } else {
      const profileIds = await upsertProfiles(items);
      const rows = items.map((raw: unknown, idx: number) => {
        const obj = (raw ?? {}) as Record<string, unknown>;
        return {
          id: crypto.randomUUID(),
          external_id: guessExternalId(obj),
          source_id: sourceId,
          profile_id: profileIds[idx] || null,
          raw: obj,
        } as Record<string, unknown>;
      });
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await serviceClient.from('ingested_profiles').upsert(chunk);
        if (error) console.error('[save-search] upsert ingested_profiles error', error);
      }
      ingestedIds.push(...rows.map(r => String(r.id)));
      await upsertExperiences(items, profileIds);
      await upsertEducation(items, profileIds);
      const resultsRows = items.map((item, idx) => ({
        search_id: '',
        target_type: target,
        target_id: profileIds[idx] || ingestedIds[idx],
        rank: idx + 1,
        data: item,
      }));
    }

    // Create the search row as a snapshot
    const { data: inserted, error: insertErr } = await authed
      .from('searches')
      .insert({
        user_id: userId,
        target: target,
        prompt,
        constraints: constraints,
        status: 'done',
      })
      .select('id')
      .single();
    if (insertErr) {
      console.error('[save-search] insert searches error', insertErr);
      return new Response(JSON.stringify({ error: 'Falha ao salvar pesquisa', detail: insertErr.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    const searchId = inserted?.id as string;

    // Save results linked to ingested ids
    const resultsRows = items.map((item, idx) => ({
      search_id: searchId,
      target_type: target,
      target_id: target === 'profile' ? undefined : ingestedIds[idx],
      rank: idx + 1,
      data: item,
    }));
    if (target === 'profile') {
      const { data: latestProfiles } = await serviceClient
        .from('profiles')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(items.length);
      const profileIds = Array.isArray(latestProfiles) ? latestProfiles.map(r => String(r.id)) : [];
      for (let i = 0; i < resultsRows.length; i++) {
        (resultsRows[i] as Record<string, unknown>).target_id = profileIds[i] || ingestedIds[i];
      }
    }
    for (let i = 0; i < resultsRows.length; i += chunkSize) {
      const chunk = resultsRows.slice(i, i + chunkSize);
      const { error } = await serviceClient.from('search_results').upsert(chunk);
      if (error) console.error('[save-search] insert search_results error', error);
    }

    return new Response(JSON.stringify({ ok: true, searchId, count: items.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[save-search] error', err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
});


// Resultado da api -> base de dados -> CSP 