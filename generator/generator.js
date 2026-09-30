async function loadLines(path) {
  const res = await fetch(path + '?_=' + Date.now());
  const text = await res.text();
  return text.split('\n').map(l => l.trim()).filter(Boolean);
}

async function loadTypes(path) {
  const lines = await loadLines(path);
  return lines.map(line => {
    const parts = line.split('|').map(p => p.trim());
    const [namn, tal, skydd, init, braka, bett, ovrigt] = parts;
    return { namn, tal: parseInt(tal, 10), skydd, init, braka, bett, ovrigt };
  });
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function capitalizeFirst(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

let data = null;
let currentTal = 0;

async function init() {
  const [types, overkropp, underkropp, extraKrydda, ovrigt2, loot] = await Promise.all([
    loadTypes('data/zombietyper.txt'),
    loadLines('data/overkropp.txt'),
    loadLines('data/underkropp.txt'),
    loadLines('data/extra-krydda.txt'),
    loadLines('data/ovrigt2.txt'),
    loadLines('data/loot.txt')
  ]);
  data = { types, overkropp, underkropp, extraKrydda, ovrigt2, loot };

  document.getElementById('rollBtn').addEventListener('click', rollZombie);
  document.getElementById('talMinus').addEventListener('click', () => adjustTal(-1));
  document.getElementById('talPlus').addEventListener('click', () => adjustTal(1));
}

function adjustTal(delta) {
  currentTal = Math.max(0, currentTal + delta);
  document.getElementById('statTal').textContent = currentTal;
}

function rollZombie() {
  if (!data || !data.types.length) return;

  const type = pick(data.types);
  const flavor = [pick(data.overkropp), pick(data.underkropp), pick(data.extraKrydda)].join(' ');

  document.getElementById('flavorText').textContent = capitalizeFirst(flavor);
  document.getElementById('statTyp').textContent = type.namn;
  currentTal = type.tal;
  document.getElementById('statTal').textContent = currentTal;
  document.getElementById('statSkydd').textContent = type.skydd;
  document.getElementById('statInit').textContent = type.init;
  document.getElementById('statBraka').textContent = type.braka;
  document.getElementById('statBett').textContent = type.bett;
  document.getElementById('statOvrigt').textContent = type.ovrigt;
  document.getElementById('lootText').textContent = pick(data.loot);
  document.getElementById('ovrigt2Text').textContent = pick(data.ovrigt2);

  document.getElementById('result').style.display = 'block';
}

init();
