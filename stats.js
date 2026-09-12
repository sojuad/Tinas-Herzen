(() => {
  // ════════════════════════════════════════════════════════════════
  // STATISTIKEN – v31
  // Eigenständiges Modul, unabhängig von app.js (nutzt nur den kleinen
  // window.__tinasHerzen Hook am Ende von app.js, um beim Klick auf ein
  // Herz zur Stelle auf der Karte zu springen). Lädt places.json selbst
  // nach, damit die Reihenfolge/Timing von app.js keine Rolle spielt.
  //
  // Datenquellen für Höhe/Klima (beides kostenlos, ohne Key, CORS-offen):
  //   - Höhe/Meerestiefe: OpenTopoData, Dataset "gebco2020"
  //     (einziges Dataset, das sowohl Landhöhe als auch echte
  //     Meerestiefe liefert – wichtig für "tiefstgelegen" bei Herzen,
  //     die auf dem offenen Meer liegen, z.B. Wal-Beobachtungen)
  //   - Klima (Temperatur/Niederschlag): Open-Meteo Archive API,
  //     Tageswerte für das letzte abgeschlossene Kalenderjahr, daraus
  //     Jahresmittel-Temperatur & Jahres-Niederschlagssumme berechnet.
  //
  // Ergebnisse werden in localStorage gecacht (pro Herz per id), damit
  // nur neue/geänderte Herzen bei jedem Öffnen nachgeladen werden.
  // ════════════════════════════════════════════════════════════════

  const $ = id => document.getElementById(id);
  const KOELN = { lat: 50.9375, lng: 6.9603 };
  const CACHE_KEY = 'th_stats_cache_v1';
  const CACHE_VERSION = 1;

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
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── ELEVATION / MEERESTIEFE (OpenTopoData, gebco2020) ───────────
  // Batches klein halten (der öffentliche Demo-Server reagiert bei
  // größeren Batches gelegentlich mit 400) und bei Fehlern rekursiv
  // halbieren statt komplett abzubrechen.
  const fetchElevationBatch = async places => {
    if(places.length === 0) return {};
    const locs = places.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|');
    const url = `https://api.opentopodata.org/v1/gebco2020?locations=${encodeURIComponent(locs)}`;
    try {
      const res = await fetch(url);
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if(!data.results || data.results.length !== places.length) throw new Error('Antwort unvollständig');
      const out = {};
      places.forEach((p, i) => { out[p.id] = data.results[i].elevation; });
      return out;
    } catch(err) {
      if(places.length === 1) { return { [places[0].id]: null }; }
      const mid = Math.ceil(places.length / 2);
      const a = await fetchElevationBatch(places.slice(0, mid));
      const b = await fetchElevationBatch(places.slice(mid));
      return { ...a, ...b };
    }
  };

  const fetchAllElevations = async (places, onProgress) => {
    const out = {};
    const BATCH = 8;
    for(let i = 0; i < places.length; i += BATCH) {
      const chunk = places.slice(i, i + BATCH);
      const res = await fetchElevationBatch(chunk);
      Object.assign(out, res);
      if(onProgress) onProgress(Math.min(i + BATCH, places.length), places.length);
      if(i + BATCH < places.length) await sleep(350); // Rate-Limit des freien Servers respektieren
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
      `&start_date=${year}-01-01&end_date=${year}-12-31&daily=temperature_2m_mean,precipitation_sum&timezone=UTC`;
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
        const tempMean = temps.length ? temps.reduce((a,b)=>a+b,0) / temps.length : null;
        const precipSum = precs.length ? precs.reduce((a,b)=>a+b,0) : null;
        out[p.id] = { tempMean, precipSum };
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
    const BATCH = 12;
    for(let i = 0; i < places.length; i += BATCH) {
      const chunk = places.slice(i, i + BATCH);
      const res = await fetchClimateBatch(chunk, year);
      Object.assign(out, res);
      if(onProgress) onProgress(Math.min(i + BATCH, places.length), places.length);
      if(i + BATCH < places.length) await sleep(150);
    }
    return out;
  };

  // ── RENDER HELPERS ───────────────────────────────────────────────
  const placeSub = p => [p.country, p.continent].filter(Boolean).join(' · ');

  const rowHtml = (rank, p, valueLabel, opts={}) => `
    <div class="stats-row" data-id="${escHtml(p.id)}">
      <div class="stats-row-rank">${rank}</div>
      <div class="stats-row-title">${escHtml(p.title)}</div>
      <div class="stats-row-sub">${escHtml(opts.sub != null ? opts.sub : placeSub(p))}</div>
      <div class="stats-row-value${opts.neg ? ' neg' : ''}">${valueLabel}</div>
    </div>`;

  const cardHtml = (label, valueLabel, p, sub) => `
    <div class="stats-card" data-id="${escHtml(p.id)}">
      <div class="stats-card-label">${escHtml(label)}</div>
      <div class="stats-card-value">${valueLabel}</div>
      <div class="stats-card-place">${escHtml(p.title)}</div>
      <div class="stats-card-sub">${escHtml(sub != null ? sub : placeSub(p))}</div>
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
    const north = places.reduce((a,b) => b.lat > a.lat ? b : a);
    const south = places.reduce((a,b) => b.lat < a.lat ? b : a);

    let farthestFromKoeln = places[0], maxKoelnDist = -1;
    const distSum = new Map();
    for(const p of places) {
      const dK = haversineKm(KOELN.lat, KOELN.lng, p.lat, p.lng);
      if(dK > maxKoelnDist) { maxKoelnDist = dK; farthestFromKoeln = p; }
      let sum = 0;
      for(const q of places) { if(q.id !== p.id) sum += haversineKm(p.lat, p.lng, q.lat, q.lng); }
      distSum.set(p.id, sum / (places.length - 1));
    }
    let farthestFromAll = places[0], maxAvgDist = -1;
    for(const p of places) {
      const avg = distSum.get(p.id);
      if(avg > maxAvgDist) { maxAvgDist = avg; farthestFromAll = p; }
    }

    body.innerHTML = `
      <div>
        <div class="stats-section-title">&#128506; Geografische Extreme</div>
        <div class="stats-grid">
          ${cardHtml('Nördlichstes Herz', fmtNum(north.lat,4) + '° N', north)}
          ${cardHtml('Südlichstes Herz', fmtNum(Math.abs(south.lat),4) + '° ' + (south.lat<0?'S':'N'), south)}
          ${cardHtml('Am weitesten von Köln', fmtNum(maxKoelnDist) + ' km', farthestFromKoeln)}
          ${cardHtml('Am weitesten von allen anderen', '⌀ ' + fmtNum(maxAvgDist) + ' km', farthestFromAll, placeSub(farthestFromAll) + ' · Durchschnitt zu allen anderen Herzen')}
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
      const sorted = [...withElev].sort((a,b) => b.elevation - a.elevation);
      const top10High = sorted.slice(0, 10);
      const top10Low = [...withElev].sort((a,b) => a.elevation - b.elevation).slice(0, 10);

      sec.innerHTML = `
        <div class="stats-section-title">&#9968; Höhe &amp; Meerestiefe
          <span class="stats-section-note">Meerestiefe wird bei Herzen auf offenem Wasser ermittelt (negative Werte)</span>
        </div>
        <div class="stats-grid">
          <div>
            <div class="stats-card-label" style="margin-bottom:6px;">Top 10 höchstgelegen</div>
            <div class="stats-list">
              ${top10High.map((x,i) => rowHtml(i+1, x.p, fmtNum(x.elevation) + ' m')).join('')}
            </div>
          </div>
          <div>
            <div class="stats-card-label" style="margin-bottom:6px;">Top 10 tiefstgelegen</div>
            <div class="stats-list">
              ${top10Low.map((x,i) => rowHtml(i+1, x.p, fmtNum(x.elevation) + ' m', { neg: x.elevation < 0 })).join('')}
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
        return !c || c.year !== year || !coordsMatch(c, p);
      });
      if(missing.length) {
        await fetchAllClimate(missing, year, (done, total) => {
          const el = $('climProgress'); if(el) el.textContent = `(${done}/${total})`;
        }).then(res => {
          for(const p of missing) {
            const v = res[p.id];
            if(v != null) cache.climate[p.id] = { lat: p.lat, lng: p.lng, year, tempMean: v.tempMean, precipSum: v.precipSum };
          }
          saveCache(cache);
        });
      }
      const withClimate = places
        .map(p => ({ p, c: cache.climate[p.id] }))
        .filter(x => x.c && x.c.tempMean != null && x.c.precipSum != null);

      const sec = $('statsClimateSection');
      if(!sec) return;
      if(!withClimate.length) {
        sec.innerHTML = `<div class="stats-section-title">&#127777; Klima</div><div class="stats-error">Klimadaten konnten nicht geladen werden.</div>`;
        return;
      }
      const hottest = withClimate.reduce((a,b) => b.c.tempMean > a.c.tempMean ? b : a);
      const coldest = withClimate.reduce((a,b) => b.c.tempMean < a.c.tempMean ? b : a);
      const rainiest = withClimate.reduce((a,b) => b.c.precipSum > a.c.precipSum ? b : a);

      sec.innerHTML = `
        <div class="stats-section-title">&#127777; Klima
          <span class="stats-section-note">Wetterjahr ${year}, Quelle: Open-Meteo</span>
        </div>
        <div class="stats-grid">
          ${cardHtml('Heißestes Herz', fmtNum(hottest.c.tempMean,1) + ' °C ⌀', hottest.p, placeSub(hottest.p) + ` · Jahresmittel ${year}`)}
          ${cardHtml('Kühlstgelegenes Herz', fmtNum(coldest.c.tempMean,1) + ' °C ⌀', coldest.p, placeSub(coldest.p) + ` · Jahresmittel ${year}`)}
          ${cardHtml('Regenreichstes Herz', fmtNum(rainiest.c.precipSum) + ' mm', rainiest.p, placeSub(rainiest.p) + ` · Jahressumme ${year}`)}
        </div>
      `;
      wireClicks(sec);
    })();
  };

  $('statsBtn')?.addEventListener('click', openStats);
  $('statsBtnMobile')?.addEventListener('click', () => { closeMobileFilterIfPossible(); openStats(); });
  $('statsClose')?.addEventListener('click', () => $('statsOverlay').classList.add('hidden'));
  $('statsOverlay')?.addEventListener('click', e => { if(e.target.id === 'statsOverlay') $('statsOverlay').classList.add('hidden'); });

  function closeMobileFilterIfPossible() {
    $('mobileFilterPanel')?.classList.remove('open');
    $('mobileFilterBtn')?.classList.remove('open');
    $('mobileFilterOverlay')?.classList.remove('open');
  }
})();
