const LS_KEY = 'handoutArchiveGH';
let ghConfig = null; // { owner, repo, branch, token }

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; }
}
function saveConfig(cfg) { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); }

// Best-effort guess of owner/repo from a *.github.io URL, so most people
// never have to type it in. Always editable/overridable in the form.
function detectRepoInfo() {
  const host = location.hostname;
  const parts = location.pathname.split('/').filter(Boolean);
  const m = host.match(/^([^.]+)\.github\.io$/i);
  if (m) {
    const owner = m[1];
    const repo = parts.length > 0 ? parts[0] : `${owner}.github.io`;
    return { owner, repo };
  }
  return {};
}

function b64EncodeUnicode(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
    (_, p1) => String.fromCharCode('0x' + p1)));
}
function b64DecodeUnicode(str) {
  return decodeURIComponent(atob(str).split('').map(c =>
    '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
}
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function gh(method, path, body) {
  const url = `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/contents/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${ghConfig.token}`,
      'Accept': 'application/vnd.github+json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error (${res.status})`);
  }
  return res.json();
}

const getFile = (path) => gh('GET', path);
const putFile = (path, base64Content, message, sha) =>
  gh('PUT', path, { message, content: base64Content, branch: ghConfig.branch, sha: sha || undefined });
const deleteFile = (path, message, sha) =>
  gh('DELETE', path, { message, sha, branch: ghConfig.branch });

async function getFilesJson() {
  const res = await getFile('data/files.json');
  if (!res) return { entries: [], sha: null };
  const json = b64DecodeUnicode(res.content.replace(/\n/g, ''));
  return { entries: JSON.parse(json), sha: res.sha };
}
async function saveFilesJson(entries, sha) {
  const content = b64EncodeUnicode(JSON.stringify(entries, null, 2));
  const res = await putFile('data/files.json', content, 'Update files.json', sha);
  return res.content.sha;
}

// ---- UI wiring ----
document.addEventListener('DOMContentLoaded', () => {
  const detected = detectRepoInfo();
  const saved = loadConfig();
  document.getElementById('ghOwner').value = (saved && saved.owner) || detected.owner || '';
  document.getElementById('ghRepo').value = (saved && saved.repo) || detected.repo || '';
  document.getElementById('ghBranch').value = (saved && saved.branch) || 'main';
  document.getElementById('ghToken').value = (saved && saved.token) || '';

  document.getElementById('connectBtn').addEventListener('click', connect);
  document.getElementById('addForm').addEventListener('submit', handleAdd);

  if (saved && saved.token) connect();
});

async function connect() {
  const owner = document.getElementById('ghOwner').value.trim();
  const repo = document.getElementById('ghRepo').value.trim();
  const branch = document.getElementById('ghBranch').value.trim() || 'main';
  const token = document.getElementById('ghToken').value.trim();
  const msg = document.getElementById('connectMsg');

  if (!owner || !repo || !token) {
    msg.textContent = 'Fill in owner, repo, and token.';
    return;
  }
  ghConfig = { owner, repo, branch, token };
  msg.textContent = 'Connecting…';
  try {
    await getFilesJson(); // just to verify access works
    saveConfig(ghConfig);
    msg.textContent = '';
    document.getElementById('panel').style.display = 'block';
    refreshList();
  } catch (e) {
    msg.textContent = 'Could not connect: ' + e.message;
  }
}

async function handleAdd(ev) {
  ev.preventDefault();
  const fileInput = document.getElementById('addFile');
  const iconInput = document.getElementById('addIcon');
  const name = document.getElementById('addName').value.trim();
  const description = document.getElementById('addDesc').value.trim();
  const color = document.getElementById('addColor').value;
  const password = document.getElementById('addPassword').value;

  if (!fileInput.files[0]) { alert('Choose a file first.'); return; }

  const submitBtn = ev.target.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Uploading…';

  try {
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const file = fileInput.files[0];
    const ext = (file.name.split('.').pop() || 'pdf');
    const path = `files/${id}.${ext}`;
    const b64 = await fileToBase64(file);
    await putFile(path, b64, `Add ${name || file.name}`);

    let iconPath = null;
    if (iconInput.files[0]) {
      const icon = iconInput.files[0];
      const iconExt = (icon.name.split('.').pop() || 'png');
      iconPath = `icons/${id}_icon.${iconExt}`;
      const iconB64 = await fileToBase64(icon);
      await putFile(iconPath, iconB64, `Add icon for ${name || file.name}`);
    }

    const passwordHash = password ? await sha256Hex(password) : null;

    const { entries, sha } = await getFilesJson();
    entries.push({
      id, name: name || file.name, description, color,
      password_hash: passwordHash, file: path, icon: iconPath,
      created: Date.now()
    });
    await saveFilesJson(entries, sha);

    ev.target.reset();
    refreshList();
  } catch (e) {
    alert('Upload failed: ' + e.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Add file';
  }
}

async function refreshList() {
  const { entries } = await getFilesJson();
  entries.sort((a, b) => (b.created || 0) - (a.created || 0));
  const container = document.getElementById('fileList');
  container.innerHTML = '';
  for (const e of entries) container.appendChild(renderEntry(e));
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderEntry(e) {
  const div = document.createElement('div');
  div.className = 'entry' + (e.color === 'red' ? ' red' : '');

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = e.name + ' ';
  const metaSpan = document.createElement('span');
  metaSpan.className = 'meta';
  metaSpan.textContent = `(${e.color === 'red' ? 'red / GM only' : 'orange'}${e.password_hash ? ', locked' : ''})`;
  summary.appendChild(metaSpan);
  details.appendChild(summary);

  const form = document.createElement('form');
  form.innerHTML = `
    <label>Display name</label>
    <input type="text" name="name" value="${escapeHtml(e.name)}">
    <label>Description</label>
    <textarea name="description" rows="2">${escapeHtml(e.description || '')}</textarea>
    <div class="row">
      <div>
        <label>Color</label>
        <select name="color">
          <option value="orange" ${e.color !== 'red' ? 'selected' : ''}>Orange</option>
          <option value="red" ${e.color === 'red' ? 'selected' : ''}>Red (GM only)</option>
        </select>
      </div>
      <div>
        <label>New password (leave blank to keep)</label>
        <input type="password" name="password">
      </div>
    </div>
    ${e.password_hash ? '<label><input type="checkbox" name="clearPassword" style="width:auto;display:inline;"> Remove existing password</label>' : ''}
    <button type="submit">Save changes</button>
    <button type="button" class="danger deleteBtn">Delete</button>
  `;
  form.addEventListener('submit', (ev) => handleEdit(ev, e));
  form.querySelector('.deleteBtn').addEventListener('click', () => handleDelete(e));
  details.appendChild(form);
  div.appendChild(details);
  return div;
}

async function handleEdit(ev, oldEntry) {
  ev.preventDefault();
  const form = ev.target;
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const name = form.name.value.trim() || oldEntry.name;
    const description = form.description.value.trim();
    const color = form.color.value;
    const password = form.password.value;
    const clearPassword = form.clearPassword && form.clearPassword.checked;

    const { entries, sha } = await getFilesJson();
    const idx = entries.findIndex(x => x.id === oldEntry.id);
    if (idx === -1) throw new Error('Entry not found — try refreshing the page.');

    entries[idx].name = name;
    entries[idx].description = description;
    entries[idx].color = color;
    if (clearPassword) {
      entries[idx].password_hash = null;
    } else if (password) {
      entries[idx].password_hash = await sha256Hex(password);
    }
    await saveFilesJson(entries, sha);
    refreshList();
  } catch (e) {
    alert('Save failed: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Save changes';
  }
}

async function handleDelete(entry) {
  if (!confirm(`Delete "${entry.name}" permanently?`)) return;
  try {
    const fileInfo = await getFile(entry.file);
    if (fileInfo) await deleteFile(entry.file, `Delete ${entry.name}`, fileInfo.sha);
    if (entry.icon) {
      const iconInfo = await getFile(entry.icon);
      if (iconInfo) await deleteFile(entry.icon, `Delete icon for ${entry.name}`, iconInfo.sha);
    }
    const { entries, sha } = await getFilesJson();
    const next = entries.filter(x => x.id !== entry.id);
    await saveFilesJson(next, sha);
    refreshList();
  } catch (e) {
    alert('Delete failed: ' + e.message);
  }
}
