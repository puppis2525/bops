import { verify } from 'node:crypto';

export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('Invalid Wix identifier');
  return value;
}

// Only these GET paths exist in this adapter. It has no send/mutation operation.
export class WixReader {
  constructor(site, authorization, fetcher = fetch) {
    this.site = uuid(site); this.authorization = authorization; this.fetcher = fetcher;
  }
  async read(path) {
    if (!this.authorization) throw new Error('Wix runtime credential is not configured');
    const response = await this.fetcher('https://www.wixapis.com/inbox/v2/' + path, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: this.authorization, 'wix-site-id': this.site }
    });
    if (!response.ok) throw new Error('Wix read failed: HTTP ' + response.status);
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error('Wix response too large');
    return JSON.parse(text);
  }
  async snapshot(conversation) {
    uuid(conversation);
    const metadata = await this.read('conversations/' + conversation);
    if (metadata.conversation?.id !== conversation) throw new Error('Wix conversation mismatch');
    const messages = []; const seen = new Set(); let cursor;
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({ conversationId: conversation, visibility: 'BUSINESS_AND_PARTICIPANT' });
      if (cursor) query.set('paging.cursor', cursor);
      const response = await this.read('messages?' + query);
      if (!Array.isArray(response.messages)) throw new Error('Wix message response malformed');
      messages.push(...response.messages);
      const next = response.pagingMetadata?.cursors?.next;
      if (!next) return messages;
      if (seen.has(next)) throw new Error('Wix repeated pagination cursor');
      seen.add(next); cursor = next;
    }
    throw new Error('Wix pagination limit exceeded; snapshot not applied');
  }
}

// REST webhook envelope per Wix docs. Public key and installation are configured
// independently of the event body; remote key URLs and alternate algorithms fail.
export function webhookConversation(token, publicKey, instanceId, now = Date.now() / 1000) {
  if (!publicKey || !instanceId) throw new Error('Webhook integration is disabled');
  const parts = token.trim().split('.');
  if (parts.length !== 3) throw new Error('Invalid webhook token');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  if (header.alg !== 'RS256' || header.crit) throw new Error('Unsupported webhook signature');
  if (!verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), publicKey, Buffer.from(parts[2], 'base64url'))) throw new Error('Invalid webhook signature');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (claims.exp !== undefined && (!Number.isFinite(claims.exp) || claims.exp <= now)) throw new Error('Expired webhook');
  if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now + 30)) throw new Error('Webhook not yet valid');
  const event = JSON.parse(claims.data);
  if (event.instanceId !== instanceId) throw new Error('Webhook installation mismatch');
  const data = JSON.parse(event.data);
  if (data.entityFqdn !== 'wix.crm.inbox.v2.message' || data.slug !== 'message_sent_to_business') throw new Error('Unsupported webhook event');
  if (typeof data.id !== 'string' || !data.id || data.id.length > 200) throw new Error('Missing event ID');
  const body = data.actionEvent?.body;
  if (body?.message?.direction !== 'PARTICIPANT_TO_BUSINESS') throw new Error('Not an inbound message');
  return { eventId: data.id, conversation: uuid(body.conversationId) };
}
