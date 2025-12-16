const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { createProxyMiddleware } = require('http-proxy-middleware');
const crypto = require('crypto');

const app = express();
app.use(cors());

app.use('/api', (req, res, next) => {
    req.url = '/' + req.url.replace(/^\//, '');
    next();
});

// DEBUG: Log all requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// IMPORTANT: Do NOT use bodyParser globally if we are proxying, as it consumes the stream.
// We only apply bodyParser to our internal routes.

const PORT = process.env.PORT || 3000;
const SERVICE_NAME = process.env.SERVICE_NAME || 'Unknown Service';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PEER_URL = process.env.PEER_URL; // URL of the other backend for replication

console.log(`Starting ${SERVICE_NAME}...`);
console.log(`Connecting to Supabase: ${SUPABASE_URL}`);

// Initialize Supabase Client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function getProjectRefFromApiKey(key) {
  try {
    if (!key) return null;
    if (key.startsWith('sb_publishable_')) {
      return 'yvniowvaxuupfwgknzvy';
    }
    const payload = key.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return json.ref || null;
  } catch (_) {
    return null;
  }
}

function chooseSupabaseTarget(req) {
  const incomingKey = req.headers['apikey'] || req.headers['x-apikey'] || null;
  const ref = getProjectRefFromApiKey(incomingKey);
  if (ref === 'rnininxlmxdmcjooqwkc') return 'https://rnininxlmxdmcjooqwkc.supabase.co';
  if (ref === 'yvniowvaxuupfwgknzvy') return 'https://yvniowvaxuupfwgknzvy.supabase.co';
  return SUPABASE_URL;
}

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: SERVICE_NAME });
});

// --- REPLICATION LOGIC ---
const TABLE_NAME = 'searches';
const jsonParser = bodyParser.json();

async function applyIdempotency(supabaseClient, opId, source) {
  const { data } = await supabaseClient
    .from('replication_operations')
    .select('operation_id')
    .eq('operation_id', opId)
    .maybeSingle();
  if (data && data.operation_id) {
    return false;
  }
  await supabaseClient
    .from('replication_operations')
    .insert({ operation_id: opId, source });
  return true;
}

async function replicateToPeer(url, body, headers) {
  let delay = 250;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await axios.post(url, body, { headers, timeout: 2000 });
      return true;
    } catch (e) {
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
  return false;
}

// --- EDGE FUNCTION INTERCEPTION (For Backend 2) ---
if (SERVICE_NAME === 'Backend-2') {
    const BACKEND_1_SUPABASE_URL = 'https://rnininxlmxdmcjooqwkc.supabase.co'; // Hardcoded or via ENV
    const BACKEND_1_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJuaW5pbnhsbXhkbWNqb29xd2tjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3MzM0NjcsImV4cCI6MjA3NTMwOTQ2N30.u3CByXWF-0KYXwiG0B8xp8_EfsCGDBXqh5oWFDBUPD8';

    // 1. Intercept "search-router" and "scrape-*" functions
    // We proxy these to Backend 1 because we want to use ITS logic/functions.
    const functionsToProxy = ['search-router', 'scrape-linkedin-jobs', 'scrape-linkedin-people'];
    
    functionsToProxy.forEach(funcName => {
        app.use(`/functions/v1/${funcName}`, createProxyMiddleware({
            target: PEER_URL || 'http://backend-1:3000',
            changeOrigin: true,
            pathRewrite: (path, req) => {
                const queryString = path.includes('?') ? path.substring(path.indexOf('?')) : '';
                return `/functions/v1/${funcName}${queryString}`;
            },
            onProxyReq: (proxyReq, req, res) => {
                console.log(`[${SERVICE_NAME}] Proxying function ${funcName} to Backend 1 (${PEER_URL})`);
                proxyReq.setHeader('apikey', BACKEND_1_ANON_KEY);
                if (req.headers.authorization) {
                    proxyReq.setHeader('authorization', req.headers.authorization);
                }
            }
        }));
    });

    // 2. Intercept "save-search"
    // We do NOT proxy this. We handle it locally so data is saved in Backend 2.
    // We emulate the behavior of the edge function.
    app.post('/functions/v1/save-search', jsonParser, async (req, res) => {
        console.log(`[${SERVICE_NAME}] Intercepting save-search to save LOCALLY`);
        
        // CRITICAL: Use the user's Authorization token to bypass RLS (if policy allows auth users)
        // or to properly attribute the record to the user.
        const authHeader = req.headers.authorization;
        const scopedSupabase = authHeader 
            ? createClient(SUPABASE_URL, SUPABASE_KEY, { global: { headers: { Authorization: authHeader } } })
            : supabase; // Fallback to global (anon) if no auth header (might fail RLS)

        try {
            // Retrieve the user from the token to explicitly set user_id
            // This is safer than relying on database defaults, especially if defaults are missing.
            let userId = null;
            if (authHeader) {
                const { data: { user }, error: authError } = await scopedSupabase.auth.getUser();
                if (!authError && user) {
                    userId = user.id;
                } else {
                    console.warn(`[${SERVICE_NAME}] Failed to get user from token:`, authError);
                }
            }

            const { target, prompt, items, constraints } = req.body;
            // Simplified logic of save-search function
            // 1. Create a search record
            const searchPayload = {
                prompt,
                target,
                status: 'done',
                constraints: constraints || {},
            };
            if (userId) {
                searchPayload.user_id = userId;
            }

            const opId = req.headers['x-operation-id'] || crypto.randomUUID();
            const replicatedFrom = req.headers['x-replicated-from'] || null;
            const proceed = await applyIdempotency(scopedSupabase, String(opId), replicatedFrom || SERVICE_NAME);
            if (!proceed) {
                return res.json({ ok: true, dedup: true });
            }

            const { data: searchData, error: searchError } = await scopedSupabase
                .from('searches')
                .insert(searchPayload)
                .select()
                .single();

            if (searchError) throw searchError;

            // 3. Ingest data into normalized tables (ingested_jobs / ingested_profiles)
            // AND update search_results with target_id
            try {
                // Normalize target to handle variations
                const isJob = target === 'job' || target === 'jobs' || target === 'linkedin_jobs';
                const isProfile = target === 'profile' || target === 'people' || target === 'linkedin_people';

                let ingestedIds = [];

                if (isJob && items && items.length > 0) {
                    const jobsToIngest = items.map(item => {
                        const url = item.applyUrl || item.url || item.link;
                        return {
                            raw: item, // Correct schema: raw jsonb
                            external_id: url || item.jobId || null,
                            // source_id: 1 // Assuming 1 exists or is nullable. Let's leave it null for now to be safe.
                        };
                    });

                    if (jobsToIngest.length > 0) {
                        console.log(`[${SERVICE_NAME}] Ingesting ${jobsToIngest.length} jobs...`);
                        const { data: insertedJobs, error: ingestError } = await scopedSupabase
                            .from('ingested_jobs')
                            .insert(jobsToIngest) // Use insert, not upsert, as we don't have a clear unique key on raw/url in schema
                            .select('id');
                        
                        if (ingestError) {
                            console.error(`[${SERVICE_NAME}] Error ingesting jobs:`, ingestError);
                        } else if (insertedJobs) {
                             console.log(`[${SERVICE_NAME}] Jobs ingested successfully.`);
                             ingestedIds = insertedJobs.map(j => j.id);
                        }
                    }
                } else if (isProfile && items && items.length > 0) {
                    const profilesToIngest = items.map(item => {
                        const url = item.profileUrl || item.url || item.link || item.linkedinUrl;
                        return {
                            raw: item, // Correct schema: raw jsonb
                            external_id: item.publicIdentifier || url || null,
                            // source_id: null
                        };
                    });

                    if (profilesToIngest.length > 0) {
                        console.log(`[${SERVICE_NAME}] Ingesting ${profilesToIngest.length} profiles...`);
                        const { data: insertedProfiles, error: ingestError } = await scopedSupabase
                            .from('ingested_profiles')
                            .insert(profilesToIngest)
                            .select('id');
                        
                        if (ingestError) {
                            console.error(`[${SERVICE_NAME}] Error ingesting profiles:`, ingestError);
                        } else if (insertedProfiles) {
                            console.log(`[${SERVICE_NAME}] Profiles ingested successfully.`);
                            ingestedIds = insertedProfiles.map(p => p.id);
                        }
                    }
                }

                // 2. Save individual items to 'search_results' (NOW LINKED)
                if (items && items.length > 0) {
                    const resultsToInsert = items.map((item, index) => ({
                        search_id: searchData.id,
                        rank: index + 1,
                        data: item,
                        target_type: isProfile ? 'profile' : 'job',
                        target_id: ingestedIds[index] || null // Link to ingested item if available
                    }));
                    
                    const { error: resultsError } = await scopedSupabase
                        .from('search_results')
                        .insert(resultsToInsert);
                    
                    if (resultsError) {
                        console.error(`[${SERVICE_NAME}] Error saving results:`, resultsError);
                    }
                }

            } catch (ingestEx) {
                console.error(`[${SERVICE_NAME}] Exception ingesting items:`, ingestEx);
            }

            const outboxInsert = await supabase
              .from('replication_outbox')
              .insert({ operation_id: String(opId), endpoint: '/functions/v1/save-search', method: 'POST', payload: req.body, headers: { authorization: authHeader || null } })
              .select('id')
              .single();

            if (!replicatedFrom && PEER_URL) {
              const headers = { Authorization: authHeader || '', apikey: SUPABASE_KEY, 'X-Operation-Id': String(opId), 'X-Replicated-From': SERVICE_NAME };
              const ok = await replicateToPeer(`${PEER_URL}/functions/v1/save-search`, req.body, headers);
              if (ok && outboxInsert.data && outboxInsert.data.id) {
                await supabase
                  .from('replication_outbox')
                  .update({ status: 'sent', attempts: 1 })
                  .eq('id', outboxInsert.data.id);
              }
            }

            res.json({ ok: true, searchId: searchData.id, count: items?.length || 0 });
        } catch (err) {
            console.error(`[${SERVICE_NAME}] Local save-search error:`, err);
            res.status(500).json({ error: err.message });
        }
    });
} else {
    // --- GENERIC PROXY FOR BACKEND-1 (or others) ---
    // If we are NOT Backend-2, we should proxy requests to our own SUPABASE_URL
    // This allows Frontend-1 (connecting to Backend-1) to reach Supabase Edge Functions transparently.

    console.log(`[${SERVICE_NAME}] Configuring generic proxy to ${SUPABASE_URL}`);
    const genericProxy = createProxyMiddleware({
        target: SUPABASE_URL,
        router: (req) => {
            const target = chooseSupabaseTarget(req);
            console.log(`[${SERVICE_NAME}] Functions router target -> ${target}`);
            return target;
        },
        changeOrigin: true,
        pathRewrite: (path, req) => {
            // Reconstruct path for Supabase Edge Functions
            // Express mount point /functions/v1/ is stripped?
            // Let's verify.
            // If mount is app.use('/functions/v1', ...) and req is /functions/v1/search-router
            // req.path seen by middleware might be /search-router
            
            // http-proxy-middleware logic:
            // if app.use('/api', proxy), req to /api/users -> proxy sees /users
            // target: http://backend
            // result: http://backend/users (default)
            
            // We want https://supabase/functions/v1/search-router
            // So if req.path is /search-router, we need to prepend /functions/v1
            
            return `/functions/v1${path}`;
        },
        onProxyReq: (proxyReq, req, res) => {
             console.log(`[${SERVICE_NAME}] Proxying generic request to ${SUPABASE_URL}/functions/v1${req.path}`);
             const targetHost = new URL(SUPABASE_URL).host;
             proxyReq.setHeader('Host', targetHost);
             const incomingKey = req.headers['apikey'] || req.headers['x-apikey'];
             proxyReq.setHeader('apikey', incomingKey || SUPABASE_KEY);
             if (req.headers.authorization) {
               proxyReq.setHeader('authorization', req.headers.authorization);
             }
        }
    });

    app.use('/functions/v1', genericProxy);
}

// Ensure apikey on OAuth authorize (browser GET lacks headers)
app.get(['/auth/v1/authorize', '/api/auth/v1/authorize'], async (req, res) => {
  try {
    const params = new URLSearchParams(req.query);
    if (!params.has('apikey')) params.set('apikey', SUPABASE_KEY);
    const target = `${SUPABASE_URL}/auth/v1/authorize?${params.toString()}`;
    console.log(`[${SERVICE_NAME}] OAuth authorize redirect -> ${target}`);
    res.redirect(target);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/functions/v1/save-search', jsonParser, async (req, res, next) => {
  if (SERVICE_NAME === 'Backend-2') {
    return next();
  }
  const authHeader = req.headers.authorization;
  const scopedSupabase = authHeader 
    ? createClient(SUPABASE_URL, SUPABASE_KEY, { global: { headers: { Authorization: authHeader } } })
    : supabase;
  try {
    let userId = null;
    if (authHeader) {
      const { data: { user } } = await scopedSupabase.auth.getUser();
      if (user) {
        userId = user.id;
      }
    }
    const { target, prompt, items, constraints } = req.body;
    const payload = { prompt, target, status: 'done', constraints: constraints || {} };
    if (userId) {
      payload.user_id = userId;
    }
    const opId = req.headers['x-operation-id'] || crypto.randomUUID();
    const replicatedFrom = req.headers['x-replicated-from'] || null;
    const proceed = await applyIdempotency(scopedSupabase, String(opId), replicatedFrom || SERVICE_NAME);
    if (!proceed) {
      return res.json({ ok: true, dedup: true });
    }
    const { data: searchData, error: searchError } = await scopedSupabase
      .from('searches')
      .insert(payload)
      .select()
      .single();
    if (searchError) throw searchError;
    const outboxInsert = await supabase
      .from('replication_outbox')
      .insert({ operation_id: String(opId), endpoint: '/functions/v1/save-search', method: 'POST', payload: req.body, headers: { authorization: authHeader || null } })
      .select('id')
      .single();
    if (!replicatedFrom && PEER_URL) {
      const headers = { Authorization: authHeader || '', apikey: SUPABASE_KEY, 'X-Operation-Id': String(opId), 'X-Replicated-From': SERVICE_NAME };
      const ok = await replicateToPeer(`${PEER_URL}/functions/v1/save-search`, req.body, headers);
      if (ok && outboxInsert.data && outboxInsert.data.id) {
        await supabase
          .from('replication_outbox')
          .update({ status: 'sent', attempts: 1 })
          .eq('id', outboxInsert.data.id);
      }
    }
    res.json({ ok: true, searchId: searchData.id, count: items?.length || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/internal/sync-pull', jsonParser, async (req, res) => {
    try {
        const lastSyncTime = req.query.since;
        let query = supabase.from(TABLE_NAME).select('*').order('created_at', { ascending: true });
        
        if (lastSyncTime) {
            query = query.gt('created_at', lastSyncTime);
        } else {
            query = query.limit(20);
        }

        const { data, error } = await query;
        if (error) throw error;

        res.json({ data, service: SERVICE_NAME });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/replication/status', async (req, res) => {
  try {
    const { data: pending } = await supabase
      .from('replication_outbox')
      .select('id')
      .eq('status', 'pending');
    const { data: sent } = await supabase
      .from('replication_outbox')
      .select('id')
      .eq('status', 'sent');
    res.json({ pending: Array.isArray(pending) ? pending.length : 0, sent: Array.isArray(sent) ? sent.length : 0, service: SERVICE_NAME });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- PROXY LOGIC ---
// Forward everything else to Supabase
app.use('/', createProxyMiddleware({
    target: SUPABASE_URL,
    router: (req) => {
        const target = chooseSupabaseTarget(req);
        console.log(`[${SERVICE_NAME}] Router target -> ${target} for ${req.url}`);
        return target;
    },
    changeOrigin: true,
    ws: true,
    logLevel: 'debug',
    onProxyReq: (proxyReq, req, res) => {
        console.log(`[${SERVICE_NAME}] Proxying ${req.method} ${req.url} to Supabase`);
        const isAuth = (req.url || '').startsWith('/auth/v1/');
        const incomingKey = req.headers['apikey'] || req.headers['x-apikey'];
        proxyReq.setHeader('apikey', incomingKey || SUPABASE_KEY);
        if (isAuth) {
            if (req.headers.authorization) {
                proxyReq.setHeader('authorization', req.headers.authorization);
            } else {
                proxyReq.removeHeader && proxyReq.removeHeader('authorization');
            }
        } else {
            proxyReq.setHeader('authorization', `Bearer ${SUPABASE_KEY}`);
        }
    }
}));

// 2. Background Sync Loop
// Periodically checks peer for new data and inserts it locally.
async function runSyncLoop() {
    if (!PEER_URL) return;

    // Track the latest timestamp we have locally to ask peer for newer stuff
    let lastSyncedAt = null;

    // Initial check: get max created_at from local DB
    try {
        const { data } = await supabase.from(TABLE_NAME).select('created_at').order('created_at', { ascending: false }).limit(1);
        if (data && data.length > 0) {
            lastSyncedAt = data[0].created_at;
        }
    } catch (e) {
        console.warn(`[${SERVICE_NAME}] Could not get local max time:`, e.message);
    }

    setInterval(async () => {
        try {
            // console.log(`[${SERVICE_NAME}] Checking peer ${PEER_URL} for updates since ${lastSyncedAt}...`);
            const url = `${PEER_URL}/internal/sync-pull${lastSyncedAt ? `?since=${lastSyncedAt}` : ''}`;
            const response = await axios.get(url, { timeout: 2000 });
            
            const newItems = response.data.data;
            if (newItems && newItems.length > 0) {
                console.log(`[${SERVICE_NAME}] Found ${newItems.length} new items from peer. Syncing...`);
                
                // Upsert to local DB
                const { error } = await supabase.from(TABLE_NAME).upsert(newItems, { onConflict: 'id', ignoreDuplicates: true });
                
                if (error) {
                    console.error(`[${SERVICE_NAME}] Sync Insert Error:`, error.message);
                } else {
                    console.log(`[${SERVICE_NAME}] Successfully synced ${newItems.length} items.`);
                    // Update lastSyncedAt to the latest one we got
                    const latest = newItems[newItems.length - 1];
                    if (latest && latest.created_at) {
                        lastSyncedAt = latest.created_at;
                    }
                }
            }
        } catch (err) {
            // Silent fail mostly, to avoid log spam if peer is down
            // console.warn(`[${SERVICE_NAME}] Sync Check Failed:`, err.message);
        }
    }, 5000); // Check every 5 seconds
}

async function runOutboxWorker() {
  if (!PEER_URL) return;
  setInterval(async () => {
    try {
      const { data } = await supabase
        .from('replication_outbox')
        .select('*')
        .eq('status', 'pending')
        .lt('attempts', 5)
        .order('created_at', { ascending: true })
        .limit(10);
      if (Array.isArray(data)) {
        for (const evt of data) {
          const headers = { Authorization: (evt.headers && evt.headers.authorization) || '', apikey: SUPABASE_KEY, 'X-Operation-Id': evt.operation_id, 'X-Replicated-From': SERVICE_NAME };
          const ok = await replicateToPeer(`${PEER_URL}${evt.endpoint}`, evt.payload, headers);
          if (ok) {
            await supabase
              .from('replication_outbox')
              .update({ status: 'sent', attempts: (evt.attempts || 0) + 1 })
              .eq('operation_id', evt.operation_id);
          } else {
            await supabase
              .from('replication_outbox')
              .update({ attempts: (evt.attempts || 0) + 1 })
              .eq('operation_id', evt.operation_id);
          }
        }
      }
    } catch (_) {}
  }, 5000);
}

app.listen(PORT, () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}`);
  runSyncLoop();
  runOutboxWorker();
});
