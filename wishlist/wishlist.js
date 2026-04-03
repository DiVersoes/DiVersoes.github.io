// ============================================================
//  LEGO WISHLIST — DiVersoes
// ============================================================

const STORAGE_KEY = 'lego-wishlist-v1';

const TAG_COLORS = [
  '#7c3aed', '#dc2626', '#d97706', '#16a34a',
  '#2563eb', '#db2777', '#0891b2', '#ea580c',
];

// ── STATE ────────────────────────────────────────────────────

let state = {
  apiKey: '',   // BrickSet API key (device-local)
  binKey: '',   // JSONBin master key (device-local)
  binId:  '',   // JSONBin bin ID (shared across devices)
  tags: [],     // [{ id, name, color }]
  sets: [],     // [{ id, setNumber, name, image, pieces, retailPrice, marketPrice, isRetired, theme, year, tagId, order }]
};

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) state = JSON.parse(saved);
  } catch (e) {
    console.error('Failed to load wishlist state', e);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleSave();
}

// ── CLOUD SYNC (JSONBin.io) ───────────────────────────────────

const JSONBIN = 'https://api.jsonbin.io/v3';
let syncTimer = null;

function setSyncStatus(status) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const map = {
    idle:    { text: '',            cls: '' },
    syncing: { text: 'Syncing…',    cls: 'syncing' },
    synced:  { text: 'Synced ✓',   cls: 'synced'  },
    error:   { text: 'Sync failed', cls: 'error'   },
    offline: { text: 'No cloud key — changes local only', cls: 'error' },
  };
  const s = map[status] || map.idle;
  el.textContent = s.text;
  el.className = `sync-status ${s.cls}`;
}

function scheduleSave() {
  if (!state.binKey) { setSyncStatus('offline'); return; }
  clearTimeout(syncTimer);
  setSyncStatus('syncing');
  syncTimer = setTimeout(async () => {
    try {
      await cloudSave();
      setSyncStatus('synced');
      setTimeout(() => setSyncStatus('idle'), 3000);
    } catch (err) {
      console.error('Cloud save failed', err);
      setSyncStatus('error');
    }
  }, 800);
}

async function cloudSave() {
  const payload = { tags: state.tags, sets: state.sets };
  const headers = {
    'Content-Type': 'application/json',
    'X-Master-Key': state.binKey,
  };

  if (!state.binId) {
    // First save — create a new private bin
    const res = await fetch(`${JSONBIN}/b`, {
      method: 'POST',
      headers: { ...headers, 'X-Bin-Name': 'lego-wishlist', 'X-Bin-Private': 'true' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Create bin failed: ${res.status}`);
    const data = await res.json();
    state.binId = data.metadata?.id;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    // Show the bin ID in settings so user can copy it for other devices
    const binIdEl = document.getElementById('bin-id-display');
    if (binIdEl) { binIdEl.value = state.binId; binIdEl.closest('.bin-id-row')?.classList.remove('hidden'); }
  } else {
    const res = await fetch(`${JSONBIN}/b/${state.binId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Update bin failed: ${res.status}`);
  }
}

async function cloudLoad() {
  if (!state.binKey || !state.binId) return;
  setSyncStatus('syncing');
  try {
    const res = await fetch(`${JSONBIN}/b/${state.binId}/latest`, {
      headers: { 'X-Master-Key': state.binKey },
    });
    if (!res.ok) throw new Error(`Load bin failed: ${res.status}`);
    const data = await res.json();
    const record = data.record;
    if (record?.sets) state.sets = record.sets;
    if (record?.tags) state.tags = record.tags;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render();
    setSyncStatus('synced');
    setTimeout(() => setSyncStatus('idle'), 3000);
  } catch (err) {
    console.error('Cloud load failed', err);
    setSyncStatus('error');
  }
}

// ── API ──────────────────────────────────────────────────────

// BrickSet API v3 — free, requires account at brickset.com
// Routed through corsproxy.io because BrickSet doesn't allow browser requests directly.

async function fetchSetData(rawNumber) {
  if (!state.apiKey) {
    throw new Error('No API key — open Settings and paste your BrickSet API key.');
  }

  // BrickSet uses "75257-1" format (number + variant)
  const setNum = rawNumber.trim().includes('-')
    ? rawNumber.trim()
    : `${rawNumber.trim()}-1`;

  const params = JSON.stringify({ setNumber: setNum });
  const apiUrl =
    `https://brickset.com/api/v3.asmx/getSets` +
    `?apiKey=${encodeURIComponent(state.apiKey)}` +
    `&userHash=` +
    `&params=${encodeURIComponent(params)}`;

  // Free CORS proxy — required because BrickSet blocks direct browser requests
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`;

  let res;
  try {
    res = await fetch(proxyUrl);
  } catch (err) {
    throw new Error('Network error — check your internet connection. (' + err.message + ')');
  }

  if (!res.ok) {
    throw new Error(`Request failed (${res.status}). Try again.`);
  }

  const data = await res.json();

  if (data.status === 'error') {
    if (data.message?.toLowerCase().includes('invalid api key')) {
      throw new Error('Invalid API key — check Settings.');
    }
    throw new Error(data.message || 'BrickSet API error.');
  }

  if (!data.sets || data.sets.length === 0) {
    throw new Error(`Set "${rawNumber}" not found. Check the number and try again.`);
  }

  return mapBrickSet(data.sets[0]);
}

function mapBrickSet(s) {
  const setNumber = s.number ? `${s.number}-${s.numberVariant ?? 1}` : String(s.setID);

  // BrickSet availability values: "Retail", "Retired", "LEGO exclusive", "Not for sale", etc.
  const isRetired = s.availability === 'Retired';

  const retailPrice = s.LEGOCom?.US?.retailPrice ?? null;

  return {
    setNumber,
    name:        s.name  || `Set ${setNumber}`,
    image:       s.image?.imageURL || s.image?.thumbnailURL
                 || `https://images.brickset.com/sets/images/${setNumber}.jpg`,
    pieces:      s.pieces      ?? null,
    retailPrice,
    marketPrice: null,   // BrickSet doesn't carry resale market prices
    theme:       s.theme       ?? null,
    year:        s.year        ?? null,
    isRetired,
  };
}

// ── TAG HELPERS ──────────────────────────────────────────────

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

// ── SET HELPERS ──────────────────────────────────────────────

function addSet(setData, tagId) {
  const inGroup = state.sets.filter(s => s.tagId === (tagId || null));
  const maxOrder = inGroup.length ? Math.max(...inGroup.map(s => s.order)) : -1;
  const set = { id: crypto.randomUUID(), tagId: tagId || null, order: maxOrder + 1, ...setData };
  state.sets.push(set);
  saveState();
  return set;
}

function removeSet(setId) {
  state.sets = state.sets.filter(s => s.id !== setId);
  saveState();
}

function moveSet(setId, newTagId) {
  const set = state.sets.find(s => s.id === setId);
  if (!set) return;
  const targetTag = newTagId || null;
  const others = state.sets.filter(s => s.tagId === targetTag && s.id !== setId);
  set.tagId = targetTag;
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

// ── RENDER HELPERS ───────────────────────────────────────────

function fmt(amount) {
  if (amount == null) return null;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function renderSetCard(set) {
  let priceBadge = '';
  if (set.isRetired) {
    priceBadge = set.marketPrice != null
      ? `<span class="price-badge retired">Market ${fmt(set.marketPrice)}</span>`
      : `<span class="price-badge retired">Retired</span>`;
  } else {
    priceBadge = set.retailPrice != null
      ? `<span class="price-badge retail">Retail ${fmt(set.retailPrice)}</span>`
      : '';
  }

  const metas = [
    set.pieces ? `${set.pieces} pcs` : null,
    set.theme  || null,
    set.year   ? String(set.year) : null,
  ].filter(Boolean).map(m => `<span class="set-meta">${m}</span>`).join('');

  const tagOptions = state.tags.map(t =>
    `<option value="${t.id}"${set.tagId === t.id ? ' selected' : ''}>${t.name}</option>`
  ).join('');

  return `
    <div class="set-card" data-id="${set.id}">
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
          <select class="tag-select" data-set-id="${set.id}">
            <option value="">— No tag —</option>
            ${tagOptions}
          </select>
          <button class="btn-remove" data-set-id="${set.id}" title="Remove">&times;</button>
        </div>
      </div>
    </div>`;
}

function renderGroup(tagId, label, color) {
  const sets = getSetsForTag(tagId);
  const normalizedId = tagId ?? 'null';

  const setsHtml = sets.length
    ? sets.map(renderSetCard).join('')
    : `<div class="group-empty">No sets here yet — drag one in or add with this tag</div>`;

  const deleteBtn = tagId
    ? `<button class="btn-delete-tag" data-tag-id="${tagId}" title="Delete tag">&times;</button>`
    : '';

  return `
    <div class="wl-group" data-tag-id="${normalizedId}">
      <div class="group-header">
        <span class="group-dot" style="background:${color}"></span>
        <span class="group-label">${label}</span>
        <span class="group-count">${sets.length}</span>
        ${deleteBtn}
      </div>
      <div class="sortable-list" data-tag-id="${normalizedId}">
        ${setsHtml}
      </div>
    </div>`;
}

function renderTagsBar() {
  document.getElementById('tags-list').innerHTML = state.tags.map(t => `
    <button class="tag-filter-btn" style="--tag-color:${t.color}" data-tag-id="${t.id}">${t.name}</button>
  `).join('');
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
    </label>`).join('')}
  `;
}

function renderWishlist() {
  const container = document.getElementById('wishlist-container');

  let html = renderGroup(null, 'Untagged', '#555');
  state.tags.forEach(t => { html += renderGroup(t.id, t.name, t.color); });
  container.innerHTML = html;

  // Init SortableJS — allow dragging between groups
  container.querySelectorAll('.sortable-list').forEach(list => {
    const rawTagId = list.dataset.tagId;
    const tagId = rawTagId === 'null' ? null : rawTagId;

    Sortable.create(list, {
      group: 'wishlist-sets',
      handle: '.drag-handle',
      animation: 150,
      ghostClass: 'drag-ghost',
      chosenClass: 'sortable-chosen',
      onEnd(evt) {
        const toRaw = evt.to.dataset.tagId;
        const fromRaw = evt.from.dataset.tagId;
        const newTagId = toRaw === 'null' ? null : toRaw;
        const oldTagId = fromRaw === 'null' ? null : fromRaw;

        // Re-sync destination group order
        const destIds = [...evt.to.querySelectorAll(':scope > .set-card')].map(el => el.dataset.id);
        reorderGroup(newTagId, destIds);

        // Re-sync source group order (if different)
        if (evt.from !== evt.to) {
          const srcIds = [...evt.from.querySelectorAll(':scope > .set-card')].map(el => el.dataset.id);
          reorderGroup(oldTagId, srcIds);
        }
      },
    });
  });

  // Card events — remove & tag change
  container.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', () => { removeSet(btn.dataset.setId); render(); });
  });

  container.querySelectorAll('.tag-select').forEach(sel => {
    sel.addEventListener('change', () => { moveSet(sel.dataset.setId, sel.value || null); render(); });
  });

  container.querySelectorAll('.btn-delete-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = getTag(btn.dataset.tagId);
      if (confirm(`Delete tag "${tag?.name}"? Sets will move to Untagged.`)) {
        deleteTag(btn.dataset.tagId);
        render();
      }
    });
  });

  // Empty state toggle
  document.getElementById('empty-state').classList.toggle('hidden', state.sets.length > 0);
}

function render() {
  renderTagsBar();
  renderTagPicker();
  renderWishlist();
}

// ── EVENTS ───────────────────────────────────────────────────

function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className = `hint ${type}`;
}

async function handleFetch() {
  const input   = document.getElementById('set-number-input');
  const status  = document.getElementById('fetch-status');
  const btn     = document.getElementById('btn-fetch');
  const numRaw  = input.value.trim();

  if (!numRaw) { setStatus(status, 'Enter a set number first.', 'error'); return; }

  btn.disabled = true;
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
    btn.disabled = false;
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
  // Settings
  document.getElementById('btn-settings').addEventListener('click', () => {
    const panel = document.getElementById('settings-panel');
    const isHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !isHidden);
    document.getElementById('add-panel').classList.add('hidden');
    if (isHidden) {
      document.getElementById('api-key-input').value  = state.apiKey || '';
      document.getElementById('bin-key-input').value  = state.binKey || '';
      document.getElementById('bin-id-input').value   = state.binId  || '';
      const binIdDisplay = document.getElementById('bin-id-display');
      if (binIdDisplay) {
        binIdDisplay.value = state.binId || '';
        binIdDisplay.closest('.bin-id-row')?.classList.toggle('hidden', !state.binId);
      }
    }
  });

  document.getElementById('btn-save-key').addEventListener('click', async () => {
    const bricksetKey = document.getElementById('api-key-input').value.trim();
    const binKey      = document.getElementById('bin-key-input').value.trim();
    const binId       = document.getElementById('bin-id-input').value.trim();
    const s           = document.getElementById('api-key-status');

    state.apiKey = bricksetKey;
    state.binKey = binKey;
    if (binId) state.binId = binId;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    setStatus(s, 'Settings saved.', 'success');
    setTimeout(() => { s.textContent = ''; s.className = 'hint'; }, 3000);

    // Show bin ID row if we already have one
    const binIdDisplay = document.getElementById('bin-id-display');
    if (binIdDisplay) {
      binIdDisplay.value = state.binId || '';
      binIdDisplay.closest('.bin-id-row')?.classList.toggle('hidden', !state.binId);
    }

    // If we have a binKey and binId, load from cloud now
    if (binKey && binId) {
      await cloudLoad();
    } else if (binKey && !state.binId) {
      // First time with key — trigger a save to create the bin
      scheduleSave();
    }
  });

  // Add set panel
  document.getElementById('btn-add').addEventListener('click', () => {
    const panel = document.getElementById('add-panel');
    const isHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !isHidden);
    document.getElementById('settings-panel').classList.add('hidden');
    if (isHidden) {
      renderTagPicker();
      setTimeout(() => document.getElementById('set-number-input').focus(), 50);
    }
  });

  document.getElementById('btn-fetch').addEventListener('click', handleFetch);
  document.getElementById('set-number-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleFetch();
  });

  // Tags bar — scroll to group on click
  document.getElementById('tags-list').addEventListener('click', e => {
    const btn = e.target.closest('.tag-filter-btn');
    if (!btn) return;
    document.querySelector(`.wl-group[data-tag-id="${btn.dataset.tagId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // New tag
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

  document.getElementById('btn-copy-bin-id')?.addEventListener('click', () => {
    const val = document.getElementById('bin-id-display')?.value;
    if (!val) return;
    navigator.clipboard.writeText(val).then(() => {
      const btn = document.getElementById('btn-copy-bin-id');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    });
  });
}

// ── BOOT ─────────────────────────────────────────────────────

loadState();
initEvents();
render();

// After initial render from localStorage, pull latest from cloud
cloudLoad();
