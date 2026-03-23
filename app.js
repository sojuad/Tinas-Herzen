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

  // ── MAP ──────────────────────────────────────────────────────────
  const map = L.map('map', {center:[20,10], zoom:2, worldCopyJump:true, preferCanvas:false});
  const positron = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom:19, attribution:'&copy; OpenStreetMap &copy; CARTO' });
  const dark     = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',  { maxZoom:19, attribution:'&copy; OpenStreetMap &copy; CARTO' });
  const esri     = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom:19, attribution:'Tiles &copy; Esri' });
  positron.addTo(map);
  L.control.layers({'Hell':positron,'Dunkel':dark,'Satellit':esri}, null, {position:'topleft'}).addTo(map);
  const markersLayer = L.layerGroup().addTo(map);
  const markerById = new Map();

  // ── FILTER ───────────────────────────────────────────────────────
  const filtered = () => {
    const q = searchQ.toLowerCase();
    return allPlaces.filter(p => {
      const cMatch = activeCont === 'Alle' || p.continent === activeCont;
      const lMatch = activeCountry === 'Alle' || p.country === activeCountry;
      const qMatch = !q || (p.title||'').toLowerCase().includes(q) || (p.note||'').toLowerCase().includes(q) || (p.country||'').toLowerCase().includes(q) || (p.continent||'').toLowerCase().includes(q);
      return cMatch && lMatch && qMatch;
    });
  };
  const renderAll = () => { const src=filtered(); renderList(src); renderMarkers(src); updateCount(src.length); };
  const updateCount = n => { $('countBar').innerHTML = `<b>${n}</b> Ort${n!==1?'e':''} gefunden`; };

  // ── HOVER TOOLTIP – Farbe als Hintergrund, Bild ungecroppt ───────
  const makeHoverHtml = p => {
    const photo = normalizePhotoUrl(p.photo);
    const color = p.color || DEFAULT_COLOR;
    const title = escHtml(p.title);
    const sub   = escHtml([p.country, p.continent].filter(Boolean).join(' · '));
    const style = `style="background:${color}ee;border-color:${color};"`;
    if(!photo) return `<div class="hovercard" ${style}><div class="hc-title">${title}</div><div class="hc-muted">${sub}</div></div>`;
    return `<div class="hovercard" ${style}><div class="hc-title">${title}</div><img src="${photo}" alt=""/><div class="hc-muted">${sub}</div></div>`;
  };


  // ── HERZ-MARKER ──────────────────────────────────────────────────
  function makeHeartIcon(color) {
    const c = color || DEFAULT_COLOR;
    // Vollflächig, 60% kleiner (30->12, 28->11), kein Rand
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="11" viewBox="0 0 30 28">
      <path d="M15 25.5C15 25.5 2 17 2 8.5C2 5 4.5 2 8 2C11 2 13.5 3.8 15 6.2C16.5 3.8 19 2 22 2C25.5 2 28 5 28 8.5C28 17 15 25.5 15 25.5Z"
        fill="${c}" stroke="none"/>
    </svg>`;
    return L.divIcon({
      html: svg,
      className: '',
      iconSize: [12, 11],
      iconAnchor: [6, 10],
      tooltipAnchor: [0, -11]
    });
  }

  // ── MARKERS ──────────────────────────────────────────────────────
  const renderMarkers = src => {
    markersLayer.clearLayers(); markerById.clear();
    src.forEach(p => {
      const marker = L.marker([p.lat, p.lng], {icon: makeHeartIcon(p.color)});
      marker.bindTooltip(makeHoverHtml(p), {direction:'top', offset:[0,-8], opacity:1, className:'hovercard-wrap', sticky:false});
      marker.on('mouseover', () => marker.openTooltip());
      marker.on('mouseout',  () => marker.closeTooltip());
      marker.on('click',     () => selectPlace(p.id));
      marker.addTo(markersLayer);
      markerById.set(p.id, marker);
    });
  };

  // ── LIST ─────────────────────────────────────────────────────────
  const listEl = $('list');
  const renderList = src => {
    listEl.innerHTML = '';
    if(!src.length) { listEl.innerHTML = `<div class="empty">Keine Orte gefunden.</div>`; return; }
    src.forEach(p => {
      const card = document.createElement('div');
      const bg = p.color || DEFAULT_COLOR;
      card.className = 'card' + (p.id===selectedId?' selected':'');
      card.dataset.id = p.id;
      card.style.background = bg + '33';
      card.style.borderLeft = `4px solid ${bg}`;
      const safeUrl = sanitizeUrl(p.url);
      card.innerHTML = `
        <div class="card-top">
          <div class="card-title">${escHtml(p.title)}</div>
          <div class="card-badges">
            ${p.country   ? `<span class="card-badge">${escHtml(p.country)}</span>`   : ''}
            ${p.continent ? `<span class="card-badge">${escHtml(p.continent)}</span>` : ''}
          </div>
        </div>
        ${p.note ? `<div class="card-note">${escHtml(p.note)}</div>` : ''}
        <div class="card-actions">
          <button class="smallbtn btn-zoom">↗ Zoomen</button>
          ${safeUrl ? `<a class="smallbtn btn-link" href="${escHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">&#128279; Link</a>` : ''}
        </div>`;
      card.querySelector('.btn-zoom').addEventListener('click', e => { e.stopPropagation(); selectPlace(p.id); map.flyTo([p.lat,p.lng], Math.max(map.getZoom(),7), {duration:0.8}); });
      card.querySelector('.btn-link')?.addEventListener('click', e => e.stopPropagation());
      card.addEventListener('click', () => selectPlace(p.id));
      listEl.appendChild(card);
    });
  };

  // ── SELECT / PREVIEW ────────────────────────────────────────────
  const selectPlace = id => {
    selectedId = id;
    document.querySelectorAll('.card').forEach(c => c.classList.toggle('selected', c.dataset.id===id));
    listEl.querySelector(`[data-id="${id}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'});
    const p = allPlaces.find(x => x.id===id);
    if(!p) { $('preview').classList.add('hidden'); return; }
    $('preview').classList.remove('hidden');
    $('previewTitle').textContent = p.title;
    $('previewMeta').textContent  = `${toCoord(p.lat)}, ${toCoord(p.lng)}  ·  ${[p.country,p.continent].filter(Boolean).join(' · ')}`;
    const photo = normalizePhotoUrl(p.photo);
    const img   = $('previewImg');
    if(photo) { img.src=photo; img.classList.remove('hidden'); $('previewNoImg').style.display='none'; }
    else       { img.classList.add('hidden'); img.removeAttribute('src'); $('previewNoImg').style.display='flex'; }
    if(p.note) { $('previewNote').textContent=p.note; $('previewNote').classList.remove('hidden'); }
    else        { $('previewNote').classList.add('hidden'); }
    // FIX: p.url als Link setzen (nicht p.photo!)
    const safeUrl  = sanitizeUrl(p.url);
    const btnLink  = $('previewLink');
    if(safeUrl) { btnLink.style.display='inline-flex'; btnLink.href=safeUrl; btnLink.target='_blank'; btnLink.rel='noopener noreferrer'; }
    else         { btnLink.style.display='none'; }
    // Mobile Popup
    const mp = $('mobilePopup');
    if(mp) {
      $('mobilePopupTitle').textContent = p.title;
      $('mobilePopupMeta').textContent  = `${toCoord(p.lat)}, ${toCoord(p.lng)}  ·  ${[p.country,p.continent].filter(Boolean).join(' · ')}`;
      const mi = $('mobilePopupImg');
      if(photo) { mi.src=photo; mi.classList.remove('hidden'); } else { mi.classList.add('hidden'); }
      const mn = $('mobilePopupNote');
      if(p.note) { mn.textContent=p.note; mn.classList.remove('hidden'); } else { mn.classList.add('hidden'); }
      const ml = $('mobilePopupLink');
      if(safeUrl) { ml.style.display='inline-flex'; ml.href=safeUrl; ml.target='_blank'; ml.rel='noopener noreferrer'; }
      else         { ml.style.display='none'; }
      mp.classList.remove('hidden');
    }
  };
  $('previewImg').addEventListener('error', () => { $('previewImg').classList.add('hidden'); $('previewNoImg').style.display='flex'; });
  $('mobilePopupClose')?.addEventListener('click', () => $('mobilePopup').classList.add('hidden'));

  // ── CHIPS ────────────────────────────────────────────────────────
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
        const mob = $(containerId.replace('chips-','chips-mobile-'));
        if(mob) mob.querySelectorAll('.chip').forEach(b => b.classList.toggle('active', b.textContent===v));
        if(typeof closeMobileFilter==='function') closeMobileFilter();
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
        if(typeof closeMobileFilter==='function') closeMobileFilter();
        renderAll();
      });
      el.appendChild(btn);
    });
  }
  window.toggleFilterGroup = id => {
    $('panel-' + id)?.classList.toggle('open');
    $('arrow-'  + id)?.classList.toggle('open');
  };
  // Mobile Filter – öffnen/schließen
  const mobileFilterBtn = $('mobileFilterBtn');
  const mobileFilterPanel = $('mobileFilterPanel');
  const mobileFilterOverlay = $('mobileFilterOverlay');

  function openMobileFilter() {
    mobileFilterPanel?.classList.add('open');
    mobileFilterBtn?.classList.add('open');
    mobileFilterOverlay?.classList.add('open');
    // Popup schließen wenn Filter aufgeht
    $('mobilePopup')?.classList.add('hidden');
  }
  function closeMobileFilter() {
    mobileFilterPanel?.classList.remove('open');
    mobileFilterBtn?.classList.remove('open');
    mobileFilterOverlay?.classList.remove('open');
  }

  mobileFilterBtn?.addEventListener('click', () => {
    mobileFilterPanel?.classList.contains('open') ? closeMobileFilter() : openMobileFilter();
  });

  // Overlay-Klick schließt Filter
  mobileFilterOverlay?.addEventListener('click', closeMobileFilter);

  // Chip-Klick schließt Filter automatisch
  // (wird in buildMobileChips gehandelt – closeMobileFilter ist global verfügbar)
  $('search').addEventListener('input', e => { searchQ=e.target.value.trim(); renderAll(); });
  $('search-mobile')?.addEventListener('input', e => { searchQ=e.target.value.trim(); renderAll(); });

  // ── LOAD ─────────────────────────────────────────────────────────
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
      const countries = [...new Set(allPlaces.map(p => p.country).filter(Boolean))].sort();
      buildChips('chips-cont',    CONTINENTS, activeCont,    v => activeCont=v);
      buildChips('chips-country', countries,  activeCountry, v => activeCountry=v);
      buildMobileChips('chips-mobile-cont',    CONTINENTS, activeCont,    v => activeCont=v,    'chips-cont');
      buildMobileChips('chips-mobile-country', countries,  activeCountry, v => activeCountry=v, 'chips-country');
      renderAll();
      if(allPlaces.length) selectPlace(allPlaces[0].id);
    } catch(err) {
      listEl.innerHTML = `<div class="empty">Fehler beim Laden:<br>${escHtml(err.message)}</div>`;
      console.error(err);
    }
  };

  loadPlaces();
})();
