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
  apiKey: '',
  tags: [],   // [{ id, name, color }]
  sets: [],   // [{ id, setNumber, name, image, pieces, retailPrice, marketPrice, isRetired, theme, year, tagId, order }]
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
}

// ── API ──────────────────────────────────────────────────────

async function fetchSetData(rawNumber) {
  if (!state.apiKey) {
    throw new Error('No API key — open Settings and paste your BrickEconomy API key.');
  }

  // Accept "75257" or "75257-1"
  const setNum = rawNumber.trim().includes('-')
    ? rawNumber.trim()
    : `${rawNumber.trim()}-1`;

  const url = `https://www.brickeconomy.com/api/v1/sets/${encodeURIComponent(setNum)}`;

  let res;
  try {
    res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${state.apiKey}`,
        'Accept': 'application/json',
      },
    });
  } catch (err) {
    // Most likely a CORS or network error
    throw new Error(
      'Could not reach BrickEconomy. This might be a CORS restriction — ' +
      'the API may not allow direct browser requests. ' +
      '(Error: ' + err.message + ')'
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error('Invalid or expired API key — check Settings.');
  }
  if (res.status === 404) {
    throw new Error(`Set "${rawNumber}" not found on BrickEconomy.`);
  }
  if (!res.ok) {
    throw new Error(`API returned ${res.status}. Try again later.`);
  }

  const data = await res.json();
  return mapApiResponse(data, rawNumber.trim());
}

// ─────────────────────────────────────────────────────────────
//  MAP API RESPONSE
//  These field names are best-guesses. Once you test and see
//  the actual JSON, update the property names below in ~30s.
// ─────────────────────────────────────────────────────────────
function mapApiResponse(data, inputNumber) {
  const setNumber = data.set_number ?? data.number ?? data.id ?? inputNumber;

  const isRetired =
    data.retired === true  ||
    data.available === false ||
    data.availability === 'retired' ||
    data.status === 'retired' ||
    data.is_retired === true;

  // Image: use API value or fall back to BrickSet CDN (publicly accessible)
  const image =
    data.image_url ?? data.image ?? data.thumbnail ??
    `https://images.brickset.com/sets/images/${setNumber}.jpg`;

  return {
    setNumber,
    name:        data.name        ?? data.title       ?? `Set ${setNumber}`,
    image,
    pieces:      data.pieces      ?? data.piece_count ?? data.num_parts ?? null,
    retailPrice: data.retail_price ?? data.rrp        ?? data.msrp      ?? null,
    marketPrice: data.current_price ?? data.lowest_price ?? data.market_price ?? null,
    theme:       data.theme       ?? data.theme_name  ?? null,
    year:        data.year        ?? data.release_year ?? null,
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
    if (isHidden) document.getElementById('api-key-input').value = state.apiKey || '';
  });

  document.getElementById('btn-save-key').addEventListener('click', () => {
    const key = document.getElementById('api-key-input').value.trim();
    state.apiKey = key;
    saveState();
    const s = document.getElementById('api-key-status');
    setStatus(s, key ? 'API key saved.' : 'API key cleared.', 'success');
    setTimeout(() => { s.textContent = ''; s.className = 'hint'; }, 3000);
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
}

// ── BOOT ─────────────────────────────────────────────────────

loadState();
initEvents();
render();
