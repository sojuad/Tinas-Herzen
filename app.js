(() => {
  const $ = id => document.getElementById(id);
  const CONTINENTS = ['Europa','Asien','Nordamerika','Südamerika','Afrika','Ozeanien'];
  const DEFAULT_COLOR = '#58a6ff';

  // Touch-Erkennung – global verfügbar für alle Funktionen
  const isTouchDevice = () => navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;

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

  let allPlaces=[], activeCont='Alle', activeCountry='Alle', activeYear='Alle', searchQ='', selectedId=null;

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
      const cMatch = activeCont    === 'Alle' || p.continent === activeCont;
      const lMatch = activeCountry === 'Alle' || p.country   === activeCountry;
      const yMatch = activeYear    === 'Alle' || getYear(p)  === activeYear;
      const qMatch = !q || (p.title||'').toLowerCase().includes(q) || (p.note||'').toLowerCase().includes(q) || (p.country||'').toLowerCase().includes(q) || (p.continent||'').toLowerCase().includes(q);
      return cMatch && lMatch && yMatch && qMatch;
    });
  };
  // Jahr aus Datum extrahieren – global verfügbar
  const getYear = p => (p.date && p.date.length >= 4) ? p.date.substring(0,4) : '';

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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="17" viewBox="0 0 30 28">
      <path d="M15 25.5C15 25.5 2 17 2 8.5C2 5 4.5 2 8 2C11 2 13.5 3.8 15 6.2C16.5 3.8 19 2 22 2C25.5 2 28 5 28 8.5C28 17 15 25.5 15 25.5Z"
        fill="${c}" stroke="none"/>
    </svg>`;
    return L.divIcon({
      html: svg,
      className: '',
      iconSize: [18, 17],
      iconAnchor: [9, 15],
      tooltipAnchor: [0, -17]
    });
  }

  // ── MARKERS ──────────────────────────────────────────────────────
  const renderMarkers = src => {
    markersLayer.clearLayers(); markerById.clear();
    src.forEach(p => {
      const marker = L.marker([p.lat, p.lng], {icon: makeHeartIcon(p.color), interactive: true, bubblingMouseEvents: false});
      marker.bindTooltip(makeHoverHtml(p), {direction:'top', offset:[0,-8], opacity:1, className:'hovercard-wrap', sticky:false});
      const isMobile = () => window.innerWidth <= 768;

      // Hover-Tooltip nur auf echten Desktop-Mäusen
      marker.on('mouseover', () => {
        if(!isTouchDevice()) marker.openTooltip();
      });
      marker.on('mouseout', () => {
        if(!isTouchDevice()) marker.closeTooltip();
      });

      // Touch: touchstart merken, touchend auslösen – verhindert Doppel-Firing mit click
      let touchStarted = false;
      marker.on('touchstart', () => { touchStarted = true; });
      marker.on('touchend', e => {
        if(e.originalEvent) e.originalEvent.preventDefault();
        e.originalEvent && e.originalEvent.stopPropagation();
        marker.closeTooltip();
        selectPlace(p.id);
        touchStarted = false;
      });
      // Click nur auf Desktop (nicht nach Touch)
      marker.on('click', e => {
        if(touchStarted) { touchStarted = false; return; }
        marker.closeTooltip();
        selectPlace(p.id);
      });
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
  // Desktop Popup schließen
  $('desktopPopupClose')?.addEventListener('click', () => {
    $('desktopPopup').classList.add('hidden');
    selectedId = null;
    document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
  });
  // Klick auf Karte schließt Popup
  document.getElementById('map')?.addEventListener('click', e => {
    if(!e.target.closest('.leaflet-marker-icon')) {
      $('desktopPopup')?.classList.add('hidden');
    }
  });

  const selectPlace = id => {
    selectedId = id;
    document.querySelectorAll('.card').forEach(c => c.classList.toggle('selected', c.dataset.id===id));
    listEl.querySelector(`[data-id="${id}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'});
    const p = allPlaces.find(x => x.id===id);
    if(!p) { $('desktopPopup')?.classList.add('hidden'); return; }

    // Gemeinsame Variablen für alle Popup-Blöcke
    const photo   = normalizePhotoUrl(p.photo);
    const safeUrl = sanitizeUrl(p.url);

    // ── DESKTOP POPUP (nur auf Desktop) ───────────────────────
    const dp = $('desktopPopup');
    if(dp && !isTouchDevice()) {
      const col = p.color || DEFAULT_COLOR;
      const pr = parseInt(col.slice(1,3),16), pg = parseInt(col.slice(3,5),16), pb = parseInt(col.slice(5,7),16);
      dp.style.borderColor = col;
      dp.style.background  = `rgba(${pr},${pg},${pb},0.92)`;
      $('desktopPopupTitle').textContent = p.title;
      $('desktopPopupMeta').textContent  = `${toCoord(p.lat)}, ${toCoord(p.lng)}  ·  ${[p.country,p.continent].filter(Boolean).join(' · ')}`;
      const dImg  = $('desktopPopupImg');
      if(photo) { dImg.src=photo; dImg.classList.remove('hidden'); $('desktopPopupNoImg').classList.add('hidden'); }
      else       { dImg.classList.add('hidden'); dImg.removeAttribute('src'); $('desktopPopupNoImg').classList.remove('hidden'); }
      if(p.note) { $('desktopPopupNote').textContent=p.note; $('desktopPopupNote').classList.remove('hidden'); }
      else        { $('desktopPopupNote').classList.add('hidden'); }
      const dLink   = $('desktopPopupLink');
      if(safeUrl) { dLink.style.display='inline-flex'; dLink.href=safeUrl; }
      else         { dLink.style.display='none'; }
      // Datum anzeigen
      const dDate = $('desktopPopupDate');
      if(dDate) {
        if(p.date) {
          const d = new Date(p.date);
          const formatted = d.toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit',year:'numeric'});
          dDate.textContent = '📅 ' + formatted;
          dDate.classList.remove('hidden');
        } else { dDate.classList.add('hidden'); }
      }
      dp.classList.remove('hidden');
    }
    // Mobile Popup (nur auf Touch-Geräten)
    const mp = $('mobilePopup');
    if(mp && isTouchDevice()) {
      // Hintergrund + Border in der Ortsfarbe (opak wie Desktop-Popup)
      const c = p.color || DEFAULT_COLOR;
      const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
      mp.style.background = `rgba(${r},${g},${b},0.92)`;
      mp.style.borderColor = c;
      mp.style.borderWidth = '2px';
      const mi2 = $('mobilePopupImg');
      if(mi2) mi2.style.background = 'transparent';
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
  $('desktopPopupImg')?.addEventListener('error', () => { $('desktopPopupImg').classList.add('hidden'); $('desktopPopupNoImg').classList.remove('hidden'); });
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
      // Jahre aus Datum-Feldern extrahieren, sortiert absteigend (neueste zuerst)
      const years = [...new Set(allPlaces.map(p => getYear(p)).filter(Boolean))].sort().reverse();
      buildChips('chips-cont',    CONTINENTS, activeCont,    v => activeCont=v);
      buildChips('chips-country', countries,  activeCountry, v => activeCountry=v);
      buildChips('chips-year',    years,      activeYear,    v => activeYear=v);
      buildMobileChips('chips-mobile-cont',    CONTINENTS, activeCont,    v => activeCont=v,    'chips-cont');
      buildMobileChips('chips-mobile-country', countries,  activeCountry, v => activeCountry=v, 'chips-country');
      buildMobileChips('chips-mobile-year',    years,      activeYear,    v => activeYear=v,    'chips-year');
      renderAll();
      // Startort: immer Home Sweet Home (oder ersten Ort)
      const homePlace = allPlaces.find(p => p.title === 'Home Sweet Home') || allPlaces[0];
      if(homePlace) selectPlace(homePlace.id);
    } catch(err) {
      listEl.innerHTML = `<div class="empty">Fehler beim Laden:<br>${escHtml(err.message)}</div>`;
      console.error(err);
    }
  };

  loadPlaces();
})();
