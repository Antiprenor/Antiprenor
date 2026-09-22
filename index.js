async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function load() {
  const list = document.getElementById('list');
  let entries = [];
  try {
    const res = await fetch('data/files.json?_=' + Date.now());
    entries = await res.json();
  } catch (e) {
    list.innerHTML = '<p class="empty">Could not load the file list.</p>';
    return;
  }

  entries.sort((a, b) => (b.created || 0) - (a.created || 0));

  if (!entries.length) {
    list.innerHTML = '<p class="empty">No files yet.</p>';
    return;
  }

  list.innerHTML = '';
  for (const e of entries) {
    const div = document.createElement('div');
    div.className = 'entry' + (e.color === 'red' ? ' red' : '');

    const iconHtml = e.icon ? `<img src="${e.icon}" alt="">` : `<span class="fallback">&#9635;</span>`;
    const tag = (e.color === 'red' ? 'GM only' : 'General') + (e.password_hash ? ' &middot; locked' : '');

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
    list.appendChild(div);
  }
}

function renderLink(container, e) {
  const a = document.createElement('a');
  a.href = e.file;
  a.textContent = 'Download';
  a.className = 'btn';
  a.setAttribute('download', '');
  container.appendChild(a);
}

function renderLock(container, e) {
  const form = document.createElement('form');
  form.className = 'lockform';
  form.innerHTML = `<input type="password" placeholder="password" required><button type="submit">Unlock</button>`;
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
