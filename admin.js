const LS_KEY = 'handoutArchiveGH';
let ghConfig = null; // { owner, repo, branch, token }
let categoriesCache = []; // [{ id, name }]

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
function slugify(name) {
  const map = { å: 'a', ä: 'a', á: 'a', à: 'a', ö: 'o', ó: 'o', é: 'e', è: 'e', ë: 'e', ü: 'u', ú: 'u', í: 'i' };
  return name.toLowerCase().split('').map(c => map[c] || c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'kategori';
}
function uniqueId(base, existingIds) {
  let id = base, n = 2;
  while (existingIds.includes(id)) { id = `${base}-${n}`; n++; }
  return id;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Adds a hint to the common "token doesn't have permission" error so it's
// actionable instead of just cryptic.
function explainError(e) {
  if (/resource not accessible/i.test(e.message)) {
    return new Error(
      e.message +
      ' — kontrollera att din token har "Contents: Read and write" på detta repo, ' +
      'att repot redan har minst en commit, och (om det är ett org-repo) att ' +
      'organisationen har godkänt token.'
    );
  }
  return e;
}

// Low-level request helper.
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
    throw explainError(new Error(err.message || `GitHub API-fel (${res.status})`));
  }
  return res.json();
}

const getFile = (path) => gh(`contents/${path}`, 'GET');
const deleteFile = (path, message, sha) =>
  gh(`contents/${path}`, 'DELETE', { message, sha, branch: ghConfig.branch });

// Simple write path — fine for small text files (files.json / categories.json).
const putFile = (path, base64Content, message, sha) =>
  gh(`contents/${path}`, 'PUT', { message, content: base64Content, branch: ghConfig.branch, sha: sha || undefined });

// Full write path for anything that might exceed 1MB (PDFs, custom icons):
// create a blob, graft it into a new tree off the current commit, commit
// that tree, then move the branch pointer to the new commit.
async function commitFile(path, base64Content, message) {
  const ref = await gh(`git/ref/heads/${ghConfig.branch}`, 'GET');
  if (!ref) throw new Error(`Branchen "${ghConfig.branch}" hittades inte — har repot minst en commit?`);
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

async function getCategoriesJson() {
  const res = await getFile('data/categories.json');
  if (!res) return { categories: [], sha: null };
  const json = b64DecodeUnicode(res.content.replace(/\n/g, ''));
  return { categories: JSON.parse(json), sha: res.sha };
}
async function saveCategoriesJson(categories, sha) {
  const content = b64EncodeUnicode(JSON.stringify(categories, null, 2));
  const res = await putFile('data/categories.json', content, 'Update categories.json', sha);
  return res.content.sha;
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
  document.getElementById('addCategoryBtn').addEventListener('click', addCategory);
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
    msg.textContent = 'Fyll i ägare, repo och token.';
    return;
  }
  ghConfig = { owner, repo, branch, token };
  msg.textContent = 'Ansluter…';
  try {
    await getFilesJson(); // just to verify access works
    saveConfig(ghConfig);
    msg.textContent = '';
    document.getElementById('panel').style.display = 'block';
    await loadCategoriesAndPopulate();
    refreshList();
  } catch (e) {
    msg.textContent = 'Kunde inte ansluta: ' + e.message;
  }
}

// ---- Categories ----

async function loadCategoriesAndPopulate() {
  const { categories } = await getCategoriesJson();
  categoriesCache = categories;
  renderCategoryManager(categories);
  populateCategorySelect(document.getElementById('addCategorySelect'), categories);
  return categories;
}

function populateCategorySelect(select, categories, selectedId) {
  select.innerHTML = '<option value="">Ingen</option>' +
    categories.map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
}

function renderCategoryManager(categories) {
  const container = document.getElementById('categoryList');
  container.innerHTML = '';
  if (!categories.length) {
    container.innerHTML = '<p class="empty">Inga kategorier ännu.</p>';
    return;
  }
  categories.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.marginTop = '0.4rem';
    row.innerHTML = `
      <input type="text" value="${escapeHtml(cat.name)}">
      <button type="button" class="saveCatBtn">Spara</button>
      <button type="button" class="danger deleteCatBtn">Ta bort</button>
    `;
    row.querySelector('.saveCatBtn').addEventListener('click', () =>
      renameCategory(cat.id, row.querySelector('input').value.trim()));
    row.querySelector('.deleteCatBtn').addEventListener('click', () =>
      removeCategory(cat.id, cat.name));
    container.appendChild(row);
  });
}

async function addCategory() {
  const input = document.getElementById('newCategoryName');
  const name = input.value.trim();
  if (!name) return;
  try {
    const { categories, sha } = await getCategoriesJson();
    const id = uniqueId(slugify(name), categories.map(c => c.id));
    categories.push({ id, name });
    await saveCategoriesJson(categories, sha);
    input.value = '';
    await loadCategoriesAndPopulate();
  } catch (e) {
    alert('Det gick inte att lägga till kategorin: ' + e.message);
  }
}

async function renameCategory(id, newName) {
  if (!newName) return;
  try {
    const { categories, sha } = await getCategoriesJson();
    const cat = categories.find(c => c.id === id);
    if (cat) cat.name = newName;
    await saveCategoriesJson(categories, sha);
    await loadCategoriesAndPopulate();
    refreshList();
  } catch (e) {
    alert('Det gick inte att spara kategorin: ' + e.message);
  }
}

async function removeCategory(id, name) {
  if (!confirm(`Ta bort kategorin "${name}"? Filer som har den kategorin blir okategoriserade.`)) return;
  try {
    const { categories, sha } = await getCategoriesJson();
    const next = categories.filter(c => c.id !== id);
    await saveCategoriesJson(next, sha);
    await loadCategoriesAndPopulate();
    refreshList();
  } catch (e) {
    alert('Det gick inte att ta bort kategorin: ' + e.message);
  }
}

// ---- Files ----

async function handleAdd(ev) {
  ev.preventDefault();
  const fileInput = document.getElementById('addFile');
  const iconInput = document.getElementById('addIcon');
  const name = document.getElementById('addName').value.trim();
  const description = document.getElementById('addDesc').value.trim();
  const color = document.getElementById('addColor').value;
  const password = document.getElementById('addPassword').value;
  const category = document.getElementById('addCategorySelect').value || null;

  if (!fileInput.files[0]) { alert('Välj en fil först.'); return; }

  const submitBtn = ev.target.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Laddar upp…';

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
      id, name: name || file.name, description, color, category,
      password_hash: passwordHash, file: path, icon: iconPath,
      created: Date.now()
    });
    await saveFilesJson(entries, sha);

    ev.target.reset();
    document.getElementById('addIcon').style.display = 'none';
    refreshList();
  } catch (e) {
    alert('Uppladdningen misslyckades: ' + e.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Lägg till fil';
  }
}

async function refreshList() {
  const { entries } = await getFilesJson();
  entries.sort((a, b) => (b.created || 0) - (a.created || 0));
  const container = document.getElementById('fileList');
  container.innerHTML = '';
  for (const e of entries) container.appendChild(renderEntry(e));
}

function categoryOptionsHtml(selectedId) {
  return '<option value="">Ingen</option>' +
    categoriesCache.map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
}

function renderEntry(e) {
  const div = document.createElement('div');
  div.className = 'entry' + (e.color === 'red' ? ' red' : '');

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = e.name + ' ';
  const metaSpan = document.createElement('span');
  metaSpan.className = 'meta';
  metaSpan.textContent = `(${e.color === 'red' ? 'röd / endast SL' : 'orange'}${e.password_hash ? ', låst' : ''})`;
  summary.appendChild(metaSpan);
  details.appendChild(summary);

  const form = document.createElement('form');
  form.innerHTML = `
    <label>Visningsnamn</label>
    <input type="text" name="name" value="${escapeHtml(e.name)}">
    <label>Beskrivning</label>
    <textarea name="description" rows="2">${escapeHtml(e.description || '')}</textarea>
    <div class="row">
      <div>
        <label>Färg</label>
        <select name="color">
          <option value="orange" ${e.color !== 'red' ? 'selected' : ''}>Orange</option>
          <option value="red" ${e.color === 'red' ? 'selected' : ''}>Röd (endast SL)</option>
        </select>
      </div>
      <div>
        <label>Nytt lösenord (lämna tomt för att behålla)</label>
        <input type="password" name="password">
      </div>
    </div>
    ${e.password_hash ? '<label><input type="checkbox" name="clearPassword" style="width:auto;display:inline;"> Ta bort befintligt lösenord</label>' : ''}
    <label>Kategori</label>
    <select name="category">${categoryOptionsHtml(e.category)}</select>
    <label>Ikon</label>
    <select name="iconChoice">
      <option value="none" ${iconChoiceFor(e) === 'none' ? 'selected' : ''}>Ingen ikon</option>
      <option value="preset-fist" ${iconChoiceFor(e) === 'preset-fist' ? 'selected' : ''}>Standard: Zombienäve</option>
      <option value="preset-map" ${iconChoiceFor(e) === 'preset-map' ? 'selected' : ''}>Standard: Karta</option>
      <option value="preset-question" ${iconChoiceFor(e) === 'preset-question' ? 'selected' : ''}>Standard: Frågetecken</option>
      <option value="custom" ${iconChoiceFor(e) === 'custom' ? 'selected' : ''}>Egen bild</option>
    </select>
    <input type="file" name="iconFile" accept="image/*" style="display:${iconChoiceFor(e) === 'custom' ? 'block' : 'none'};">
    <p class="meta">Lämna "Egen bild" markerat utan att välja ny fil för att behålla nuvarande ikon.</p>
    <button type="submit">Spara ändringar</button>
    <button type="button" class="danger deleteBtn">Ta bort</button>
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
  btn.disabled = true; btn.textContent = 'Sparar…';
  try {
    const name = form.name.value.trim() || oldEntry.name;
    const description = form.description.value.trim();
    const color = form.color.value;
    const password = form.password.value;
    const clearPassword = form.clearPassword && form.clearPassword.checked;
    const category = form.category.value || null;

    const { entries, sha } = await getFilesJson();
    const idx = entries.findIndex(x => x.id === oldEntry.id);
    if (idx === -1) throw new Error('Filen hittades inte — försök uppdatera sidan.');

    entries[idx].name = name;
    entries[idx].description = description;
    entries[idx].color = color;
    entries[idx].category = category;
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
    alert('Det gick inte att spara: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Spara ändringar';
  }
}

async function handleDelete(entry) {
  if (!confirm(`Ta bort "${entry.name}" permanent?`)) return;
  try {
    const fileInfo = await getFile(entry.file);
    if (fileInfo) await deleteFile(entry.file, `Delete ${entry.name}`, fileInfo.sha);
    if (entry.icon && !Object.values(PRESET_ICONS).includes(entry.icon)) {
      const iconInfo = await getFile(entry.icon);
      if (iconInfo) await deleteFile(entry.icon, `Delete icon for ${entry.name}`, iconInfo.sha);
    }
    const { entries, sha } = await getFilesJson();
    const next = entries.filter(x => x.id !== entry.id);
    await saveFilesJson(next, sha);
    refreshList();
  } catch (e) {
    alert('Det gick inte att ta bort: ' + e.message);
  }
}
