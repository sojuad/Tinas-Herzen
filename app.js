(() => {
  const $ = id => document.getElementById(id);
  const CONTINENTS = ['Europa','Asien','Nordamerika','Südamerika','Afrika','Ozeanien','Australien'];
  const DEFAULT_COLOR = '#58a6ff';

  const sanitizeUrl = url => { if(!url) return ''; try{return new URL(url).toString();}catch{return '';} };
  const extractDriveId = url => {
    if(!url) return '';
    try {
      const u = new URL(url);
      if(!/drive\.google\.com/.test(u.hostname)) return '';
      const m = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
      if(m) return m[1];
      return u.searchParams.get('id') || '';
    } catch { return ''; }
  };
  const normalizePhotoUrl = url => {
    const clean = sanitizeUrl(url); if(!clean) return '';
    const id = extractDriveId(clean);
    if(id) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1000`;
    return clean;
  };
  const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const toCoord = x => (Math.round(x*1e5)/1e5).toFixed(5);
  const toast = msg => { const el=$('toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('show'),2200); };

  let allPlaces=[], activeCont='Alle', activeCountry='Alle', searchQ='', selectedId=null;

  // ── COLORED MARKER ─────────────────────────────────────────────
  function makeColorIcon(color) {
    const c = color || DEFAULT_COLOR;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 22 14 22S28 24.5 28 14C28 6.27 21.73 0 14 0z"
            fill="${c}" stroke="white" stroke-width="2.5"/>
      <circle cx="14" cy="14" r="5" fill="white" opacity="0.9"/>
    </svg>`;
    return L.divIcon({
      html: svg, className: '', iconSize: [28,36], iconAnchor: [14,36], tooltipAnchor: [0,-36]
    });
  }

  // ── MAP ─────────────────────────────────────────────────────────
  const map = L.map('map', {center:[20,10], zoom:2, worldCopyJump:true, preferCanvas:false});
  const positron = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom:19, attribution:'&copy; OpenStreetMap &copy; CARTO'
  });
  const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom:19, attribution:'&copy; OpenStreetMap &copy; CARTO'
  });
  const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom:19, attribution:'Tiles &copy; Esri'
  });
  positron.addTo(map);
  L.control.layers({'Hell':positron,'Dunkel':dark,'Satellit':esri}, null, {position:'topleft'}).addTo(map);

  const markersLayer = L.layerGroup().addTo(map);
  const markerById = new Map();

  // ── FILTER ─────────────────────────────────────────────────────
  const filtered = () => {
    const q = searchQ.toLowerCase();
    return allPlaces.filter(p => {
      const cMatch = activeCont === 'Alle' || p.continent === activeCont;
      const lMatch = activeCountry === 'Alle' || p.country === activeCountry;
      const qMatch = !q || (p.title||'').toLowerCase().includes(q)
                       || (p.note||'').toLowerCase().includes(q)
                       || (p.country||'').toLowerCase().includes(q)
                       || (p.continent||'').toLowerCase().includes(q);
      return cMatch && lMatch && qMatch;
    });
  };
  const renderAll = () => { const src=filtered(); renderList(src); renderMarkers(src); updateCount(src.length); };
  const updateCount = n => { $('countBar').innerHTML = `<b>${n}</b> Ort${n!==1?'e':''} gefunden`; };

  // ── HOVER TOOLTIP ───────────────────────────────────────────────
  const makeHoverHtml = p => {
    const photo = normalizePhotoUrl(p.photo);
    const title = escHtml(p.title);
    const sub = escHtml([p.country, p.continent].filter(Boolean).join(' · '));
    if(!photo) return `<div class="hovercard"><div class="hc-title">${title}</div><div class="hc-muted">${sub}</div></div>`;
    return `<div class="hovercard"><div class="hc-title">${title}</div><img src="${photo}" alt=""/><div class="hc-muted">${sub}</div></div>`;
  };

  // ── MARKERS ─────────────────────────────────────────────────────
  const renderMarkers = src => {
    markersLayer.clearLayers(); markerById.clear();
    src.forEach(p => {
      const marker = L.marker([p.lat, p.lng], {icon: makeColorIcon(p.color)});
      marker.bindTooltip(makeHoverHtml(p), {direction:'top', offset:[0,-8], opacity:1, className:'hovercard', sticky:false});
      marker.on('mouseover', () => marker.openTooltip());
      marker.on('mouseout', () => marker.closeTooltip());
      marker.on('click', () => selectPlace(p.id));
      marker.addTo(markersLayer);
      markerById.set(p.id, marker);
    });
  };

  // ── LIST ────────────────────────────────────────────────────────
  const listEl = $('list');
  const renderList = src => {
    listEl.innerHTML = '';
    if(!src.length) { listEl.innerHTML = `<div class="empty">Keine Orte gefunden.</div>`; return; }
    src.forEach(p => {
      const card = document.createElement('div');
      const bg = p.color || DEFAULT_COLOR;
      card.className = 'card' + (p.id===selectedId?' selected':'');
      card.dataset.id = p.id;
      // Hintergrund: Farbe mit Transparenz
      card.style.background = bg + '33'; // 20% opacity
      card.style.borderLeft = `4px solid ${bg}`;
      const safeUrl = sanitizeUrl(p.url);
      card.innerHTML = `
        <div class="card-top">
          <div class="card-title">${escHtml(p.title)}</div>
          <div class="card-badges">
            ${p.country ? `<span class="card-badge">${escHtml(p.country)}</span>` : ''}
            ${p.continent ? `<span class="card-badge">${escHtml(p.continent)}</span>` : ''}
          </div>
        </div>
        ${p.note ? `<div class="card-note">${escHtml(p.note)}</div>` : ''}
        <div class="card-actions">
          <button class="smallbtn" data-action="zoom">↗ Zoomen</button>
          ${safeUrl?`<button class="smallbtn" data-action="open">&#128279; Link</button>`:''}
        </div>`;
      card.addEventListener('click', e => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if(action==='zoom') { selectPlace(p.id); map.flyTo([p.lat,p.lng], Math.max(map.getZoom(),7), {duration:0.8}); }
        else if(action==='open') { window.open(safeUrl,'_blank','noopener,noreferrer'); }
        else { selectPlace(p.id); }
      });
      listEl.appendChild(card);
    });
  };

  // ── SELECT / PREVIEW ───────────────────────────────────────────
  const selectPlace = id => {
    selectedId = id;
    document.querySelectorAll('.card').forEach(c => c.classList.toggle('selected', c.dataset.id===id));
    listEl.querySelector(`[data-id="${id}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'});
    const p = allPlaces.find(x => x.id===id);
    if(!p) { $('preview').classList.add('hidden'); return; }
    $('preview').classList.remove('hidden');
    $('previewTitle').textContent = p.title;
    $('previewMeta').textContent = `${toCoord(p.lat)}, ${toCoord(p.lng)}  ·  ${[p.country,p.continent].filter(Boolean).join(' · ')}`;
    const photo = normalizePhotoUrl(p.photo);
    const img = $('previewImg');
    if(photo) { img.src=photo; img.classList.remove('hidden'); $('previewNoImg').style.display='none'; }
    else { img.classList.add('hidden'); img.removeAttribute('src'); $('previewNoImg').style.display='flex'; }
    if(p.note) { $('previewNote').textContent=p.note; $('previewNote').classList.remove('hidden'); }
    else { $('previewNote').classList.add('hidden'); }
    const safeUrl = sanitizeUrl(p.url);
    const btnLink = $('previewLink');
    if(safeUrl) { btnLink.style.display='inline-flex'; btnLink.onclick=()=>window.open(safeUrl,'_blank','noopener,noreferrer'); }
    else { btnLink.style.display='none'; }
    // Mobile Popup
    const mp = $('mobilePopup');
    if(mp) {
      $('mobilePopupTitle').textContent = p.title;
      $('mobilePopupMeta').textContent = `${toCoord(p.lat)}, ${toCoord(p.lng)}  ·  ${[p.country,p.continent].filter(Boolean).join(' · ')}`;
      const mi = $('mobilePopupImg');
      if(photo) { mi.src=photo; mi.classList.remove('hidden'); } else { mi.classList.add('hidden'); }
      if(p.note) { $('mobilePopupNote').textContent=p.note; $('mobilePopupNote').classList.remove('hidden'); }
      else { $('mobilePopupNote').classList.add('hidden'); }
      const ml = $('mobilePopupLink');
      if(safeUrl) { ml.style.display='inline-flex'; ml.onclick=()=>window.open(safeUrl,'_blank','noopener,noreferrer'); }
      else { ml.style.display='none'; }
      mp.classList.remove('hidden');
    }
  };
  $('previewImg').addEventListener('error', () => { $('previewImg').classList.add('hidden'); $('previewNoImg').style.display='flex'; });
  $('mobilePopupClose')?.addEventListener('click', () => $('mobilePopup').classList.add('hidden'));

  // ── CHIPS BUILDER ──────────────────────────────────────────────
  function buildChips(containerId, values, activeVal, setter) {
    const el = $(containerId); if(!el) return;
    el.innerHTML = '';
    ['Alle', ...values].forEach(v => {
      const btn = document.createElement('button');
      btn.className = 'chip' + (v===activeVal?' active':'');
      btn.textContent = v;
      btn.addEventListener('click', () => {
        setter(v);
        el.querySelectorAll('.chip').forEach(b => b.classList.toggle('active', b.textContent===v));
        // Sync Mobile chips
        const mobileId = containerId.replace('chips-','chips-mobile-');
        const mob = $(mobileId);
        if(mob) mob.querySelectorAll('.chip').forEach(b => b.classList.toggle('active', b.textContent===v));
        // Close mobile panel
        $('mobileFilterPanel')?.classList.remove('open');
        $('mobileFilterBtn')?.classList.remove('open');
        renderAll();
      });
      el.appendChild(btn);
    });
  }
  function buildMobileChips(containerId, values, activeVal, setter, desktopId) {
    const el = $(containerId); if(!el) return;
    el.innerHTML = '';
    ['Alle', ...values].forEach(v => {
      const btn = document.createElement('button');
      btn.className = 'chip' + (v===activeVal?' active':'');
      btn.textContent = v;
      btn.addEventListener('click', () => {
        setter(v);
        el.querySelectorAll('.chip').forEach(b => b.classList.toggle('active', b.textContent===v));
        const desk = $(desktopId);
        if(desk) desk.querySelectorAll('.chip').forEach(b => b.classList.toggle('active', b.textContent===v));
        $('mobileFilterPanel')?.classList.remove('open');
        $('mobileFilterBtn')?.classList.remove('open');
        renderAll();
      });
      el.appendChild(btn);
    });
  }

  // ── FILTER GROUP TOGGLE ─────────────────────────────────────────
  window.toggleFilterGroup = id => {
    const panel = $('panel-' + id);
    const arrow = $('arrow-' + id);
    panel.classList.toggle('open');
    arrow.classList.toggle('open');
  };

  // ── MOBILE FILTER BUTTON ────────────────────────────────────────
  $('mobileFilterBtn')?.addEventListener('click', () => {
    const open = $('mobileFilterPanel').classList.toggle('open');
    $('mobileFilterBtn').classList.toggle('open', open);
  });

  // ── SEARCH ──────────────────────────────────────────────────────
  $('search').addEventListener('input', e => { searchQ=e.target.value.trim(); renderAll(); });
  $('search-mobile')?.addEventListener('input', e => { searchQ=e.target.value.trim(); renderAll(); });

  // ── LOAD ────────────────────────────────────────────────────────
  const loadPlaces = async () => {
    listEl.innerHTML = '<div class="loading">Lade Orte …</div>';
    try {
      const res = await fetch('./places.json?v=' + Date.now());
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      allPlaces = Array.isArray(data)
        ? data.filter(p => p.title && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
              .map(p => ({...p, lat:Number(p.lat), lng:Number(p.lng), color: p.color || DEFAULT_COLOR}))
        : [];

      // Unique Länder aus Daten
      const countries = [...new Set(allPlaces.map(p => p.country).filter(Boolean))].sort();

      // Desktop Chips
      buildChips('chips-cont', CONTINENTS, activeCont, v => activeCont=v);
      buildChips('chips-country', countries, activeCountry, v => activeCountry=v);

      // Mobile Chips
      buildMobileChips('chips-mobile-cont', CONTINENTS, activeCont, v => activeCont=v, 'chips-cont');
      buildMobileChips('chips-mobile-country', countries, activeCountry, v => activeCountry=v, 'chips-country');

      renderAll();
      if(allPlaces.length) selectPlace(allPlaces[0].id);
    } catch(err) {
      listEl.innerHTML = `<div class="empty">Fehler beim Laden:<br>${escHtml(err.message)}</div>`;
      console.error(err);
    }
  };

  loadPlaces();
})();
