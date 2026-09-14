(() => {
  // ════════════════════════════════════════════════════════════════
  // STATISTIKEN – v31
  // Eigenständiges Modul, unabhängig von app.js (nutzt nur den kleinen
  // window.__tinasHerzen Hook am Ende von app.js, um beim Klick auf ein
  // Herz zur Stelle auf der Karte zu springen). Lädt places.json selbst
  // nach, damit die Reihenfolge/Timing von app.js keine Rolle spielt.
  //
  // Datenquellen (beide kostenlos, ohne Key, CORS-offen im Browser):
  //   - Höhe/Meerestiefe: NOAA NCEI "DEM global mosaic" ImageServer
  //     (ETOPO-basiert) – liefert in EINER Anfrage sowohl Landhöhe als
  //     auch echte Meerestiefe (negative Werte). Wichtig für Herzen,
  //     die auf offenem Wasser liegen (z.B. Wal-Beobachtungen) – die
  //     zuvor getestete OpenTopoData-API wurde verworfen, weil sie
  //     keine CORS-Header sendet und im echten Browser fehlschlägt.
  //   - Klima (Temperatur/Niederschlag): Open-Meteo Archive API,
  //     Tageswerte für das letzte abgeschlossene Kalenderjahr, daraus
  //     Jahresmittel-Temperatur & Jahres-Niederschlagssumme berechnet.
  //
  // Ergebnisse werden in localStorage gecacht (pro Herz per id), damit
  // nur neue/geänderte Herzen bei jedem Öffnen nachgeladen werden.
  // ════════════════════════════════════════════════════════════════

  const $ = id => document.getElementById(id);
  const KOELN = { lat: 50.9375, lng: 6.9603 };
  const CACHE_KEY = 'th_stats_cache_v2';
  const CACHE_VERSION = 2;
  const TOP_N = 4; // wie viele Plätze pro "Sieger"-Karte immer gezeigt werden

  const escHtml = s => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const fmtNum = (n, digits=0) => {
    if(n == null || !Number.isFinite(n)) return '–';
    return n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  const haversineKm = (aLat, aLng, bLat, bLng) => {
    const R = 6371;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
    const s = Math.sin(dLat/2)**2 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };

  // ── CACHE ────────────────────────────────────────────────────────
  const loadCache = () => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if(!raw) return { v: CACHE_VERSION, elevation: {}, climate: {} };
      const parsed = JSON.parse(raw);
      if(parsed.v !== CACHE_VERSION) return { v: CACHE_VERSION, elevation: {}, climate: {} };
      return parsed;
    } catch { return { v: CACHE_VERSION, elevation: {}, climate: {} }; }
  };
  const saveCache = cache => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
  };

  const coordsMatch = (a, p) => a && Math.abs(a.lat - p.lat) < 1e-4 && Math.abs(a.lng - p.lng) < 1e-4;

  // ── HÖHE / MEERESTIEFE (NOAA NCEI DEM global mosaic, ETOPO) ──────
  // Ein einziger Request kann problemlos hunderte Punkte per
  // "esriGeometryMultipoint" verarbeiten (getestet mit 157 Punkten in
  // einem Rutsch) – trotzdem in Chunks von 100, damit die Sammlung
  // auch bei künftigem Wachstum robust bleibt. Bei Fehlern wird der
  // Chunk rekursiv halbiert statt komplett aufzugeben.
  const ELEVATION_URL = 'https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_global_mosaic/ImageServer/getSamples';

  const fetchElevationBatch = async places => {
    if(places.length === 0) return {};
    const geometry = {
      points: places.map(p => [p.lng, p.lat]),
      spatialReference: { wkid: 4326 }
    };
    const url = `${ELEVATION_URL}?geometryType=esriGeometryMultipoint` +
      `&geometry=${encodeURIComponent(JSON.stringify(geometry))}` +
      `&returnFirstValueOnly=true&f=json`;
    try {
      const res = await fetch(url);
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if(data.error) throw new Error(data.error.message || 'API-Fehler');
      if(!data.samples || data.samples.length !== places.length) throw new Error('Antwort unvollständig');
      // WICHTIG: Der Server sortiert die Samples bei größeren Batches intern um
      // (Array-Position ≠ Eingabe-Reihenfolge!) – die einzig verlässliche
      // Zuordnung ist das mitgelieferte locationId, das dem Index im
      // gesendeten "points"-Array entspricht.
      const byLocationId = {};
      data.samples.forEach(s => { byLocationId[s.locationId] = s.value; });
      const out = {};
      places.forEach((p, i) => {
        const val = parseFloat(byLocationId[i]);
        out[p.id] = Number.isFinite(val) ? val : null;
      });
      return out;
    } catch(err) {
      if(places.length === 1) return { [places[0].id]: null };
      const mid = Math.ceil(places.length / 2);
      const a = await fetchElevationBatch(places.slice(0, mid));
      const b = await fetchElevationBatch(places.slice(mid));
      return { ...a, ...b };
    }
  };

  const fetchAllElevations = async (places, onProgress) => {
    const out = {};
    const BATCH = 100;
    for(let i = 0; i < places.length; i += BATCH) {
      const chunk = places.slice(i, i + BATCH);
      const res = await fetchElevationBatch(chunk);
      Object.assign(out, res);
      if(onProgress) onProgress(Math.min(i + BATCH, places.length), places.length);
    }
    return out;
  };

  // ── KLIMA (Open-Meteo Archive API) ──────────────────────────────
  const climateYear = () => new Date().getFullYear() - 1; // letztes abgeschlossenes Jahr

  const fetchClimateBatch = async (places, year) => {
    if(places.length === 0) return {};
    const lats = places.map(p => p.lat.toFixed(4)).join(',');
    const lngs = places.map(p => p.lng.toFixed(4)).join(',');
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lngs}` +
      `&start_date=${year}-01-01&end_date=${year}-12-31&daily=temperature_2m_mean,precipitation_sum,sunshine_duration&timezone=UTC`;
    try {
      const res = await fetch(url);
      if(!res.ok) throw new Error('HTTP ' + res.status);
      let data = await res.json();
      if(!Array.isArray(data)) data = [data]; // bei genau einem Ort liefert die API kein Array
      if(data.length !== places.length) throw new Error('Antwort unvollständig');
      const out = {};
      places.forEach((p, i) => {
        const d = data[i]?.daily;
        if(!d || !d.temperature_2m_mean || !d.precipitation_sum) { out[p.id] = null; return; }
        const temps = d.temperature_2m_mean.filter(v => v != null);
        const precs = d.precipitation_sum.filter(v => v != null);
        // sunshine_duration liefert Sekunden pro Tag – für die Jahressumme in Stunden umrechnen.
        const suns = (d.sunshine_duration || []).filter(v => v != null);
        const tempMean = temps.length ? temps.reduce((a,b)=>a+b,0) / temps.length : null;
        const precipSum = precs.length ? precs.reduce((a,b)=>a+b,0) : null;
        const sunHours = suns.length ? suns.reduce((a,b)=>a+b,0) / 3600 : null;
        out[p.id] = { tempMean, precipSum, sunHours };
      });
      return out;
    } catch(err) {
      if(places.length === 1) return { [places[0].id]: null };
      const mid = Math.ceil(places.length / 2);
      const a = await fetchClimateBatch(places.slice(0, mid), year);
      const b = await fetchClimateBatch(places.slice(mid), year);
      return { ...a, ...b };
    }
  };

  const fetchAllClimate = async (places, year, onProgress) => {
    const out = {};
    const BATCH = 15;
    for(let i = 0; i < places.length; i += BATCH) {
      const chunk = places.slice(i, i + BATCH);
      const res = await fetchClimateBatch(chunk, year);
      Object.assign(out, res);
      if(onProgress) onProgress(Math.min(i + BATCH, places.length), places.length);
    }
    return out;
  };

  // ── RENDER HELPERS ───────────────────────────────────────────────
  const placeSub = p => [p.country, p.continent].filter(Boolean).join(' · ');

  // Kompakte Zeile, in Top-10-Listen UND in den Top-3-Karten verwendet.
  const miniRowHtml = (rank, p, valueLabel, opts={}) => `
    <div class="stats-row" data-id="${escHtml(p.id)}">
      <div class="stats-row-rank">${rank}</div>
      <div class="stats-row-title">${escHtml(p.title)}</div>
      <div class="stats-row-value${opts.neg ? ' neg' : ''}">${valueLabel}</div>
    </div>`;

  // Kompakte Karte: Titel/Label oben, darunter immer die Top 3 (statt nur
  // dem Sieger) – kleiner als vorher und trotzdem informativer.
  const topCardHtml = (label, items, note) => `
    <div class="stats-card">
      <div class="stats-card-label">${escHtml(label)}${note ? ` <span class="stats-card-note">${escHtml(note)}</span>` : ''}</div>
      <div class="stats-list">
        ${items.map((it, i) => miniRowHtml(i+1, it.p, it.valueLabel, it.opts)).join('')}
      </div>
    </div>`;

  // Statische Zeile für Namen+Anzahl (Land/Kontinent-Ranking) – kein Klick,
  // da es sich nicht um ein einzelnes Herz handelt.
  const nameCountRowHtml = (rank, name, count) => `
    <div class="stats-row static">
      <div class="stats-row-rank">${rank}</div>
      <div class="stats-row-title">${escHtml(name)}</div>
      <div class="stats-row-value">${count} Herz${count!==1?'en':''}</div>
    </div>`;

  const countCardHtml = (label, entries, note) => `
    <div class="stats-card">
      <div class="stats-card-label">${escHtml(label)}${note ? ` <span class="stats-card-note">${escHtml(note)}</span>` : ''}</div>
      <div class="stats-list">
        ${entries.map((e,i) => nameCountRowHtml(i+1, e[0], e[1])).join('')}
      </div>
    </div>`;

  // Karte mit einer einzelnen großen Zahl (z.B. "12 Länder").
  const bigNumberCardHtml = (label, value, note) => `
    <div class="stats-card">
      <div class="stats-card-label">${escHtml(label)}${note ? ` <span class="stats-card-note">${escHtml(note)}</span>` : ''}</div>
      <div class="stats-bignum">${value}</div>
    </div>`;

  const wireClicks = container => {
    container.querySelectorAll('[data-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        window.__tinasHerzen?.flyToPlace(id);
        $('statsOverlay').classList.add('hidden');
      });
    });
  };

  const topN = (arr, cmp, n=TOP_N) => [...arr].sort(cmp).slice(0, n);

  // ── KARTEN-BUTTON ────────────────────────────────────────────────
  // Ersetzt die alten Sidebar-/Mobile-Buttons: eigener Mapbox-Control,
  // der optisch zum Kartenstil-Umschalter (LayerSwitchControl in app.js)
  // passt und direkt in der Steuerelement-Leiste oben links erscheint –
  // dadurch automatisch auch auf Mobile sichtbar (die Karte hat dort
  // keinen eigenen Umschalter, aber die Mapbox-Controls sind immer da).
  class StatsMapControl {
    onAdd(mapInstance) {
      this._map = mapInstance;
      const el = document.createElement('div');
      el.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'layer-switch-btn';
      btn.setAttribute('aria-label', 'Statistiken');
      btn.title = 'Statistiken';
      btn.innerHTML = '&#128202;';
      btn.addEventListener('click', e => { e.stopPropagation(); openStats(); });
      el.appendChild(btn);
      this._container = el;
      return el;
    }
    onRemove() { this._container.parentNode?.removeChild(this._container); }
  }

  // ── MAIN ─────────────────────────────────────────────────────────
  let started = false;

  const openStats = async () => {
    const overlay = $('statsOverlay');
    overlay.classList.remove('hidden');
    if(started) return; // schon geladen/lädt
    started = true;
    const body = $('statsBody');

    let places;
    try {
      const res = await fetch('./places.json?v=' + Date.now());
      const data = await res.json();
      places = data.filter(p => p.title && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
                    .map(p => ({...p, lat:Number(p.lat), lng:Number(p.lng)}));
    } catch(err) {
      body.innerHTML = `<div class="stats-error">Orte konnten nicht geladen werden.</div>`;
      started = false;
      return;
    }
    if(places.length < 2) {
      body.innerHTML = `<div class="stats-error">Zu wenige Orte für Statistiken.</div>`;
      return;
    }

    // ── 1) Geometrie-Statistiken (sofort, ohne Netzwerk) ──────────
    const byLatDesc = topN(places, (a,b) => b.lat - a.lat);
    const byLatAsc  = topN(places, (a,b) => a.lat - b.lat);
    const byLngDesc = topN(places, (a,b) => b.lng - a.lng); // Osten
    const byLngAsc  = topN(places, (a,b) => a.lng - b.lng); // Westen

    const distSum = new Map();
    const distKoeln = new Map();
    for(const p of places) {
      distKoeln.set(p.id, haversineKm(KOELN.lat, KOELN.lng, p.lat, p.lng));
      let sum = 0;
      for(const q of places) { if(q.id !== p.id) sum += haversineKm(p.lat, p.lng, q.lat, q.lng); }
      distSum.set(p.id, sum / (places.length - 1));
    }
    const byKoelnDesc = topN(places, (a,b) => distKoeln.get(b.id) - distKoeln.get(a.id));
    const byAvgDistDesc = topN(places, (a,b) => distSum.get(b.id) - distSum.get(a.id));

    // ── 1b) Länder / Kontinente ───────────────────────────────────
    const countBy = key => {
      const m = new Map();
      for(const p of places) { const v = p[key]; if(!v) continue; m.set(v, (m.get(v)||0)+1); }
      return [...m.entries()].sort((a,b) => b[1]-a[1]);
    };
    const countryCounts = countBy('country');
    const continentCounts = countBy('continent');

    // ── 1c) Chronologische Reiseroute & neuestes Herz ─────────────
    const datedAsc = places.filter(p => p.date).slice().sort((a,b) => new Date(a.date) - new Date(b.date));
    let routeKm = 0;
    for(let i=1;i<datedAsc.length;i++) routeKm += haversineKm(datedAsc[i-1].lat, datedAsc[i-1].lng, datedAsc[i].lat, datedAsc[i].lng);
    const byNewest = datedAsc.slice(-TOP_N).reverse(); // die letzten N chronologisch, neuestes zuerst
    const fmtDate = d => new Date(d).toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit',year:'numeric'});

    body.innerHTML = `
      <div>
        <div class="stats-section-title">&#128506; Geografische Extreme</div>
        <div class="stats-grid stats-grid-wide">
          ${topCardHtml('Nördlichstes Herz', byLatDesc.map(p => ({ p, valueLabel: fmtNum(p.lat,4) + '° N' })))}
          ${topCardHtml('Südlichstes Herz', byLatAsc.map(p => ({ p, valueLabel: fmtNum(Math.abs(p.lat),4) + '° ' + (p.lat<0?'S':'N') })))}
          ${topCardHtml('Östlichstes Herz', byLngDesc.map(p => ({ p, valueLabel: fmtNum(Math.abs(p.lng),4) + '° ' + (p.lng<0?'W':'O') })))}
          ${topCardHtml('Westlichstes Herz', byLngAsc.map(p => ({ p, valueLabel: fmtNum(Math.abs(p.lng),4) + '° ' + (p.lng<0?'W':'O') })))}
          ${topCardHtml('Am weitesten von Köln', byKoelnDesc.map(p => ({ p, valueLabel: fmtNum(distKoeln.get(p.id)) + ' km' })))}
          ${topCardHtml('Am weitesten von allen anderen', byAvgDistDesc.map(p => ({ p, valueLabel: '⌀ ' + fmtNum(distSum.get(p.id)) + ' km' })), 'Ø-Distanz zu allen anderen Herzen')}
        </div>
      </div>
      <div>
        <div class="stats-section-title">&#127760; Länder &amp; Kontinente</div>
        <div class="stats-grid">
          ${bigNumberCardHtml('Länder', countryCounts.length)}
          ${bigNumberCardHtml('Kontinente', continentCounts.length)}
          ${countCardHtml('Land mit den meisten Herzen', countryCounts.slice(0, TOP_N))}
          ${countCardHtml('Kontinent mit den meisten Herzen', continentCounts.slice(0, TOP_N))}
        </div>
      </div>
      <div>
        <div class="stats-section-title">&#128197; Zeitliche Auswertung</div>
        <div class="stats-grid">
          ${topCardHtml('Neuestes Herz', byNewest.map(p => ({ p, valueLabel: fmtDate(p.date) })))}
          ${bigNumberCardHtml('Chronologische Gesamtstrecke', fmtNum(routeKm) + ' km', `Route durch ${datedAsc.length} Herzen mit Datum, in zeitlicher Reihenfolge`)}
        </div>
      </div>
      <div id="statsElevationSection">
        <div class="stats-section-title">&#9968; Höhe &amp; Meerestiefe <span class="stats-section-note">lädt …</span></div>
        <div class="stats-loading">Lade Höhendaten <span id="elevProgress"></span></div>
      </div>
      <div id="statsClimateSection">
        <div class="stats-section-title">&#127777; Klima <span class="stats-section-note">lädt …</span></div>
        <div class="stats-loading">Lade Klimadaten <span id="climProgress"></span></div>
      </div>
    `;
    wireClicks(body);

    const cache = loadCache();

    // ── 2) Höhe / Meerestiefe ──────────────────────────────────────
    (async () => {
      const missing = places.filter(p => !coordsMatch(cache.elevation[p.id], p));
      if(missing.length) {
        await fetchAllElevations(missing, (done, total) => {
          const el = $('elevProgress'); if(el) el.textContent = `(${done}/${total})`;
        }).then(res => {
          for(const p of missing) {
            const v = res[p.id];
            if(v != null) cache.elevation[p.id] = { lat: p.lat, lng: p.lng, elevation: v };
          }
          saveCache(cache);
        });
      }
      const withElev = places
        .map(p => ({ p, elevation: cache.elevation[p.id]?.elevation }))
        .filter(x => x.elevation != null);

      const sec = $('statsElevationSection');
      if(!sec) return;
      if(!withElev.length) {
        sec.innerHTML = `<div class="stats-section-title">&#9968; Höhe &amp; Meerestiefe</div><div class="stats-error">Höhendaten konnten nicht geladen werden.</div>`;
        return;
      }
      const top10High = topN(withElev, (a,b) => b.elevation - a.elevation, TOP_N);
      const top10Low  = topN(withElev, (a,b) => a.elevation - b.elevation, TOP_N);

      sec.innerHTML = `
        <div class="stats-section-title">&#9968; Höhe &amp; Meerestiefe
          <span class="stats-section-note">Meerestiefe wird bei Herzen auf offenem Wasser ermittelt (negative Werte)</span>
        </div>
        <div class="stats-grid">
          <div class="stats-card">
            <div class="stats-card-label">Top ${TOP_N} höchstgelegen</div>
            <div class="stats-list">
              ${top10High.map((x,i) => miniRowHtml(i+1, x.p, fmtNum(x.elevation) + ' m')).join('')}
            </div>
          </div>
          <div class="stats-card">
            <div class="stats-card-label">Top ${TOP_N} tiefstgelegen</div>
            <div class="stats-list">
              ${top10Low.map((x,i) => miniRowHtml(i+1, x.p, fmtNum(x.elevation) + ' m', { neg: x.elevation < 0 })).join('')}
            </div>
          </div>
        </div>
      `;
      wireClicks(sec);
    })();

    // ── 3) Klima ────────────────────────────────────────────────────
    (async () => {
      const year = climateYear();
      const missing = places.filter(p => {
        const c = cache.climate[p.id];
        return !c || c.year !== year || !coordsMatch(c, p) || c.sunHours == null;
      });
      if(missing.length) {
        await fetchAllClimate(missing, year, (done, total) => {
          const el = $('climProgress'); if(el) el.textContent = `(${done}/${total})`;
        }).then(res => {
          for(const p of missing) {
            const v = res[p.id];
            if(v != null) cache.climate[p.id] = { lat: p.lat, lng: p.lng, year, tempMean: v.tempMean, precipSum: v.precipSum, sunHours: v.sunHours };
          }
          saveCache(cache);
        });
      }
      const withClimate = places
        .map(p => ({ p, c: cache.climate[p.id] }))
        .filter(x => x.c && x.c.tempMean != null && x.c.precipSum != null);
      const withSun = places
        .map(p => ({ p, c: cache.climate[p.id] }))
        .filter(x => x.c && x.c.sunHours != null);

      const sec = $('statsClimateSection');
      if(!sec) return;
      if(!withClimate.length) {
        sec.innerHTML = `<div class="stats-section-title">&#127777; Klima</div><div class="stats-error">Klimadaten konnten nicht geladen werden.</div>`;
        return;
      }
      const hottest  = topN(withClimate, (a,b) => b.c.tempMean - a.c.tempMean);
      const coldest  = topN(withClimate, (a,b) => a.c.tempMean - b.c.tempMean);
      const rainiest = topN(withClimate, (a,b) => b.c.precipSum - a.c.precipSum);
      const sunniest = topN(withSun, (a,b) => b.c.sunHours - a.c.sunHours);

      sec.innerHTML = `
        <div class="stats-section-title">&#127777; Klima
          <span class="stats-section-note">Wetterjahr ${year}, Quelle: Open-Meteo</span>
        </div>
        <div class="stats-grid">
          ${topCardHtml('Höchste Temperatur', hottest.map(x => ({ p: x.p, valueLabel: fmtNum(x.c.tempMean,1) + ' °C' })), `Jahresmittel ${year}`)}
          ${topCardHtml('Tiefste Temperatur', coldest.map(x => ({ p: x.p, valueLabel: fmtNum(x.c.tempMean,1) + ' °C' })), `Jahresmittel ${year}`)}
          ${topCardHtml('Höchster Niederschlag', rainiest.map(x => ({ p: x.p, valueLabel: fmtNum(x.c.precipSum) + ' mm' })), `Jahressumme ${year}`)}
          ${sunniest.length ? topCardHtml('Sonnigstes Herz', sunniest.map(x => ({ p: x.p, valueLabel: fmtNum(x.c.sunHours) + ' h' })), `Jahressumme ${year}`) : ''}
        </div>
      `;
      wireClicks(sec);
    })();
  };

  $('statsClose')?.addEventListener('click', () => $('statsOverlay').classList.add('hidden'));
  $('statsOverlay')?.addEventListener('click', e => { if(e.target.id === 'statsOverlay') $('statsOverlay').classList.add('hidden'); });

  // Button direkt als Kartensteuerelement hinzufügen (oben links, unter
  // Zoom + Kartenstil-Umschalter) – funktioniert dadurch auch auf Mobile.
  if (window.__tinasHerzen && window.__tinasHerzen.map) {
    window.__tinasHerzen.map.addControl(new StatsMapControl(), 'top-left');
  }
})();
