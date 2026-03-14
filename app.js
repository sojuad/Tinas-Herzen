(() => {
  const $ = id => document.getElementById(id);

  // ── Continent config ──────────────────────────────────────────
  const CONTINENTS = ['Europa', 'Asien', 'Nordamerika', 'Südamerika', 'Afrika', 'Ozeanien'];
  const slugify = s => s.toLowerCase().replace(/ü/g,'ue').replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/\s+/g,'-');
  const continentClass = s => {
    const map = {
      'europa':'europa','asien':'asien',
      'nordamerika':'nordamerika','südamerika':'suedamerika',
      'sued-amerika':'suedamerika','nord-amerika':'nordamerika',
      'afrika':'afrika','ozeanien':'ozeanien'
    };
    return 'continent-' + (map[s.toLowerCase()] || 'andere');
  };

  const sanitizeUrl = url => {
    if (!url) return '';
    try { return new URL(url).toString(); } catch { return ''; }
  };

  const extractDriveId = url => {
    if (!url) return '';
    try {
      const u = new URL(url);
      if (!/drive\.google\.com$/.test(u.hostname)) return '';
      const m = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
      if (m) return m[1];
      return u.searchParams.get('id') || '';
    } catch { return ''; }
  };

  const normalizePhoto = url => {
    const clean = sanitizeUrl(url);
    if (!clean) return '';
    const id = extractDriveId(clean);
    if (id) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w800`;
    return clean;
  };

  const escHtml = s => String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');

  const toCoord = x => (Math.round(x * 1e5) / 1e5).toFixed(5);

  const toast = msg => {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2200);
  };

  // ── State ─────────────────────────────────────────────────────
  let allPlaces = [];
  let activeContinent = 'Alle';
  let searchQ = '';
  let selectedId = null;

  // ── Map ───────────────────────────────────────────────────────
  const map = L.map('map', { center: [20, 10], zoom: 2, worldCopyJump: true, preferCanvas: true });

  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  });
  const esri = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Tiles &copy; Esri' }
  );
  osm.addTo(map);
  L.control.layers({ 'Karte': osm, 'Satellit': esri }, null, { position: 'topleft' }).addTo(map);

  const markersLayer = L.layerGroup().addTo(map);
  const markerById = new Map();

  // ── Filter & render ───────────────────────────────────────────
  const filtered = () => {
    const q = searchQ.toLowerCase();
    return allPlaces.filter(p => {
      const contMatch = activeContinent === 'Alle' || p.continent === activeContinent;
      const qMatch = !q ||
        (p.title || '').toLowerCase().includes(q) ||
        (p.note || '').toLowerCase().includes(q) ||
        (p.continent || '').toLowerCase().includes(q);
      return contMatch && qMatch;
    });
  };

  const renderAll = () => {
    const src = filtered();
    renderList(src);
    renderMarkers(src);
    updateCount(src.length);
  };

  const updateCount = n => {
    $('countBar').innerHTML = `<b>${n}</b> Ort${n !== 1 ? 'e' : ''} gefunden`;
  };

  // ── Markers ───────────────────────────────────────────────────
  const hoverHtml = p => {
    const photo = normalizePhoto(p.photo);
    const badge = p.continent || '';
    if (!photo) return `<div class="hovercard"><div class="hc-title">${escHtml(p.title)}</div><div class="hc-badge">${escHtml(badge)}</div></div>`;
    return `<div class="hovercard"><div class="hc-title">${escHtml(p.title)}</div><img src="${photo}" alt=""/><div class="hc-badge">${escHtml(badge)}</div></div>`;
  };

  const renderMarkers = src => {
    markersLayer.clearLayers();
    markerById.clear();
    src.forEach(p => {
      const m = L.marker([p.lat, p.lng]);
      m.bindTooltip(hoverHtml(p), {
        direction: 'top', offset: [0, -8], opacity: 1,
        className: 'hovercard', sticky: false
      });
      m.on('mouseover', () => m.openTooltip());
      m.on('mouseout', () => m.closeTooltip());
      m.on('click', () => selectPlace(p.id));
      m.addTo(markersLayer);
      markerById.set(p.id, m);
    });
  };

  // ── List ──────────────────────────────────────────────────────
  const listEl = $('list');

  const renderList = src => {
    listEl.innerHTML = '';
    if (src.length === 0) {
      listEl.innerHTML = `<div class="empty">Keine Orte gefunden.<br>Versuche einen anderen Filter oder Suchbegriff.</div>`;
      return;
    }
    src.forEach(p => {
      const card = document.createElement('div');
      card.className = 'card' + (p.id === selectedId ? ' selected' : '');
      card.dataset.id = p.id;
      const safeUrl = sanitizeUrl(p.url);
      const contCls = continentClass(p.continent || '');

      card.innerHTML = `
        <div class="card-top">
          <div class="card-title">${escHtml(p.title)}</div>
          <span class="card-continent ${contCls}">${escHtml(p.continent || '–')}</span>
        </div>
        ${p.note ? `<div class="card-note">${escHtml(p.note)}</div>` : ''}
        <div class="card-actions">
          <button class="smallbtn" data-action="zoom">↗ Zoomen</button>
          ${safeUrl ? `<button class="smallbtn" data-action="open">🔗 Link</button>` : ''}
        </div>
      `;

      card.addEventListener('click', e => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'zoom') {
          selectPlace(p.id);
          map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 7), { duration: 0.8 });
          markerById.get(p.id)?.openPopup();
        } else if (action === 'open') {
          window.open(safeUrl, '_blank', 'noopener,noreferrer');
        } else {
          selectPlace(p.id);
        }
      });

      listEl.appendChild(card);
    });
  };

  // ── Select / Preview ──────────────────────────────────────────
  const selectPlace = id => {
    selectedId = id;
    // highlight card
    document.querySelectorAll('.card').forEach(c => {
      c.classList.toggle('selected', c.dataset.id === id);
    });
    // scroll card into view
    const cardEl = listEl.querySelector(`[data-id="${id}"]`);
    cardEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    const p = allPlaces.find(x => x.id === id);
    if (!p) { $('preview').classList.add('hidden'); return; }

    $('preview').classList.remove('hidden');
    $('previewTitle').textContent = p.title;
    $('previewMeta').textContent = `${toCoord(p.lat)}, ${toCoord(p.lng)}  ·  ${p.continent || ''}`;

    const photo = normalizePhoto(p.photo);
    const img = $('previewImg');
    if (photo) {
      img.src = photo;
      img.classList.remove('hidden');
      $('previewNoImg').style.display = 'none';
    } else {
      img.classList.add('hidden');
      img.removeAttribute('src');
      $('previewNoImg').style.display = 'flex';
    }

    const noteEl = $('previewNote');
    if (p.note) { noteEl.textContent = p.note; noteEl.classList.remove('hidden'); }
    else { noteEl.classList.add('hidden'); }

    const safeUrl = sanitizeUrl(p.url);
    const btnLink = $('previewLink');
    if (safeUrl) {
      btnLink.style.display = 'inline-flex';
      btnLink.onclick = () => window.open(safeUrl, '_blank', 'noopener,noreferrer');
    } else {
      btnLink.style.display = 'none';
    }
  };

  $('previewImg').addEventListener('error', () => {
    $('previewImg').classList.add('hidden');
    $('previewNoImg').style.display = 'flex';
  });

  // ── Chips ─────────────────────────────────────────────────────
  const chipsEl = $('chips');
  const buildChips = () => {
    const all = ['Alle', ...CONTINENTS];
    chipsEl.innerHTML = '';
    all.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'chip' + (c === activeContinent ? ' active' : '');
      btn.textContent = c;
      btn.addEventListener('click', () => {
        activeContinent = c;
        document.querySelectorAll('.chip').forEach(b => b.classList.toggle('active', b.textContent === c));
        renderAll();
      });
      chipsEl.appendChild(btn);
    });
  };

  // ── Search ────────────────────────────────────────────────────
  $('search').addEventListener('input', e => {
    searchQ = e.target.value.trim();
    renderAll();
  });

  // ── Load places.json ──────────────────────────────────────────
  const loadPlaces = async () => {
    listEl.innerHTML = '<div class="loading">Lade Orte …</div>';
    try {
      const res = await fetch('./places.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      allPlaces = Array.isArray(data) ? data.filter(p =>
        p.title && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))
      ).map(p => ({ ...p, lat: Number(p.lat), lng: Number(p.lng) })) : [];

      buildChips();
      renderAll();
      if (allPlaces.length) selectPlace(allPlaces[0].id);
    } catch (err) {
      listEl.innerHTML = `<div class="empty">Fehler beim Laden der Orte:<br>${escHtml(err.message)}</div>`;
      console.error(err);
    }
  };

  loadPlaces();
})();
