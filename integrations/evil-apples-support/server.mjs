import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { webhookConversation } from './wix.mjs';

function authorized(header, token) {
  const expected = 'Basic ' + Buffer.from('review:' + token).toString('base64');
  const actual = Buffer.from(header || ''); const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}
async function readBody(req, limit = 256000) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createSupportServer({ queue, reader, site, token, demo = false, publicKey, instanceId, webhookHost }) {
  if (typeof token !== 'string' || token.length < 24) throw new Error('Set a review password of at least 24 characters');
  const html = readFileSync(new URL('./review.html', import.meta.url));
  const js = readFileSync(new URL('./review.js', import.meta.url));
  const css = readFileSync(new URL('./review.css', import.meta.url));
  let working = false;
  async function work() {
    if (working) return;
    working = true;
    try {
      const job = queue.nextJob();
      if (job) {
        try {
          const messages = await reader.snapshot(job.conversation);
          queue.sync(site, job.conversation, messages);
          queue.finishJob(job.event_id);
        } catch { queue.failJob(job.event_id); }
      }
    } finally { working = false; }
  }
  const server = createServer(async (req, res) => {
    const send = (status, value, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        'Referrer-Policy': 'no-referrer' });
      res.end(type === 'application/json' ? JSON.stringify(value) : value);
    };
    const localHost = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '');
    try {
      const path = new URL(req.url, 'http://127.0.0.1').pathname;
      if (path === '/hooks/wix' && req.method === 'POST') {
        if (demo || !publicKey || !instanceId || !reader) return send(503, { error: 'Webhook not configured' });
        if (!localHost && req.headers.host !== webhookHost) return send(403, { error: 'Host rejected' });
        if (req.headers['content-type']?.split(';')[0] !== 'text/plain') return send(415, { error: 'Expected signed token as text/plain' });
        let event;
        try { event = webhookConversation(await readBody(req), publicKey, instanceId); }
        catch { return send(400, { error: 'Webhook verification failed' }); }
        queue.enqueue(event.eventId, event.conversation);
        return send(200, { received: true });
      }
      if (!localHost) return send(403, { error: 'Review is available on loopback only' });
      if (!authorized(req.headers.authorization, token)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Evil Apples Support Review", charset="UTF-8"');
        return send(401, { error: 'Authentication required; username: review' });
      }
      if (req.method === 'GET' && path === '/') return send(200, html, 'text/html; charset=utf-8');
      if (req.method === 'GET' && path === '/review.js') return send(200, js, 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && path === '/review.css') return send(200, css, 'text/css; charset=utf-8');
      if (req.method === 'GET' && path === '/api/cases') return send(200, { cases: queue.list(), jobs: queue.jobs(), demo });
      const match = path.match(/^\/api\/cases\/(\d+)$/);
      if (match && req.method === 'GET') {
        const item = queue.get(Number(match[1]));
        return send(item ? 200 : 404, item || { error: 'Case not found' });
      }
      if (match && req.method === 'POST') {
        if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) return send(403, { error: 'Origin rejected' });
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(415, { error: 'JSON required' });
        const input = JSON.parse(await readBody(req, 20000));
        const id = Number(match[1]);
        const item = queue.get(id);
        if (!item) return send(404, { error: 'Case not found' });
        if (input.action === 'approve' && !demo) {
          // Approval never sends. A failed read blocks approval; changed context
          // invalidates the submitted revision before the transaction below.
          const messages = await reader.snapshot(item.conversation);
          queue.sync(site, item.conversation, messages);
        }
        return send(200, queue.review(id, input.revision, input.action, input.draft));
      }
      return send(404, { error: 'Not found' });
    } catch (error) {
      const conflict = error.message.startsWith('Conflict:');
      send(conflict ? 409 : 400, { error: conflict ? error.message : 'Operation failed; input or Wix connection needs attention' });
    }
  });
  const interval = setInterval(() => { void work(); }, 2000);
  interval.unref();
  server.on('close', () => clearInterval(interval));
  return { server, work };
}
