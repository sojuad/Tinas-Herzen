(() => {
  const $ = id => document.getElementById(id);
  const CONTINENTS = ['Europa', 'Asien', 'Nordamerika', 'Südamerika', 'Afrika', 'Ozeanien'];

  const sanitizeUrl = url => { if (!url) return ''; try { return new URL(url).toString(); } catch { return ''; } };

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
    if (id) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1000`;
    return clean;
  };

  const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const toCoord = x => (Math.round(x * 1e5) / 1e5).toFixed(5);
  const toast = msg => {
    const el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2200);
  };

  let allPlaces = [], activeContinent = 'Alle', searchQ = '', selectedId = null;

  // ── Karte mit dunklerem Meerwasser ──────────────────────────────
  const map = L.map('map', { center: [20, 10], zoom: 2, worldCopyJump: true, preferCanvas: true });

  // CartoDB Positron – helle Landmasse, dunkles gedämpftes Meer
  const positron = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
  });

  // CartoDB Dark Matter – dunkle Karte, sehr dunkles Meer
  const darkMatter = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
  });

  // Watercolor – künstlerischer Stil mit dunklerem Ozean
  const watercolor = L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.jpg', {
    maxZoom: 16, attribution: '&copy; Stadia Maps / Stamen'
  });

  // Satellit Esri
  const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Tiles &copy; Esri'
  });

  // Standard – OSM
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  });

  // Stadia Alidade Smooth Dark – schönes dunkles Meer
  const darkSmooth = L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {
    maxZoom: 20, attribution: '&copy; Stadia Maps'
  });

  darkSmooth.addTo(map);

  L.control.layers({
    'Dunkel (Standard)': darkSmooth,
    'Dark Matter': darkMatter,
    'Hell (Positron)': positron,
    'Satellit': esri,
    'OpenStreetMap': osm,
  }, null, { position: 'topleft' }).addTo(map);

  const markersLayer = L.layerGroup().addTo(map);
  const markerById = new Map();

  const filtered = () => {
    const q = searchQ.toLowerCase();
    return allPlaces.filter(p => {
      const contMatch = activeContinent === 'Alle' || p.continent === activeContinent;
      const qMatch = !q || (p.title||'').toLowerCase().includes(q) || (p.note||'').toLowerCase().includes(q) || (p.continent||'').toLowerCase().includes(q);
      return contMatch && qMatch;
    });
  };

  const renderAll = () => { const src = filtered(); renderList(src); renderMarkers(src); updateCount(src.length); };
  const updateCount = n => { $('countBar').innerHTML = `<b>${n}</b> Ort${n !== 1 ? 'e' : ''} gefunden`; };

  // ── Hover Tooltip mit Foto ──────────────────────────────────────
  const hoverHtml = p => {
    const photo = normalizePhoto(p.photo);
    const badge = escHtml(p.continent || '');
    const title = escHtml(p.title);
    if (!photo) return `<div class="hovercard"><div class="hc-title">${title}</div><div class="hc-muted">${badge}</div></div>`;
    return `<div class="hovercard"><div class="hc-title">${title}</div><img src="${photo}" alt=""/><div class="hc-muted">${badge} · Hover-Vorschau</div></div>`;
  };

  const renderMarkers = src => {
    markersLayer.clearLayers();
    markerById.clear();
    src.forEach(p => {
      const m = L.marker([p.lat, p.lng]);
      m.bindTooltip(hoverHtml(p), {
        direction: 'top', offset: [0, -8], opacity: 1,
        className: 'hovercard', sticky: false, permanent: false
      });
      m.on('mouseover', function() { this.openTooltip(); });
      m.on('mouseout', function() { this.closeTooltip(); });
      m.on('click', () => selectPlace(p.id));
      m.addTo(markersLayer);
      markerById.set(p.id, m);
    });
  };

  const listEl = $('list');
  const renderList = src => {
    listEl.innerHTML = '';
    if (src.length === 0) { listEl.innerHTML = `<div class="empty">Keine Orte gefunden.<br>Versuche einen anderen Filter.</div>`; return; }
    src.forEach(p => {
      const card = document.createElement('div');
      card.className = 'card' + (p.id === selectedId ? ' selected' : '');
      card.dataset.id = p.id;
      const safeUrl = sanitizeUrl(p.url);
      card.innerHTML = `
        <div class="card-top">
          <div class="card-title">${escHtml(p.title)}</div>
          <span class="card-continent">${escHtml(p.continent || '–')}</span>
        </div>
        ${p.note ? `<div class="card-note">${escHtml(p.note)}</div>` : ''}
        <div class="card-actions">
          <button class="smallbtn" data-action="zoom">↗ Zoomen</button>
          ${safeUrl ? `<button class="smallbtn" data-action="open">&#128279; Link</button>` : ''}
        </div>`;
      card.addEventListener('click', e => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'zoom') { selectPlace(p.id); map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 7), { duration: 0.8 }); markerById.get(p.id)?.openPopup(); }
        else if (action === 'open') { window.open(safeUrl, '_blank', 'noopener,noreferrer'); }
        else { selectPlace(p.id); }
      });
      listEl.appendChild(card);
    });
  };

  const selectPlace = id => {
    selectedId = id;
    document.querySelectorAll('.card').forEach(c => c.classList.toggle('selected', c.dataset.id === id));
    listEl.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const p = allPlaces.find(x => x.id === id);
    if (!p) { $('preview').classList.add('hidden'); return; }
    $('preview').classList.remove('hidden');
    $('previewTitle').textContent = p.title;
    $('previewMeta').textContent = `${toCoord(p.lat)}, ${toCoord(p.lng)}  ·  ${p.continent || ''}`;
    const photo = normalizePhoto(p.photo);
    const img = $('previewImg');
    if (photo) { img.src = photo; img.classList.remove('hidden'); $('previewNoImg').style.display = 'none'; }
    else { img.classList.add('hidden'); img.removeAttribute('src'); $('previewNoImg').style.display = 'flex'; }
    const noteEl = $('previewNote');
    if (p.note) { noteEl.textContent = p.note; noteEl.classList.remove('hidden'); } else { noteEl.classList.add('hidden'); }
    const safeUrl = sanitizeUrl(p.url);
    const btnLink = $('previewLink');
    if (safeUrl) { btnLink.style.display = 'inline-flex'; btnLink.onclick = () => window.open(safeUrl, '_blank', 'noopener,noreferrer'); }
    else { btnLink.style.display = 'none'; }
  };

  $('previewImg').addEventListener('error', () => { $('previewImg').classList.add('hidden'); $('previewNoImg').style.display = 'flex'; });

  const chipsEl = $('chips');
  const buildChips = () => {
    chipsEl.innerHTML = '';
    ['Alle', ...CONTINENTS].forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'chip' + (c === activeContinent ? ' active' : '');
      btn.textContent = c;
      btn.addEventListener('click', () => { activeContinent = c; document.querySelectorAll('.chip').forEach(b => b.classList.toggle('active', b.textContent === c)); renderAll(); });
      chipsEl.appendChild(btn);
    });
  };

  $('search').addEventListener('input', e => { searchQ = e.target.value.trim(); renderAll(); });

  const loadPlaces = async () => {
    listEl.innerHTML = '<div class="loading">Lade Orte …</div>';
    try {
      const res = await fetch('./places.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      allPlaces = Array.isArray(data) ? data.filter(p => p.title && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))).map(p => ({ ...p, lat: Number(p.lat), lng: Number(p.lng) })) : [];
      buildChips();
      renderAll();
      if (allPlaces.length) selectPlace(allPlaces[0].id);
    } catch (err) {
      listEl.innerHTML = `<div class="empty">Fehler beim Laden:<br>${escHtml(err.message)}</div>`;
      console.error(err);
    }
  };

  loadPlaces();
})();
