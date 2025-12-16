const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
app.use(cors());

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

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: SERVICE_NAME });
});

// --- REPLICATION LOGIC ---
const TABLE_NAME = 'searches';
const jsonParser = bodyParser.json();

// --- EDGE FUNCTION INTERCEPTION (For Backend 2) ---
if (SERVICE_NAME === 'Backend-2') {
    const BACKEND_1_SUPABASE_URL = 'https://rnininxlmxdmcjooqwkc.supabase.co'; // Hardcoded or via ENV
    const BACKEND_1_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJuaW5pbnhsbXhkbWNqb29xd2tjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3MzM0NjcsImV4cCI6MjA3NTMwOTQ2N30.u3CByXWF-0KYXwiG0B8xp8_EfsCGDBXqh5oWFDBUPD8';

    // 1. Intercept "search-router" and "scrape-*" functions
    // We proxy these to Backend 1 because we want to use ITS logic/functions.
    const functionsToProxy = ['search-router', 'scrape-linkedin-jobs', 'scrape-linkedin-people'];
    
    functionsToProxy.forEach(funcName => {
        app.use(`/functions/v1/${funcName}`, createProxyMiddleware({
            target: BACKEND_1_SUPABASE_URL,
            changeOrigin: true,
            pathRewrite: (path, req) => {
                // Express strips the mount path, so 'path' here is relative (e.g., '/' or '/?query=...')
                // We need to reconstruct the full path for the target
                const queryString = path.includes('?') ? path.substring(path.indexOf('?')) : '';
                return `/functions/v1/${funcName}${queryString}`;
            },
            headers: {
                Authorization: `Bearer ${BACKEND_1_ANON_KEY}`,
                apikey: BACKEND_1_ANON_KEY
            },
            onProxyReq: (proxyReq, req, res) => {
                console.log(`[${SERVICE_NAME}] Proxying function ${funcName} to Backend 1`);
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
             // Ensure Host header matches the target Supabase project
             const targetHost = new URL(SUPABASE_URL).host;
             proxyReq.setHeader('Host', targetHost);
        }
    });

    // Mount on /functions/v1 so it handles calls like /functions/v1/search-router
    app.use('/functions/v1', genericProxy);
}

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

// --- PROXY LOGIC ---
// Forward everything else to Supabase
app.use('/', createProxyMiddleware({
    target: SUPABASE_URL,
    changeOrigin: true,
    ws: true,
    logLevel: 'debug',
    onProxyReq: (proxyReq, req, res) => {
        // Add auth header if missing or modify if needed
        // But usually the client sends the Key
        console.log(`[${SERVICE_NAME}] Proxying ${req.method} ${req.url} to Supabase`);
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

app.listen(PORT, () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}`);
  runSyncLoop();
});
