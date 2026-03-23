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

  // ── HOVER TOOLTIP – Hintergrund = Ort-Farbe, Bild vollständig ──
  const makeHoverHtml = p => {
    const photo = normalizePhotoUrl(p.photo);
    const color = p.color || DEFAULT_COLOR;
    const title = escHtml(p.title);
    const sub = escHtml([p.country, p.continent].filter(Boolean).join(' · '));
    const style = `style="background:${color}ee;border-color:${color};"`;
    if(!photo) return `<div class="hovercard" ${style}><div class="hc-title">${title}</div><div class="hc-muted">${sub}</div></div>`;
    return `<div class="hovercard" ${style}><div class="hc-title">${title}</div><img src="${photo}" alt=""/><div class="hc-muted">${sub}</div></div>`;
  };

  // ── MARKERS – Standard Leaflet Pin ────────────────────────────
  const renderMarkers = src => {
    markersLayer.clearLayers(); markerById.clear();
    src.forEach(p => {
      const marker = L.marker([p.lat, p.lng]);
      marker.bindTooltip(makeHoverHtml(p), {direction:'top', offset:[0,-8], opacity:1, className:'hovercard-wrap', sticky:false});
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
      card.style.background = bg + '33';
      card.style.borderLeft = `4px solid ${bg}`;
      // BUG-FIX: safeUrl muss p.url sein, NICHT p.photo
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
          <button class="smallbtn btn-zoom" data-id="${escHtml(p.id)}">↗ Zoomen</button>
          ${safeUrl ? `<a class="smallbtn btn-link" href="${escHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">&#128279; Link</a>` : ''}
        </div>`;
      // BUG-FIX: Link-Button als <a> statt <button> + stopPropagation auf der Karte
      card.querySelector('.btn-zoom')?.addEventListener('click', e => {
        e.stopPropagation();
        selectPlace(p.id);
        map.flyTo([p.lat,p.lng], Math.max(map.getZoom(),7), {duration:0.8});
      });
      card.querySelector('.btn-link')?.addEventListener('click', e => {
        e.stopPropagation(); // verhindert dass selectPlace aufgerufen wird
      });
      card.addEventListener('click', () => selectPlace(p.id));
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
    // BUG-FIX: p.url für den Link (nicht p.photo)
    const safeUrl = sanitizeUrl(p.url);
    const btnLink = $('previewLink');
    if(safeUrl) {
      btnLink.style.display='inline-flex';
      btnLink.href = safeUrl;
      btnLink.target = '_blank';
      btnLink.rel = 'noopener noreferrer';
    } else { btnLink.style.display='none'; }
    const mp = $('mobilePopup');
    if(mp) {
      $('mobilePopupTitle').textContent = p.title;
      $('mobilePopupMeta').textContent = `${toCoord(p.lat)}, ${toCoord(p.lng)}  ·  ${[p.country,p.continent].filter(Boolean).join(' · ')}`;
      const mi = $('mobilePopupImg');
      if(photo) { mi.src=photo; mi.classList.remove('hidden'); } else { mi.classList.add('hidden'); }
      if(p.note) { $('mobilePopupNote').textContent=p.note; $('mobilePopupNote').classList.remove('hidden'); }
      else { $('mobilePopupNote').classList.add('hidden'); }
      const ml = $('mobilePopupLink');
      if(safeUrl) { ml.style.display='inline-flex'; ml.href=safeUrl; ml.target='_blank'; ml.rel='noopener noreferrer'; }
      else { ml.style.display='none'; }
      mp.classList.remove('hidden');
    }
  };
  $('previewImg').addEventListener('error', () => { $('previewImg').classList.add('hidden'); $('previewNoImg').style.display='flex'; });
  $('mobilePopupClose')?.addEventListener('click', () => $('mobilePopup').classList.add('hidden'));
      if(allPlaces.length) selectPlace(allPlaces[0].id);
    } catch(err) {
      listEl.innerHTML = `<div class="empty">Fehler beim Laden:<br>${escHtml(err.message)}</div>`;
      console.error(err);
    }
  };

  loadPlaces();
})();
