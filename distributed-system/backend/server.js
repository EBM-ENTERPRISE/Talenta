const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
app.use(cors());
// IMPORTANT: Do NOT use bodyParser globally if we are proxying, as it consumes the stream.
// We only apply bodyParser to our internal routes.

const PORT = process.env.PORT || 3000;
const SERVICE_NAME = process.env.SERVICE_NAME || 'Unknown Service';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
// Optional override for Edge Functions
const EDGE_FUNCTION_URL = process.env.EDGE_FUNCTION_URL || SUPABASE_URL;
const EDGE_FUNCTION_KEY = process.env.EDGE_FUNCTION_KEY || SUPABASE_KEY;

const PEER_URL = process.env.PEER_URL; // URL of the other backend for replication

console.log(`Starting ${SERVICE_NAME}...`);
console.log(`Connecting to Supabase: ${SUPABASE_URL}`);
if (EDGE_FUNCTION_URL !== SUPABASE_URL) {
    console.log(`Using separate Edge Functions: ${EDGE_FUNCTION_URL}`);
}

// Initialize Supabase Client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: SERVICE_NAME });
});

// --- REPLICATION LOGIC ---
// List of tables to sync, in dependency order (parents first)
const TABLES_TO_SYNC = [
    'organizations',
    'scrape_sources',
    'searches',
    'ingested_jobs',
    'ingested_profiles',
    'experiences',
    'education',
    'search_results',
    'scrape_queue',
    'reports'
];

const jsonParser = bodyParser.json();

app.get('/internal/sync-pull', jsonParser, async (req, res) => {
    try {
        const tableName = req.query.table;
        const lastSyncTime = req.query.since;

        if (!TABLES_TO_SYNC.includes(tableName)) {
            return res.status(400).json({ error: `Invalid table: ${tableName}` });
        }

        let query = supabase.from(tableName).select('*').order('created_at', { ascending: true });
        
        if (lastSyncTime) {
            query = query.gt('created_at', lastSyncTime);
        } else {
            query = query.limit(50); // Increased limit slightly
        }

        const { data, error } = await query;
        if (error) throw error;

        res.json({ data, service: SERVICE_NAME, table: tableName });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- PROXY LOGIC ---

// 1. Specific Proxy for Edge Functions (Force routing to EDGE_FUNCTION_URL)
app.use('/functions/v1', createProxyMiddleware({
    target: EDGE_FUNCTION_URL,
    changeOrigin: true,
    ws: true,
    logLevel: 'debug',
    onProxyReq: (proxyReq, req, res) => {
        console.log(`[${SERVICE_NAME}] Proxying Edge Function ${req.method} ${req.url} to ${EDGE_FUNCTION_URL}`);
    }
}));

// --- PROXY LOGIC ---

// 1. Specific Proxy for Edge Functions (/functions/v1/*)
// If EDGE_FUNCTION_URL is set, we route these requests there.
app.use('/functions/v1', createProxyMiddleware({
    target: EDGE_FUNCTION_URL,
    changeOrigin: true,
    ws: true,
    logLevel: 'debug',
    pathRewrite: {
        '^/functions/v1': '/functions/v1', // Keep the path
    },
    onProxyReq: (proxyReq, req, res) => {
        console.log(`[${SERVICE_NAME}] Proxying Edge Function ${req.method} ${req.url} to ${EDGE_FUNCTION_URL}`);
        
        // If we are using a different project for Edge Functions, we MUST use its key.
        if (EDGE_FUNCTION_KEY && EDGE_FUNCTION_KEY !== SUPABASE_KEY) {
            console.log(`[${SERVICE_NAME}] Swapping Auth headers for Edge Function call`);
            proxyReq.setHeader('Authorization', `Bearer ${EDGE_FUNCTION_KEY}`);
            proxyReq.setHeader('apikey', EDGE_FUNCTION_KEY);
        }
    }
}));

// 2. Default Proxy for everything else (Database, Auth, etc.)
// Forward everything else to the main Supabase instance
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

    // Track the latest timestamp we have locally for each table
    const lastSyncMap = {};

    // Initialize lastSyncMap
    for (const table of TABLES_TO_SYNC) {
        try {
            const { data } = await supabase.from(table).select('created_at').order('created_at', { ascending: false }).limit(1);
            if (data && data.length > 0) {
                lastSyncMap[table] = data[0].created_at;
                console.log(`[${SERVICE_NAME}] Initial sync time for ${table}: ${lastSyncMap[table]}`);
            } else {
                lastSyncMap[table] = null;
            }
        } catch (e) {
            console.warn(`[${SERVICE_NAME}] Could not get local max time for ${table}:`, e.message);
            lastSyncMap[table] = null;
        }
    }

    setInterval(async () => {
        for (const table of TABLES_TO_SYNC) {
            try {
                const lastSyncedAt = lastSyncMap[table];
                const url = `${PEER_URL}/internal/sync-pull?table=${table}${lastSyncedAt ? `&since=${lastSyncedAt}` : ''}`;
                
                // Short timeout to prevent hanging
                const response = await axios.get(url, { timeout: 5000 });
                
                const newItems = response.data.data;
                if (newItems && newItems.length > 0) {
                    console.log(`[${SERVICE_NAME}] Found ${newItems.length} new items for ${table} from peer. Syncing...`);
                    
                    // Upsert to local DB
                    const { error } = await supabase.from(table).upsert(newItems, { onConflict: 'id', ignoreDuplicates: true });
                    
                    if (error) {
                        console.error(`[${SERVICE_NAME}] Sync Insert Error (${table}):`, error.message);
                    } else {
                        // console.log(`[${SERVICE_NAME}] Successfully synced ${newItems.length} items for ${table}.`);
                        // Update lastSyncedAt to the latest one we got
                        const latest = newItems[newItems.length - 1];
                        if (latest && latest.created_at) {
                            lastSyncMap[table] = latest.created_at;
                        }
                    }
                }
            } catch (err) {
                // Silent fail mostly, to avoid log spam if peer is down or table is empty/missing
                // console.warn(`[${SERVICE_NAME}] Sync Check Failed for ${table}:`, err.message);
            }
        }
    }, 10000); // Check every 10 seconds (slower loop for multi-table)
}

app.listen(PORT, () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}`);
  runSyncLoop();
});
