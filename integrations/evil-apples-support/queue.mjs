import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export function normalize(messages) {
  if (!Array.isArray(messages) || messages.length > 3000) throw new Error('Invalid message snapshot');
  const rows = messages.map(m => {
    if (typeof m.id !== 'string' || typeof m.sequence !== 'string' || !/^\d+$/.test(m.sequence)) throw new Error('Message IDs and sequences must be strings');
    if (!['PARTICIPANT_TO_BUSINESS', 'BUSINESS_TO_PARTICIPANT'].includes(m.direction)) throw new Error('Unknown direction');
    const text = (m.content?.basic?.items || []).map(i => i.text || '').join('\n') || m.content?.previewText || '';
    if (typeof text !== 'string' || text.length > 20000) throw new Error('Message too large');
    return { id: m.id, sequence: m.sequence, direction: m.direction, text, editedDate: m.editedDate || '', createdDate: m.createdDate || '', contentType: m.content?.contentType || 'UNKNOWN' };
  });
  if (new Set(rows.map(m => m.id)).size !== rows.length) throw new Error('Duplicate message IDs in snapshot');
  return rows.sort((a, b) => BigInt(a.sequence) < BigInt(b.sequence) ? -1 : BigInt(a.sequence) > BigInt(b.sequence) ? 1 : a.id.localeCompare(b.id));
}

export function propose(messages) {
  const incoming = messages.filter(m => m.direction === 'PARTICIPANT_TO_BUSINESS' && m.contentType === 'BASIC');
  const text = incoming.map(m => m.text).join('\n').toLowerCase();
  let category = 'needs_clarification';
  let draft = 'Hi! Could you describe what is happening in Evil Apples, including your device, app version, and the steps that lead to the problem? A screenshot with personal information hidden would also help. Please do not send passwords or payment details.';
  if (/hack|threat|harass|abuse|stolen|suicide/.test(text)) return { category: 'sensitive_human_review', draft: '', state: 'needs_human' };
  if (/purchas|charged|refund|unlock|payment/.test(text)) {
    category = 'purchase_or_entitlement';
    draft = 'Hi! Could you share your Evil Apples username, whether you use iPhone/iPad or Android, and which purchase or unlock is affected? Please do not send passwords or full payment details. We will need to verify the purchase and account before confirming any account correction.';
  } else if (/game|load|answer|crash|freeze|stuck/.test(text)) {
    category = 'gameplay';
    draft = 'Hi! Could you tell us whether you are on iPhone/iPad or Android, your Evil Apples app version, and whether this happens in one game or every game? Please describe what appears on the stuck screen and share your Evil Apples username and a screenshot with personal information hidden, if possible. Please do not send passwords or payment details.';
  }
  const last = messages.at(-1);
  return { category, draft, state: !incoming.length || last?.direction !== 'PARTICIPANT_TO_BUSINESS' ? 'needs_human' : 'pending_review' };
}

export class Queue {
  constructor(path) {
    if (path !== ':memory:') { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); }
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS cases (
        id INTEGER PRIMARY KEY, site TEXT NOT NULL, conversation TEXT NOT NULL,
        fingerprint TEXT NOT NULL, messages TEXT NOT NULL, category TEXT NOT NULL,
        draft TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL,
        updated TEXT NOT NULL, UNIQUE(site,conversation));
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL, action TEXT NOT NULL,
        revision INTEGER NOT NULL, actor TEXT NOT NULL, time TEXT NOT NULL,
        fingerprint TEXT NOT NULL, draft_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (
        event_id TEXT PRIMARY KEY, conversation TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        next_at INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending');`);
  }
  close() { this.db.close(); }
  list() { return this.db.prepare('SELECT id,conversation,category,state,revision,updated FROM cases ORDER BY updated DESC').all(); }
  get(id) {
    const row = this.db.prepare('SELECT * FROM cases WHERE id=?').get(id);
    return row ? { ...row, messages: JSON.parse(row.messages) } : null;
  }
  sync(site, conversation, messages) {
    const rows = normalize(messages);
    const serialized = JSON.stringify(rows);
    const fingerprint = createHash('sha256').update(serialized).digest('hex');
    const suggestion = propose(rows);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.db.prepare('SELECT * FROM cases WHERE site=? AND conversation=?').get(site, conversation);
      if (old?.fingerprint === fingerprint) { this.db.exec('COMMIT'); return this.get(old.id); }
      const now = new Date().toISOString();
      if (old) {
        this.db.prepare('UPDATE cases SET fingerprint=?,messages=?,category=?,draft=?,state=?,revision=revision+1,updated=? WHERE id=?')
          .run(fingerprint, serialized, suggestion.category, suggestion.draft, suggestion.state, now, old.id);
      } else {
        this.db.prepare('INSERT INTO cases(site,conversation,fingerprint,messages,category,draft,state,revision,updated) VALUES(?,?,?,?,?,?,?,1,?)')
          .run(site, conversation, fingerprint, serialized, suggestion.category, suggestion.draft, suggestion.state, now);
      }
      const row = this.db.prepare('SELECT id,revision FROM cases WHERE site=? AND conversation=?').get(site, conversation);
      this.db.prepare('INSERT INTO audit(case_id,action,revision,actor,time,fingerprint,draft_hash) VALUES(?,?,?,?,?,?,?)')
        .run(row.id, 'snapshot', row.revision, 'wix-reader', now, fingerprint, createHash('sha256').update(suggestion.draft).digest('hex'));
      this.db.exec('COMMIT');
      return this.get(row.id);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  review(id, revision, action, draft) {
    if (!['save', 'approve', 'reject'].includes(action)) throw new Error('Invalid action');
    if (!Number.isInteger(revision) || typeof draft !== 'string' || draft.length > 10000) throw new Error('Invalid review');
    if (action === 'approve' && !draft.trim()) throw new Error('Empty draft');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get(id);
      if (!current || current.revision !== revision) throw new Error('Conflict: case changed; reload before review');
      const state = action === 'approve' ? 'approved_for_manual_send' : action === 'reject' ? 'rejected' : 'pending_review';
      this.db.prepare('UPDATE cases SET draft=?,state=?,revision=revision+1,updated=? WHERE id=?').run(draft, state, new Date().toISOString(), id);
      this.db.prepare('INSERT INTO audit(case_id,action,revision,actor,time,fingerprint,draft_hash) VALUES(?,?,?,?,?,?,?)')
        .run(id, action, revision + 1, 'local-reviewer', new Date().toISOString(), current.fingerprint, createHash('sha256').update(draft).digest('hex'));
      this.db.exec('COMMIT'); return this.get(id);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  enqueue(eventId, conversation) {
    this.db.prepare('INSERT OR IGNORE INTO jobs(event_id,conversation) VALUES(?,?)').run(eventId, conversation);
  }
  nextJob() { return this.db.prepare("SELECT * FROM jobs WHERE state='pending' AND next_at<=? ORDER BY next_at,event_id LIMIT 1").get(Date.now()); }
  finishJob(id) { this.db.prepare("UPDATE jobs SET state='done' WHERE event_id=?").run(id); }
  failJob(id) { this.db.prepare("UPDATE jobs SET attempts=attempts+1,next_at=?,state=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END WHERE event_id=?").run(Date.now() + 60000, id); }
  jobs() { return this.db.prepare("SELECT event_id,conversation,attempts,state FROM jobs WHERE state!='done'").all(); }
}
