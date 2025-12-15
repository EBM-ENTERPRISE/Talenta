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
