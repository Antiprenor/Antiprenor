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

// Adds a hint to the common "token doesn't have permission" error so it's
// actionable instead of just cryptic.
function explainError(e) {
  if (/resource not accessible/i.test(e.message)) {
    return new Error(
      e.message +
      ' — check that your token has "Contents: Read and write" on this repo, ' +
      'that the repo has at least one commit already, and (if it\'s an org repo) ' +
      'that the org has approved the token.'
    );
  }
  return e;
}

// Low-level request helper. `base` picks which API family: "contents/..."
// for the simple file API (small files, up to 1MB), or "git/..." for the
// Git Data API (used for large files, see commitFile below).
async function gh(pathWithinRepo, method, body) {
  const url = `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/${pathWithinRepo}`;
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
    throw explainError(new Error(err.message || `GitHub API error (${res.status})`));
  }
  return res.json();
}

const getFile = (path) => gh(`contents/${path}`, 'GET');
const deleteFile = (path, message, sha) =>
  gh(`contents/${path}`, 'DELETE', { message, sha, branch: ghConfig.branch });

// Simple write path — fine for small text files (files.json is a few KB).
const putFile = (path, base64Content, message, sha) =>
  gh(`contents/${path}`, 'PUT', { message, content: base64Content, branch: ghConfig.branch, sha: sha || undefined });

// Full write path for anything that might exceed 1MB (PDFs, icons):
// create a blob, graft it into a new tree off the current commit, commit
// that tree, then move the branch pointer to the new commit. No size cap
// from GitHub's side other than its general ~100MB per-file git limit.
async function commitFile(path, base64Content, message) {
  const ref = await gh(`git/ref/heads/${ghConfig.branch}`, 'GET');
  if (!ref) throw new Error(`Branch "${ghConfig.branch}" not found — does the repo have at least one commit?`);
  const latestCommitSha = ref.object.sha;

  const commit = await gh(`git/commits/${latestCommitSha}`, 'GET');
  const baseTreeSha = commit.tree.sha;

  const blob = await gh('git/blobs', 'POST', { content: base64Content, encoding: 'base64' });

  const tree = await gh('git/trees', 'POST', {
    base_tree: baseTreeSha,
    tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }]
  });

  const newCommit = await gh('git/commits', 'POST', {
    message, tree: tree.sha, parents: [latestCommitSha]
  });

  await gh(`git/refs/heads/${ghConfig.branch}`, 'PATCH', { sha: newCommit.sha });
}

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
  document.getElementById('addIconChoice').addEventListener('change', (ev) => {
    document.getElementById('addIcon').style.display = ev.target.value === 'custom' ? 'block' : 'none';
  });

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
    await commitFile(path, b64, `Add ${name || file.name}`);

    let iconPath = null;
    const iconChoice = document.getElementById('addIconChoice').value;
    if (iconChoice.startsWith('preset-')) {
      iconPath = `icons/${iconChoice}.svg`; // already bundled in the repo, no upload needed
    } else if (iconChoice === 'custom' && iconInput.files[0]) {
      const icon = iconInput.files[0];
      const iconExt = (icon.name.split('.').pop() || 'png');
      iconPath = `icons/${id}_icon.${iconExt}`;
      const iconB64 = await fileToBase64(icon);
      await commitFile(iconPath, iconB64, `Add icon for ${name || file.name}`);
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

const PRESET_ICONS = {
  'preset-fist': 'icons/preset-fist.svg',
  'preset-map': 'icons/preset-map.svg',
  'preset-question': 'icons/preset-question.svg'
};
function iconChoiceFor(entry) {
  if (!entry.icon) return 'none';
  const found = Object.entries(PRESET_ICONS).find(([, path]) => path === entry.icon);
  return found ? found[0] : 'custom';
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
    <label>Icon</label>
    <select name="iconChoice">
      <option value="none" ${iconChoiceFor(e) === 'none' ? 'selected' : ''}>No icon</option>
      <option value="preset-fist" ${iconChoiceFor(e) === 'preset-fist' ? 'selected' : ''}>Preset: Zombie fist</option>
      <option value="preset-map" ${iconChoiceFor(e) === 'preset-map' ? 'selected' : ''}>Preset: Map</option>
      <option value="preset-question" ${iconChoiceFor(e) === 'preset-question' ? 'selected' : ''}>Preset: Question mark</option>
      <option value="custom" ${iconChoiceFor(e) === 'custom' ? 'selected' : ''}>Custom image</option>
    </select>
    <input type="file" name="iconFile" accept="image/*" style="display:${iconChoiceFor(e) === 'custom' ? 'block' : 'none'};">
    <p class="meta">Leave "Custom image" selected with no new file chosen to keep the current custom icon.</p>
    <button type="submit">Save changes</button>
    <button type="button" class="danger deleteBtn">Delete</button>
  `;
  form.querySelector('select[name=iconChoice]').addEventListener('change', (ev) => {
    form.querySelector('input[name=iconFile]').style.display = ev.target.value === 'custom' ? 'block' : 'none';
  });
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

    const iconChoice = form.iconChoice.value;
    if (iconChoice === 'none') {
      entries[idx].icon = null;
    } else if (PRESET_ICONS[iconChoice]) {
      entries[idx].icon = PRESET_ICONS[iconChoice];
    } else if (iconChoice === 'custom' && form.iconFile.files[0]) {
      const icon = form.iconFile.files[0];
      const iconExt = (icon.name.split('.').pop() || 'png');
      const iconPath = `icons/${oldEntry.id}_icon.${iconExt}`;
      const iconB64 = await fileToBase64(icon);
      await commitFile(iconPath, iconB64, `Update icon for ${name}`);
      entries[idx].icon = iconPath;
    }
    // else: "custom" with no new file picked — leave the existing icon as-is

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
