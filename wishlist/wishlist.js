// ============================================================
//  LEGO WISHLIST — DiVersoes
//  Keys are loaded from config.js (WISHLIST_CONFIG)
// ============================================================

const STORAGE_KEY = 'lego-wishlist-v1';
const JSONBIN     = 'https://api.jsonbin.io/v3';

const TAG_COLORS = [
  '#C9547A', '#7B6EA8', '#5B9E8A', '#C47A3E',
  '#6A8FC4', '#B05C8A', '#6AAB72', '#A0627A',
];

// ── STATE ─────────────────────────────────────────────────────
//  Only wishlist data + cached bin ID live in state.
//  API keys come from config.js and are never stored here.

let state = {
  binId: '',   // JSONBin bin ID — auto-discovered and cached
  tags:  [],   // [{ id, name, color }]
  sets:  [],   // [{ id, setNumber, name, image, pieces, retailPrice, marketPrice, isRetired, theme, year, tagId, order }]
};

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) state = JSON.parse(saved);
  } catch (e) {
    console.error('Failed to load wishlist', e);
  }
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveState() {
  saveLocal();
  scheduleSave();
}

// ── CLOUD SYNC (JSONBin.io) ───────────────────────────────────

let syncTimer = null;

function setSyncStatus(status) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const map = {
    idle:    ['', ''],
    syncing: ['Syncing…', 'syncing'],
    synced:  ['Synced ✓', 'synced'],
    error:   ['Sync failed', 'error'],
  };
  const [text, cls] = map[status] ?? map.idle;
  el.textContent = text;
  el.className = `sync-status ${cls}`;
}

function scheduleSave() {
  if (!WISHLIST_CONFIG.jsonbinKey) return;
  clearTimeout(syncTimer);
  setSyncStatus('syncing');
  syncTimer = setTimeout(async () => {
    try {
      await cloudSave();
      setSyncStatus('synced');
      setTimeout(() => setSyncStatus('idle'), 3000);
    } catch (err) {
      console.error('Cloud save failed:', err);
      setSyncStatus('error');
    }
  }, 800);
}

// Find the existing "lego-wishlist" bin or create a new one.
// Result is cached in state.binId (localStorage) so we only
// call the list endpoint once per device.
async function getOrCreateBin() {
  // 1. Config-hardcoded ID is most reliable — takes priority
  if (WISHLIST_CONFIG.jsonbinBinId) {
    state.binId = WISHLIST_CONFIG.jsonbinBinId;
    saveLocal();
    return state.binId;
  }

  // 2. Cached from a previous session on this device
  if (state.binId) return state.binId;

  const headers = { 'X-Master-Key': WISHLIST_CONFIG.jsonbinKey };

  // 3. Discover by listing bins (JSONBin v3: result[].snippetMeta.uniqueId)
  try {
    const res = await fetch(`${JSONBIN}/b`, { headers });
    if (res.ok) {
      const data = await res.json();
      const bins = data.result ?? (Array.isArray(data) ? data : []);
      const found = bins.find(b => (b.snippetMeta?.name ?? b.metadata?.name ?? '') === 'lego-wishlist');
      const id = found?.snippetMeta?.uniqueId ?? found?.metadata?.id ?? found?.id;
      if (id) {
        state.binId = id;
        saveLocal();
        console.info('[wishlist] Found existing JSONBin:', id);
        return id;
      }
    }
  } catch (e) {
    console.warn('[wishlist] Bin listing failed, will create new bin:', e);
  }

  // 4. First ever use — create the bin
  const res = await fetch(`${JSONBIN}/b`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', 'X-Bin-Name': 'lego-wishlist', 'X-Bin-Private': 'true' },
    body: JSON.stringify({ tags: [], sets: [] }),
  });
  if (!res.ok) throw new Error(`Could not create bin (${res.status})`);
  const created = await res.json();
  const newId = created.metadata?.id;
  state.binId = newId;
  saveLocal();
  console.info('[wishlist] Created new JSONBin:', newId, '\n→ Add this as jsonbinBinId in config.js for reliable cross-device sync');
  return newId;
}

async function cloudLoad() {
  if (!WISHLIST_CONFIG.jsonbinKey) return;
  setSyncStatus('syncing');
  try {
    const binId = await getOrCreateBin();
    const res = await fetch(`${JSONBIN}/b/${binId}/latest`, {
      headers: { 'X-Master-Key': WISHLIST_CONFIG.jsonbinKey },
    });
    if (!res.ok) throw new Error(`Load failed (${res.status})`);
    const { record } = await res.json();
    if (record?.sets)  state.sets  = record.sets;
    if (record?.tags)  state.tags  = record.tags;
    saveLocal();
    render();
    setSyncStatus('synced');
    setTimeout(() => setSyncStatus('idle'), 3000);
  } catch (err) {
    console.error('Cloud load failed:', err);
    setSyncStatus('error');
  }
}

async function cloudSave() {
  const binId = await getOrCreateBin();
  const res = await fetch(`${JSONBIN}/b/${binId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Master-Key': WISHLIST_CONFIG.jsonbinKey,
    },
    body: JSON.stringify({ tags: state.tags, sets: state.sets }),
  });
  if (!res.ok) throw new Error(`Save failed (${res.status})`);
}

// ── BRICKSET API ──────────────────────────────────────────────

async function fetchSetData(rawNumber) {
  if (!WISHLIST_CONFIG.bricksetKey) {
    throw new Error('BrickSet API key not configured — check config.js.');
  }

  const setNum = rawNumber.trim().includes('-')
    ? rawNumber.trim()
    : `${rawNumber.trim()}-1`;

  const params  = JSON.stringify({ setNumber: setNum });
  const apiUrl  = `https://brickset.com/api/v3.asmx/getSets`
    + `?apiKey=${encodeURIComponent(WISHLIST_CONFIG.bricksetKey)}`
    + `&userHash=`
    + `&params=${encodeURIComponent(params)}`;

  // BrickSet blocks direct browser requests — proxy via corsproxy.io (free)
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`;

  let res;
  try {
    res = await fetch(proxyUrl);
  } catch (err) {
    throw new Error('Network error — check your connection. (' + err.message + ')');
  }

  if (!res.ok) throw new Error(`Request failed (${res.status}). Try again.`);

  const data = await res.json();

  if (data.status === 'error') {
    if (data.message?.toLowerCase().includes('invalid api key')) {
      throw new Error('Invalid BrickSet API key — check config.js.');
    }
    throw new Error(data.message || 'BrickSet API error.');
  }

  if (!data.sets?.length) {
    throw new Error(`Set "${rawNumber}" not found. Check the number and try again.`);
  }

  return mapBrickSet(data.sets[0]);
}

function mapBrickSet(s) {
  const setNumber  = s.number ? `${s.number}-${s.numberVariant ?? 1}` : String(s.setID);
  const isRetired  = s.availability === 'Retired';
  const retailPrice = s.LEGOCom?.DE?.retailPrice ?? null;

  return {
    setNumber,
    name:        s.name || `Set ${setNumber}`,
    image:       s.image?.imageURL || s.image?.thumbnailURL
                 || `https://images.brickset.com/sets/images/${setNumber}.jpg`,
    pieces:      s.pieces      ?? null,
    retailPrice,
    marketPrice: null,
    theme:       s.theme       ?? null,
    year:        s.year        ?? null,
    isRetired,
  };
}

// ── TAG HELPERS ───────────────────────────────────────────────

function nextColor() {
  const used = new Set(state.tags.map(t => t.color));
  return TAG_COLORS.find(c => !used.has(c)) ?? TAG_COLORS[state.tags.length % TAG_COLORS.length];
}

function createTag(name) {
  const tag = { id: crypto.randomUUID(), name: name.trim(), color: nextColor() };
  state.tags.push(tag);
  saveState();
  return tag;
}

function deleteTag(tagId) {
  state.sets.forEach(s => { if (s.tagId === tagId) s.tagId = null; });
  state.tags = state.tags.filter(t => t.id !== tagId);
  saveState();
}

function getTag(id) {
  return state.tags.find(t => t.id === id) ?? null;
}

// ── SET HELPERS ───────────────────────────────────────────────

function addSet(setData, tagId) {
  const inGroup = state.sets.filter(s => s.tagId === (tagId || null));
  const maxOrder = inGroup.length ? Math.max(...inGroup.map(s => s.order)) : -1;
  state.sets.push({ id: crypto.randomUUID(), tagId: tagId || null, order: maxOrder + 1, owned: false, ...setData });
  saveState();
}

function toggleOwned(setId) {
  const set = state.sets.find(s => s.id === setId);
  if (set) { set.owned = !set.owned; saveState(); }
}

function removeSet(setId) {
  state.sets = state.sets.filter(s => s.id !== setId);
  saveState();
}

function moveSet(setId, newTagId) {
  const set = state.sets.find(s => s.id === setId);
  if (!set) return;
  const target = newTagId || null;
  const others = state.sets.filter(s => s.tagId === target && s.id !== setId);
  set.tagId = target;
  set.order = others.length ? Math.max(...others.map(s => s.order)) + 1 : 0;
  saveState();
}

function reorderGroup(tagId, orderedIds) {
  orderedIds.forEach((id, i) => {
    const s = state.sets.find(s => s.id === id);
    if (s) { s.tagId = tagId; s.order = i; }
  });
  saveState();
}

function getSetsForTag(tagId) {
  return state.sets
    .filter(s => s.tagId === (tagId ?? null))
    .sort((a, b) => a.order - b.order);
}

// ── RENDER ────────────────────────────────────────────────────

function setPrice(set) {
  if (set.isRetired) return set.marketPrice ?? null;
  return set.retailPrice ?? null;
}

function statsFor(sets) {
  const owned  = sets.filter(s => s.owned);
  const wanted = sets.filter(s => !s.owned);
  const sum    = arr => arr.reduce((t, s) => t + (setPrice(s) ?? 0), 0);
  const hasPrice = arr => arr.some(s => setPrice(s) != null);
  return {
    ownedCount:  owned.length,
    ownedTotal:  hasPrice(owned)  ? sum(owned)  : null,
    wantedCount: wanted.length,
    wantedTotal: hasPrice(wanted) ? sum(wanted) : null,
  };
}

function fmt(amount) {
  if (amount == null) return null;
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
}

function renderSetCard(set) {
  let priceBadge = '';
  if (set.isRetired) {
    priceBadge = set.marketPrice != null
      ? `<span class="price-badge retired">Market ${fmt(set.marketPrice)}</span>`
      : `<span class="price-badge retired">Retired</span>`;
  } else if (set.retailPrice != null) {
    priceBadge = `<span class="price-badge retail">Retail ${fmt(set.retailPrice)}</span>`;
  }

  const metas = [
    set.pieces ? `${set.pieces} pcs` : null,
    set.theme  || null,
    set.year   ? String(set.year) : null,
  ].filter(Boolean).map(m => `<span class="set-meta">${m}</span>`).join('');

  const tagOptions = state.tags.map(t =>
    `<option value="${t.id}"${set.tagId === t.id ? ' selected' : ''}>${t.name}</option>`
  ).join('');

  const ownedClass  = set.owned ? ' owned' : '';
  const ownedToggle = `<button class="owned-toggle${set.owned ? ' is-owned' : ''}" data-set-id="${set.id}">${set.owned ? '✓ Got it!' : '○ Want it'}</button>`;

  return `
    <div class="set-card${ownedClass}" data-id="${set.id}">
      <div class="drag-handle" title="Drag to reorder">&#8942;&#8942;</div>
      <img class="set-img"
           src="${set.image}"
           alt="${set.name}"
           onerror="this.src='https://images.brickset.com/sets/images/${set.setNumber}.jpg';this.onerror=null" />
      <div class="set-info">
        <div class="set-header">
          <span class="set-number">#${set.setNumber}</span>
          <h3 class="set-name">${set.name}</h3>
        </div>
        ${metas ? `<div class="set-metas">${metas}</div>` : ''}
        <div class="set-footer">
          ${priceBadge}
          ${ownedToggle}
          <select class="tag-select" data-set-id="${set.id}">
            <option value="">— No tag —</option>
            ${tagOptions}
          </select>
          <button class="btn-remove" data-set-id="${set.id}" title="Remove">&times;</button>
        </div>
      </div>
    </div>`;
}

function renderGroupStats(stats) {
  if (!stats.ownedCount && !stats.wantedCount) return '';
  const parts = [];
  if (stats.wantedCount) {
    const price = stats.wantedTotal != null ? ` · ${fmt(stats.wantedTotal)}` : '';
    parts.push(`<span class="gs-wanted">${stats.wantedCount} wanted${price}</span>`);
  }
  if (stats.ownedCount) {
    const price = stats.ownedTotal != null ? ` · ${fmt(stats.ownedTotal)}` : '';
    parts.push(`<span class="gs-owned">${stats.ownedCount} owned${price}</span>`);
  }
  return `<div class="group-stats">${parts.join('<span class="gs-sep">·</span>')}</div>`;
}

function renderGroup(tagId, label, color) {
  const sets = getSetsForTag(tagId);
  const nid  = tagId ?? 'null';

  const setsHtml = sets.length
    ? sets.map(renderSetCard).join('')
    : `<div class="group-empty">No sets here yet — drag one in or add with this tag</div>`;

  const deleteBtn = tagId
    ? `<button class="btn-delete-tag" data-tag-id="${tagId}" title="Delete tag">&times;</button>`
    : '';

  return `
    <div class="wl-group" data-tag-id="${nid}">
      <div class="group-header">
        <span class="group-dot" style="background:${color}"></span>
        <span class="group-label">${label}</span>
        ${renderGroupStats(statsFor(sets))}
        ${deleteBtn}
      </div>
      <div class="sortable-list" data-tag-id="${nid}">${setsHtml}</div>
    </div>`;
}

function renderTagsBar() {
  document.getElementById('tags-list').innerHTML = state.tags.map(t =>
    `<button class="tag-filter-btn" style="--tag-color:${t.color}" data-tag-id="${t.id}">${t.name}</button>`
  ).join('');
}

function renderTagPicker() {
  const picker = document.getElementById('tag-picker');
  if (!picker) return;
  picker.innerHTML = `
    <label class="tag-option">
      <input type="radio" name="new-set-tag" value="" checked />
      <span class="tag-option-label">No tag</span>
    </label>
    ${state.tags.map(t => `
    <label class="tag-option">
      <input type="radio" name="new-set-tag" value="${t.id}" />
      <span class="tag-option-label" style="--tag-color:${t.color}">${t.name}</span>
    </label>`).join('')}`;
}

function renderWishlist() {
  const container = document.getElementById('wishlist-container');

  let html = renderGroup(null, 'Untagged', '#555');
  state.tags.forEach(t => { html += renderGroup(t.id, t.name, t.color); });
  container.innerHTML = html;

  container.querySelectorAll('.sortable-list').forEach(list => {
    const tagId = list.dataset.tagId === 'null' ? null : list.dataset.tagId;
    Sortable.create(list, {
      group: 'wishlist-sets',
      handle: '.drag-handle',
      animation: 150,
      ghostClass: 'drag-ghost',
      chosenClass: 'sortable-chosen',
      onEnd(evt) {
        const newTagId = evt.to.dataset.tagId   === 'null' ? null : evt.to.dataset.tagId;
        const oldTagId = evt.from.dataset.tagId === 'null' ? null : evt.from.dataset.tagId;
        reorderGroup(newTagId, [...evt.to.querySelectorAll(':scope > .set-card')].map(el => el.dataset.id));
        if (evt.from !== evt.to) {
          reorderGroup(oldTagId, [...evt.from.querySelectorAll(':scope > .set-card')].map(el => el.dataset.id));
        }
        // Re-render so tag selects and owned state reflect the move
        setTimeout(() => render(), 0);
      },
    });
  });

  container.querySelectorAll('.owned-toggle').forEach(btn => {
    btn.addEventListener('click', () => { toggleOwned(btn.dataset.setId); render(); });
  });

  container.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', () => { removeSet(btn.dataset.setId); render(); });
  });
  container.querySelectorAll('.tag-select').forEach(sel => {
    sel.addEventListener('change', () => { moveSet(sel.dataset.setId, sel.value || null); render(); });
  });
  container.querySelectorAll('.btn-delete-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm(`Delete tag "${getTag(btn.dataset.tagId)?.name}"? Sets will move to Untagged.`)) {
        deleteTag(btn.dataset.tagId); render();
      }
    });
  });

  document.getElementById('empty-state').classList.toggle('hidden', state.sets.length > 0);
}

function renderSummary() {
  const el = document.getElementById('wl-summary');
  if (!el) return;
  if (!state.sets.length) { el.innerHTML = ''; return; }

  const s = statsFor(state.sets);

  const wantedPrice = s.wantedTotal != null ? `<strong>${fmt(s.wantedTotal)}</strong>` : '';
  const ownedPrice  = s.ownedTotal  != null ? `<strong>${fmt(s.ownedTotal)}</strong>`  : '';

  el.innerHTML = `
    <div class="summary-chip summary-wanted">
      <span class="summary-label">Wishlist</span>
      <span class="summary-count">${s.wantedCount} set${s.wantedCount !== 1 ? 's' : ''}</span>
      ${wantedPrice ? `<span class="summary-price">${wantedPrice}</span>` : ''}
    </div>
    <div class="summary-chip summary-owned">
      <span class="summary-label">Owned</span>
      <span class="summary-count">${s.ownedCount} set${s.ownedCount !== 1 ? 's' : ''}</span>
      ${ownedPrice ? `<span class="summary-price">${ownedPrice}</span>` : ''}
    </div>`;
}

function render() {
  renderSummary();
  renderTagsBar();
  renderTagPicker();
  renderWishlist();
}

// ── EVENTS ────────────────────────────────────────────────────

function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className = `hint ${type}`;
}

async function handleFetch() {
  const input  = document.getElementById('set-number-input');
  const status = document.getElementById('fetch-status');
  const btn    = document.getElementById('btn-fetch');
  const numRaw = input.value.trim();

  if (!numRaw) { setStatus(status, 'Enter a set number first.', 'error'); return; }

  btn.disabled    = true;
  btn.textContent = 'Fetching…';
  setStatus(status, '', '');

  try {
    const setData   = await fetchSetData(numRaw);
    const pickedTag = document.querySelector('input[name="new-set-tag"]:checked')?.value || null;
    addSet(setData, pickedTag || null);
    render();
    input.value = '';
    setStatus(status, `Added: ${setData.name}`, 'success');
    setTimeout(() => {
      document.getElementById('add-panel').classList.add('hidden');
      status.textContent = '';
    }, 1500);
  } catch (err) {
    setStatus(status, err.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Fetch & Add';
  }
}

function handleCreateTag() {
  const input = document.getElementById('tag-name-input');
  const name  = input.value.trim();
  if (!name) return;
  if (state.tags.find(t => t.name.toLowerCase() === name.toLowerCase())) {
    input.style.outline = '2px solid #f87171';
    setTimeout(() => { input.style.outline = ''; }, 1000);
    return;
  }
  createTag(name);
  document.getElementById('tag-modal').classList.add('hidden');
  render();
}

function initEvents() {
  document.getElementById('btn-add').addEventListener('click', () => {
    const panel    = document.getElementById('add-panel');
    const isHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !isHidden);
    if (isHidden) {
      renderTagPicker();
      setTimeout(() => document.getElementById('set-number-input').focus(), 50);
    }
  });

  document.getElementById('btn-fetch').addEventListener('click', handleFetch);
  document.getElementById('set-number-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleFetch();
  });

  document.getElementById('tags-list').addEventListener('click', e => {
    const btn = e.target.closest('.tag-filter-btn');
    if (!btn) return;
    document.querySelector(`.wl-group[data-tag-id="${btn.dataset.tagId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.getElementById('btn-new-tag').addEventListener('click', () => {
    document.getElementById('tag-modal').classList.remove('hidden');
    document.getElementById('tag-name-input').value = '';
    setTimeout(() => document.getElementById('tag-name-input').focus(), 50);
  });

  document.getElementById('btn-cancel-tag').addEventListener('click', () => {
    document.getElementById('tag-modal').classList.add('hidden');
  });

  document.getElementById('btn-confirm-tag').addEventListener('click', handleCreateTag);

  document.getElementById('tag-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleCreateTag();
    if (e.key === 'Escape') document.getElementById('tag-modal').classList.add('hidden');
  });

  document.getElementById('tag-modal').addEventListener('click', e => {
    if (e.target.id === 'tag-modal') document.getElementById('tag-modal').classList.add('hidden');
  });
}

// ── BOOT ──────────────────────────────────────────────────────

loadState();
initEvents();
render();
cloudLoad(); // pulls latest from cloud; re-renders when done
