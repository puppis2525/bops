import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { Queue } from './queue.mjs';
import { WixReader, uuid, appAuthorization } from './wix.mjs';
import { createSupportServer } from './server.mjs';

process.umask(0o077);
const command = process.argv[2] || 'serve';
const demo = command === 'demo';
const site = demo ? '00000000-0000-0000-0000-000000000001' : uuid(process.env.WIX_SUPPORT_SITE_ID);
const dbPath = resolve(process.env.SUPPORT_DB || '.data/evil-apples-support/' + (demo ? 'demo.sqlite' : 'queue.sqlite'));
const queue = new Queue(dbPath);
const authorization = !demo && process.env.WIX_SUPPORT_APP_ID
  ? appAuthorization(process.env.WIX_SUPPORT_APP_ID, process.env.WIX_SUPPORT_APP_SECRET, process.env.WIX_SUPPORT_INSTANCE_ID)
  : process.env.WIX_SUPPORT_AUTH;
const reader = demo ? null : new WixReader(site, authorization);

try {
  if (demo) {
    queue.sync(site, '00000000-0000-0000-0000-000000000002', [{
      id: '90071992547409931', sequence: '90071992547409931', direction: 'PARTICIPANT_TO_BUSINESS',
      createdDate: '2026-11-03T20:00:00Z', content: { contentType: 'BASIC', basic: { items: [{ text: 'The answer screen does not load in a game with my friends.' }] } }
    }]);
  }
  if (command === 'sync') {
    const conversation = uuid(process.argv[3]);
    const messages = await reader.snapshot(conversation);
    const result = queue.sync(site, conversation, messages);
    console.log(JSON.stringify({ id: result.id, category: result.category, state: result.state }));
    queue.close();
  } else if (command === 'list') {
    console.log(JSON.stringify(queue.list(), null, 2)); queue.close();
  } else if (command === 'serve' || demo) {
    const port = Number(process.env.SUPPORT_PORT || 3221);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
    const publicKey = process.env.WIX_SUPPORT_PUBLIC_KEY_FILE ? readFileSync(process.env.WIX_SUPPORT_PUBLIC_KEY_FILE, 'utf8') : undefined;
    const { server } = createSupportServer({ queue, reader, site, demo, token: process.env.SUPPORT_REVIEW_PASSWORD,
      publicKey, instanceId: process.env.WIX_SUPPORT_INSTANCE_ID, webhookHost: process.env.SUPPORT_WEBHOOK_HOST });
    server.listen(port, '127.0.0.1', () => console.log('Support review: http://127.0.0.1:' + port + (demo ? ' (synthetic demo)' : '')));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { queue.close(); process.exit(0); }));
  } else { throw new Error('Commands: demo, serve, sync <conversation-id>, list'); }
} catch (error) {
  queue.close(); console.error(error.message); process.exitCode = 1;
}
