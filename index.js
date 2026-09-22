async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function load() {
  const tabsEl = document.getElementById('tabs');
  const listEl = document.getElementById('list');

  let entries = [];
  let categories = [];
  try {
    const [filesRes, catsRes] = await Promise.all([
      fetch('data/files.json?_=' + Date.now()),
      fetch('data/categories.json?_=' + Date.now())
    ]);
    entries = await filesRes.json();
    categories = await catsRes.json().catch(() => []);
  } catch (e) {
    listEl.innerHTML = '<p class="empty">Kunde inte läsa in fillistan.</p>';
    return;
  }

  entries.sort((a, b) => (b.created || 0) - (a.created || 0));

  const knownIds = categories.map(c => c.id);
  const hasUncategorized = entries.some(e => !e.category || !knownIds.includes(e.category));

  const tabs = [{ id: null, name: 'Alla' }, ...categories];
  if (hasUncategorized) tabs.push({ id: '__none__', name: 'Okategoriserat' });

  let activeTab = null;

  function renderTabsBar() {
    tabsEl.innerHTML = '';
    if (tabs.length <= 1) return; // nothing to tab through
    tabs.forEach(t => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tabbtn' + (t.id === activeTab ? ' active' : '');
      btn.textContent = t.name;
      btn.addEventListener('click', () => { activeTab = t.id; renderTabsBar(); renderList(); });
      tabsEl.appendChild(btn);
    });
  }

  function renderList() {
    let filtered = entries;
    if (activeTab === '__none__') {
      filtered = entries.filter(e => !e.category || !knownIds.includes(e.category));
    } else if (activeTab) {
      filtered = entries.filter(e => e.category === activeTab);
    }

    listEl.innerHTML = '';
    if (!filtered.length) {
      listEl.innerHTML = '<p class="empty">Inga filer här än.</p>';
      return;
    }

    for (const e of filtered) {
      const div = document.createElement('div');
      div.className = 'entry' + (e.color === 'red' ? ' red' : '');

      const iconHtml = e.icon ? `<img src="${e.icon}" alt="">` : `<span class="fallback">&#9635;</span>`;
      const tag = (e.color === 'red' ? 'Endast för SL' : 'Allmänt') + (e.password_hash ? ' &middot; låst' : '');

      div.innerHTML = `
        <div class="icon">${iconHtml}</div>
        <div class="body">
          <div class="tag">${tag}</div>
          <div class="name"></div>
          <div class="desc"></div>
          <div class="action"></div>
        </div>`;
      div.querySelector('.name').textContent = e.name;
      div.querySelector('.desc').textContent = e.description || '';

      const actionDiv = div.querySelector('.action');
      if (e.password_hash) {
        renderLock(actionDiv, e);
      } else {
        renderLink(actionDiv, e);
      }
      listEl.appendChild(div);
    }
  }

  renderTabsBar();
  renderList();
}

function renderLink(container, e) {
  const a = document.createElement('a');
  a.href = e.file;
  a.textContent = 'Ladda ner';
  a.className = 'btn';
  a.setAttribute('download', '');
  container.appendChild(a);
}

function renderLock(container, e) {
  const form = document.createElement('form');
  form.className = 'lockform';
  form.innerHTML = `<input type="password" placeholder="lösenord" required><button type="submit">Lås upp</button>`;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const input = form.querySelector('input');
    const hash = await sha256Hex(input.value);
    if (hash === e.password_hash) {
      container.innerHTML = '';
      renderLink(container, e);
    } else {
      input.style.borderColor = '#b3221e';
      input.value = '';
    }
  });
  container.appendChild(form);
}

load();
async function startTransmissions() {
  const el = document.getElementById('transmissionLine');
  if (!el) return;

  let lines = [];
  try {
    const res = await fetch('data/zombietips.txt?_=' + Date.now());
    const text = await res.text();
    lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  } catch (e) {
    el.textContent = '– ingen signal –';
    return;
  }
  if (!lines.length) {
    el.textContent = '– ingen signal –';
    return;
  }

  let lastIndex = -1;
  function pickLine() {
    if (lines.length === 1) return lines[0];
    let i;
    do { i = Math.floor(Math.random() * lines.length); } while (i === lastIndex);
    lastIndex = i;
    return lines[i];
  }

  function showNext() {
    el.textContent = pickLine();
    el.classList.remove('leaving');
    el.classList.add('entering');
    void el.offsetWidth; // force reflow so the enter transition actually plays
    el.classList.remove('entering');
  }

  showNext();
  setInterval(() => {
    el.classList.add('leaving');
    setTimeout(showNext, 600);
  }, 6000);
}

startTransmissions();
