const express = require('express');
const { createClient } = require('@supabase/supabase-js');
// const cors = require('cors'); // CORS handled by Load Balancer (Nginx)
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
// app.use(cors()); // Disable to avoid duplicate headers with Nginx

// Configuration for Supabase 1 (Primary)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase credentials for Backend 1');
}

// Proxy para Supabase
// Qualquer requisição que chegar aqui será repassada para o Supabase Real
// Isso obriga o frontend a passar por este container
app.use('/', createProxyMiddleware({
  target: SUPABASE_URL,
  changeOrigin: true,
  pathRewrite: {
    '^/': '/', // Mantém o path original
  },
  onProxyReq: (proxyReq, req, res) => {
    // Adiciona a chave de API se não vier do cliente (opcional, mas bom pra segurança)
    // proxyReq.setHeader('apikey', SUPABASE_KEY);
    // proxyReq.setHeader('Authorization', `Bearer ${SUPABASE_KEY}`);
    console.log(`[Backend 1] Proxying request to: ${req.url}`);
  },
  onError: (err, req, res) => {
    console.error('[Backend 1] Proxy Error:', err);
    res.status(500).send('Proxy Error');
  }
}));

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Backend 1 listening on port ${PORT} acting as Proxy for ${SUPABASE_URL}`);
});
