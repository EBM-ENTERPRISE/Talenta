const http = require('http');
const https = require('https');

function request(method, url, headers, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const options = { method, hostname: u.hostname, port: u.port, path: u.pathname + (u.search || ''), headers };
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const token = process.env.TEST_AUTH_TOKEN || '';
  if (!token) {
    console.log('SKIP: TEST_AUTH_TOKEN ausente');
    const s1 = await request('GET', 'http://localhost:3061/replication/status', {}, null);
    const s2 = await request('GET', 'http://localhost:3062/replication/status', {}, null);
    console.log(s1.body);
    console.log(s2.body);
    return;
  }
  const payload = { target: 'job', prompt: 'Engenheiro em Lisboa', items: [{ title: 'Dev', location: 'Lisboa', applyUrl: 'https://example.com/job/1' }], constraints: {} };
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const r = await request('POST', 'http://localhost:9090/api/functions/v1/save-search', headers, payload);
  console.log('save-search:', r.status, r.body);
  const s1 = await request('GET', 'http://localhost:3061/replication/status', {}, null);
  const s2 = await request('GET', 'http://localhost:3062/replication/status', {}, null);
  console.log('backend-1:', s1.status, s1.body);
  console.log('backend-2:', s2.status, s2.body);
}

main();
