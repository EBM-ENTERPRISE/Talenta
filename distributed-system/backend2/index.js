const express = require('express');
const { createClient } = require('@supabase/supabase-js');
// const cors = require('cors'); // CORS handled by Load Balancer (Nginx)
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
// app.use(cors()); // Disable to avoid duplicate headers with Nginx

// Configuration for Supabase 2 (Secondary)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase credentials for Backend 2');
}

// Proxy para Supabase
app.use('/', createProxyMiddleware({
  target: SUPABASE_URL,
  changeOrigin: true,
  pathRewrite: {
    '^/': '/',
  },
  onProxyReq: (proxyReq, req, res) => {
    // Log Especial para Edge Functions
    if (req.url.includes('/functions/v1/')) {
      const functionName = req.url.split('/').pop();
      console.log(`\n⚡️ [Backend 2] EDGE FUNCTION ACIONADA: ${functionName.toUpperCase()} ⚡️`);
      console.log(`   -> Redirecionando para: ${SUPABASE_URL}${req.url}\n`);
    } else {
      console.log(`[Backend 2] Proxying request to: ${req.url}`);
    }
  },
  onError: (err, req, res) => {
    console.error('[Backend 2] Proxy Error:', err);
    res.status(500).send('Proxy Error');
  }
}));

const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
  console.log(`Backend 2 listening on port ${PORT} acting as Proxy for ${SUPABASE_URL}`);
});
