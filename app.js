(() => {
  const $ = id => document.getElementById(id);
  const CONTINENTS = ['Europa','Asien','Nordamerika','Südamerika','Afrika','Ozeanien'];
  const DEFAULT_COLOR = '#58a6ff';

  // Notiz-Text mit eingebetteten Drive-Bildern rendern
  // Google Drive URLs werden in <img> Tags umgewandelt, Rest bleibt Text
  const renderNoteWithImages = note => {
    if(!note) return '';
    // Drive URL Pattern erkennen
    const drivePattern = /https?:\/\/(?:drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)|drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+))(?:[/?][^\s]*)*/g;
    let html = '';
    let lastIndex = 0;
    let match;
    while((match = drivePattern.exec(note)) !== null) {
      // Text vor der URL
      const textBefore = note.slice(lastIndex, match.index).trim();
      if(textBefore) {
        html += `<span class="note-text">${textBefore.replace(/\n/g,'<br>')}</span>`;
      }
      // Bild aus Drive ID
      const fileId = match[1] || match[2];
      const imgUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
      html += `<img class="note-img" src="${imgUrl}" alt="Foto" loading="lazy" onerror="this.style.display='none'"/>`;
      lastIndex = match.index + match[0].length;
    }
    // Restlicher Text nach letzter URL
    const remaining = note.slice(lastIndex).trim();
    if(remaining) {
      html += `<span class="note-text">${remaining.replace(/\n/g,'<br>')}</span>`;
    }
    // Kein Drive-Link gefunden: einfach Text
    if(html === '') html = `<span class="note-text">${note.replace(/\n/g,'<br>')}</span>`;
    return html;
  };

  const getTextColor = hex => {
    if(!hex || hex.length < 7) return '#ffffff';
    const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
    return (0.299*r+0.587*g+0.114*b)>160 ? '#2d2d2d' : '#ffffff';
  };

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

  // ── MAP (Mapbox GL JS – kein Leaflet mehr) ─────────────────────────
  const mapboxToken = 'pk.eyJ1Ijoic29qdWFkIiwiYSI6ImNtdGVuaXNkaTE0YmsyeHNja2ZmY2x4anoifQ.jKbuzhtotfsbFxTlgiwFLA';
  mapboxgl.accessToken = mapboxToken;

  const rasterStyle = (id, tileUrl, attribution, maxzoom) => ({
    version: 8,
    sources: { [id]: { type:'raster', tiles:[tileUrl], tileSize:256, attribution, maxzoom } },
    layers: [{ id: id+'-layer', type:'raster', source:id }]
  });
  const STADIA_ATTR = '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  // "Hell" ist wieder der vertraute Stadia-Alidade-Smooth-Stil (wie in V26/27), "Dunkel" bleibt der
  // kostenlose OpenFreeMap-Vektor-Stil. "Satellit" bleibt Esri-Raster, jetzt ohne Nachbearbeitungs-
  // Filter (naturgetreue Farben). "Tinas Herzen" bleibt dein eigener Mapbox-Studio-Style und ist die
  // Standardkarte beim Laden. Alles läuft über eine einzige native Mapbox-GL-Karteninstanz.
  const STYLES = {
    tinas:    'mapbox://styles/sojuad/cmtepjjkf005j01qt8och4c6h',
    hell:     rasterStyle('hell', 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png', STADIA_ATTR, 20),
    dunkel:   'https://tiles.openfreemap.org/styles/dark',
    satellit: rasterStyle('satellit', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 'Tiles &copy; Esri', 19),
    // Zusätzliche 5. Karte: Mapboxs eigener "Standard"-Stil mit Nacht-Beleuchtung (lightPreset
    // 'night') – dynamische Beleuchtung, leuchtende Fenster an 3D-Gebäuden bei nahem Zoom.
    nacht:    'mapbox://styles/mapbox/standard'
  };
  const STYLE_LABELS = { tinas:'Tinas Herzen', hell:'Hell', dunkel:'Dunkel', satellit:'Satellit', nacht:'Nacht' };
  const GLOBE_KEYS = new Set(['tinas', 'nacht']);
  let activeStyleKey = 'tinas';

  const mapEl = $('map');

  // Projektion pro Kartenstil: "Tinas Herzen" und "Nacht" (beide Mapbox Standard) als 3D-Globus,
  // alle anderen Stile flach.
  const projectionForStyle = key => GLOBE_KEYS.has(key) ? 'globe' : 'mercator';

  const map = new mapboxgl.Map({
    container: 'map',
    style: STYLES[activeStyleKey],
    center: [10, 20],
    zoom: 2,
    // Projektion wird explizit gesetzt (nicht mehr dem Style-Default überlassen), damit der
    // Globus bei "Tinas Herzen" garantiert erscheint – unabhängig davon, was im Studio-Style
    // hinterlegt ist. Die Herzen sind native Mapbox-GL-Marker (nicht mehr Leaflet), die die
    // Kugel-Projektion selbst korrekt mitrechnen – anders als früher über die Leaflet-Bridge.
    projection: projectionForStyle(activeStyleKey),
    attributionControl: false
  });
  map.dragRotate.disable();
  map.touchPitch.disable();
  // Nach jedem Stilwechsel (setStyle setzt die Projektion sonst auf den Style-Default zurück)
  // erneut die passende Projektion erzwingen. Für "Nacht" zusätzlich den Beleuchtungsmodus des
  // Mapbox-Standard-Stils auf 'night' setzen.
  map.on('style.load', () => {
    map.setProjection(projectionForStyle(activeStyleKey));
    if (activeStyleKey === 'nacht') {
      map.setConfigProperty('basemap', 'lightPreset', 'night');
    }
    if (activeStyleKey === 'tinas') {
      // Der Standard-"Weltraum"-Hintergrund von Mapbox GL JS wird beim Herauszoomen kräftig
      // blau (Style-Default space-color geht Richtung #367ab9) – hier auf dezentes Dunkel-
      // Marineblau/Schwarz gedämpft, damit der Globus nicht so "blau" wirkt.
      map.setFog({
        range: [0.5, 10],
        color: '#ffffff',
        'high-color': '#182a3d',
        'horizon-blend': 0.1,
        'space-color': '#02060f',
        'star-intensity': 0.15
      });
    }
  });
  map.addControl(new mapboxgl.AttributionControl({compact:true}));
  map.addControl(new mapboxgl.NavigationControl({showCompass:false}), 'top-left');

  // ── Eigener Kartenstil-Umschalter (ersetzt Leaflets L.control.layers) ──
  class LayerSwitchControl {
    onAdd(mapInstance) {
      this._map = mapInstance;
      const el = document.createElement('div');
      el.className = 'mapboxgl-ctrl mapboxgl-ctrl-group layer-switch';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'layer-switch-btn';
      btn.setAttribute('aria-label', 'Kartenstil wählen');
      btn.innerHTML = '&#9776;';
      const menu = document.createElement('div');
      menu.className = 'layer-switch-menu';
      Object.keys(STYLES).forEach(key => {
        const item = document.createElement('label');
        item.className = 'layer-switch-item';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'basestyle';
        radio.value = key;
        radio.checked = key === activeStyleKey;
        radio.addEventListener('change', () => {
          activeStyleKey = key;
          this._map.setStyle(STYLES[key]);
          menu.classList.remove('open');
        });
        item.appendChild(radio);
        item.appendChild(document.createTextNode(' ' + STYLE_LABELS[key]));
        menu.appendChild(item);
      });
      btn.addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('open'); });
      document.addEventListener('click', () => menu.classList.remove('open'));
      el.appendChild(btn);
      el.appendChild(menu);
      this._container = el;
      return el;
    }
    onRemove() { this._container.parentNode?.removeChild(this._container); }
  }
  map.addControl(new LayerSwitchControl(), 'top-left');

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
    const txtCol = getTextColor(color);
    const style = `style="background:${color};border-color:${color};color:${txtCol};"`;
    if(!photo) return `<div class="hovercard" ${style}><div class="hc-title">${title}</div><div class="hc-muted">${sub}</div></div>`;
    return `<div class="hovercard" ${style}><div class="hc-title">${title}</div><img src="${photo}" alt=""/><div class="hc-muted">${sub}</div></div>`;
  };

  const isTouchDevice = () => navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;

  // ── HERZ-MARKER (natives Mapbox-GL-DOM-Marker, kein Leaflet-Icon) ──
  const makeHeartEl = p => {
    const color = p.color || DEFAULT_COLOR;
    const wrap = document.createElement('div');
    wrap.className = 'heart-marker';
    wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="17" viewBox="0 0 30 28">
      <path d="M15 25.5C15 25.5 2 17 2 8.5C2 5 4.5 2 8 2C11 2 13.5 3.8 15 6.2C16.5 3.8 19 2 22 2C25.5 2 28 5 28 8.5C28 17 15 25.5 15 25.5Z"
        fill="${color}" stroke="none"/>
    </svg>`;
    const hoverWrap = document.createElement('div');
    hoverWrap.className = 'hovercard-pos';
    wrap.appendChild(hoverWrap);
    // Inhalt (inkl. Foto) erst beim ersten Hover bauen – sonst laden alle 149 Herzen sofort
    // ihr Google-Drive-Foto im Hintergrund, auch ungehovert (das machte Mobile langsam).
    let hoverBuilt = false;
    const ensureHoverContent = () => {
      if(hoverBuilt) return;
      hoverWrap.innerHTML = makeHoverHtml(p);
      hoverBuilt = true;
    };

    wrap.addEventListener('mouseenter', () => { if(!isTouchDevice()) { ensureHoverContent(); wrap.classList.add('hover'); } });
    wrap.addEventListener('mouseleave', () => wrap.classList.remove('hover'));
    wrap.addEventListener('click', e => {
      e.stopPropagation();
      wrap.classList.remove('hover');
      selectPlace(p.id);
    });
    return wrap;
  };

  // ── MARKERS ──────────────────────────────────────────────────────
  const renderMarkers = src => {
    markerById.forEach(m => m.remove());
    markerById.clear();
    src.forEach(p => {
      const marker = new mapboxgl.Marker({ element: makeHeartEl(p), anchor: 'bottom' })
        .setLngLat([p.lng, p.lat])
        .addTo(map);
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
      card.style.borderLeft = `3px solid ${bg}`;
      card.style.color = '#ffffff';
      card.style.cursor = 'pointer';
      card.innerHTML = `<div class="card-title">${escHtml(p.title)}</div>`;
      card.addEventListener('click', () => {
        selectPlace(p.id);
        // essential:true erzwingt die Animation, auch wenn im System "Bewegung reduzieren"
        // aktiv ist – sonst überspringt Mapbox GL flyTo() und springt sofort ohne Flug.
        map.flyTo({ center:[p.lng, p.lat], zoom: Math.max(map.getZoom(), 7), duration: 4000, essential: true });
      });
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
  // Klick auf Karte schließt Popup (außer Klick war auf ein Herz)
  mapEl.addEventListener('click', e => {
    if(!e.target.closest('.heart-marker')) {
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

    // ── DESKTOP POPUP ──────────────────────────────────────────
    const dp = $('desktopPopup');
    if(dp) {
      const col = p.color || DEFAULT_COLOR;
      const pr = parseInt(col.slice(1,3),16), pg = parseInt(col.slice(3,5),16), pb = parseInt(col.slice(5,7),16);
      dp.style.borderColor = col;
      dp.style.background  = `rgba(${pr},${pg},${pb},1)`;
      const dpTxt = getTextColor(col);
      ['desktopPopupTitle','desktopPopupMeta','desktopPopupNote','desktopPopupDate'].forEach(id => {
        const el = $(id); if(el) el.style.color = dpTxt;
      });
      // Link-Button Textfarbe
      const dpLink = $('desktopPopupLink');
      if(dpLink) dpLink.style.color = dpTxt;
      // Schließen-Button anpassen
      const dpClose = $('desktopPopupClose');
      if(dpClose) dpClose.style.color = dpTxt;
      $('desktopPopupTitle').textContent = p.title;
      $('desktopPopupMeta').textContent  = `${toCoord(p.lat)}, ${toCoord(p.lng)}  ·  ${[p.country,p.continent].filter(Boolean).join(' · ')}`;
      const dImg  = $('desktopPopupImg');
      if(photo) { dImg.src=photo; dImg.classList.remove('hidden'); $('desktopPopupNoImg').classList.add('hidden'); }
      else       { dImg.classList.add('hidden'); dImg.removeAttribute('src'); $('desktopPopupNoImg').classList.remove('hidden'); }
      if(p.note) {
        $('desktopPopupNote').innerHTML = renderNoteWithImages(p.note);
        $('desktopPopupNote').classList.remove('hidden');
        $('desktopPopupNote').style.color = dpTxt;
      } else { $('desktopPopupNote').classList.add('hidden'); }
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
    // Mobile Popup
    const mp = $('mobilePopup');
    if(mp) {
      // Hintergrund + Border in der Ortsfarbe
      const c = p.color || DEFAULT_COLOR;
      const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
      mp.style.background = `rgba(${r},${g},${b},1)`;
      mp.style.borderColor = c;
      const mpTxt = getTextColor(c);
      ['mobilePopupTitle','mobilePopupMeta','mobilePopupNote'].forEach(id => {
        const el = $(id); if(el) el.style.color = mpTxt;
      });
      const mpLink = $('mobilePopupLink');
      if(mpLink) mpLink.style.color = mpTxt;
      // Bildbereich Hintergrund ebenfalls in Ortsfarbe
      const mi2 = $('mobilePopupImg');
      if(mi2) mi2.style.background = `rgba(${r},${g},${b},1)`;
      $('mobilePopupTitle').textContent = p.title;
      $('mobilePopupMeta').textContent  = `${toCoord(p.lat)}, ${toCoord(p.lng)}  ·  ${[p.country,p.continent].filter(Boolean).join(' · ')}`;
      const mi = $('mobilePopupImg');
      if(photo) { mi.src=photo; mi.classList.remove('hidden'); } else { mi.classList.add('hidden'); }
      const mn = $('mobilePopupNote');
      if(p.note) { mn.innerHTML = renderNoteWithImages(p.note); mn.classList.remove('hidden'); } else { mn.classList.add('hidden'); }
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
