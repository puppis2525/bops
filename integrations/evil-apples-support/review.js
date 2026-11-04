let current;
const el = id => document.getElementById(id);
async function api(path, body) {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
async function load() {
  const data = await api('/api/cases');
  el('mode').textContent = data.demo ? 'SYNTHETIC DEMO' : 'Human review';
  el('cases').replaceChildren();
  for (const item of data.cases) {
    const button = document.createElement('button'); button.className = 'case';
    button.textContent = 'Case ' + item.id + ' · ' + item.category.replaceAll('_', ' ') + '\n' + item.state.replaceAll('_', ' ');
    button.addEventListener('click', () => open(item.id).catch(showError)); el('cases').append(button);
  }
  if (!data.cases.length) el('cases').textContent = 'No cases yet. New conversations appear here after intake.';
  el('jobs').textContent = data.jobs.length ? data.jobs.length + ' intake job(s) pending or failed. Check runtime connection if retries persist.' : '';
}
async function open(id) {
  current = await api('/api/cases/' + id);
  el('empty').hidden = true; el('detail').hidden = false;
  el('case-title').textContent = 'Case ' + id;
  el('category').textContent = current.category.replaceAll('_', ' ');
  el('case-state').textContent = current.state.replaceAll('_', ' ') + ' · revision ' + current.revision;
  el('draft').value = current.draft;
  el('messages').replaceChildren();
  for (const message of current.messages) {
    const p = document.createElement('p'); p.className = 'message';
    p.textContent = (message.direction === 'PARTICIPANT_TO_BUSINESS' ? 'Player' : 'Business') + ' · ' + message.createdDate + '\n' + message.text;
    el('messages').append(p);
  }
  el('source').href = 'https://manage.wix.com/dashboard/' + encodeURIComponent(current.site) + '/inbox/' + encodeURIComponent(current.conversation);
}
function showError(error) { el('status').textContent = error.message; }
for (const action of ['save', 'approve', 'reject']) el(action).addEventListener('click', async () => {
  if (!current) return;
  const buttons = [...document.querySelectorAll('.actions button')]; buttons.forEach(b => { b.disabled = true; });
  try {
    await api('/api/cases/' + current.id, { action, revision: current.revision, draft: el('draft').value });
    el('status').textContent = action === 'approve' ? 'Approved for manual sending. No message was sent.' : 'Decision saved.';
    await open(current.id); await load();
  } catch (error) { showError(error); }
  finally { buttons.forEach(b => { b.disabled = false; }); }
});
el('refresh').addEventListener('click', () => load().catch(showError));
load().catch(showError);
