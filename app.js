(() => {
  const STORAGE_KEY = "world_map_places_v3";
  const $ = (id) => document.getElementById(id);

  const toast = (msg) => {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2000);
  };

  const uuid = () => "p_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  const toFixedCoord = (x) => (Math.round(x * 1e6) / 1e6).toFixed(6);

  const escapeHtml = (s) => String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const sanitizeUrl = (url) => {
    if (!url) return "";
    try { return new URL(url).toString(); } catch { return ""; }
  };

  // Google Drive: share-link -> direct thumbnail URL
  const extractDriveId = (url) => {
    if (!url) return "";
    try {
      const u = new URL(url);
      if (!/drive\.google\.com$/.test(u.hostname)) return "";
      const m1 = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
      if (m1) return m1[1];
      const idParam = u.searchParams.get("id");
      if (idParam) return idParam;
      return "";
    } catch { return ""; }
  };

  const normalizePhotoUrl = (url) => {
    const clean = sanitizeUrl(url);
    if (!clean) return "";
    const id = extractDriveId(clean);
    if (id) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1000`;
    return clean;
  };

  const loadPlaces = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  };
  const savePlaces = (places) => localStorage.setItem(STORAGE_KEY, JSON.stringify(places));

  let places = loadPlaces();
  let selectedId = null;

  const map = L.map("map", { center: [20, 0], zoom: 2, worldCopyJump: true, preferCanvas: true });

  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; OpenStreetMap-Mitwirkende'
  });
  const esri = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Tiles &copy; Esri" }
  );
  osm.addTo(map);
  L.control.layers({ "OpenStreetMap": osm, "Satellit (Esri)": esri }, null, { position: "topleft" }).addTo(map);

  const markersLayer = L.layerGroup().addTo(map);
  const markerById = new Map();

  const makePopupHtml = (p) => {
    const safeUrl = sanitizeUrl(p.url);
    const photo = normalizePhotoUrl(p.photo);
    const target = p.openNewTab ? ' target="_blank" rel="noopener noreferrer"' : "";
    const img = photo ? `<img src="${photo}" alt="" style="width:260px; max-width:75vw; height:auto; border-radius:12px; display:block; margin:6px 0 10px 0;"/>` : "";
    const link = safeUrl ? `<a href="${safeUrl}" ${target}>Link öffnen</a>` : `<span style="color:rgba(233,238,252,.65)">Kein Link hinterlegt</span>`;
    const note = p.note ? `<div style="margin-top:8px; white-space:pre-wrap; color:rgba(233,238,252,.85)">${escapeHtml(p.note)}</div>` : "";
    const coords = `<div style="margin-top:8px; color:rgba(233,238,252,.65); font-size:12px">(${toFixedCoord(p.lat)}, ${toFixedCoord(p.lng)})</div>`;
    return `<div style="min-width:260px; max-width:320px">
      <div style="font-weight:900; font-size:14px">${escapeHtml(p.title)}</div>
      ${img}
      ${link}
      ${note}
      ${coords}
    </div>`;
  };

  const makeHoverTooltipHtml = (p) => {
    const photo = normalizePhotoUrl(p.photo);
    const title = escapeHtml(p.title);
    if (!photo) return `<div class="hovercard"><div class="hc-title">${title}</div><div class="hc-muted">Kein Foto</div></div>`;
    return `<div class="hovercard"><div class="hc-title">${title}</div><img src="${photo}" alt=""/><div class="hc-muted">Hover-Vorschau</div></div>`;
  };

  const renderMarkers = (filtered = null) => {
    markersLayer.clearLayers();
    markerById.clear();
    const src = filtered ?? places;

    src.forEach(p => {
      const marker = L.marker([p.lat, p.lng]);
      marker.bindPopup(makePopupHtml(p), { maxWidth: 360 });

      marker.bindTooltip(makeHoverTooltipHtml(p), {
        direction: "top",
        offset: [0, -8],
        opacity: 1,
        className: "hovercard",
        sticky: false
      });
      marker.on("mouseover", () => marker.openTooltip());
      marker.on("mouseout", () => marker.closeTooltip());

      marker.on("click", () => selectPlace(p.id, { from: "marker" }));
      marker.addTo(markersLayer);
      markerById.set(p.id, marker);
    });
  };

  const flyToPlace = (p) => {
    const z = Math.max(map.getZoom(), 7);
    map.flyTo([p.lat, p.lng], z, { duration: 0.8 });
  };

  const listEl = $("list");
  const searchEl = $("search");

  const formatDate = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
    } catch { return ""; }
  };

  const highlightCard = (id) => {
    [...document.querySelectorAll("[data-card-id]")].forEach(el => {
      el.style.outline = el.getAttribute("data-card-id") === id ? "2px solid rgba(110,168,255,.55)" : "none";
    });
  };

  const openLink = (p) => {
    const safeUrl = sanitizeUrl(p.url);
    if (!safeUrl) return;
    if (p.openNewTab) window.open(safeUrl, "_blank", "noopener,noreferrer");
    else window.location.href = safeUrl;
  };

  const deletePlace = (id) => {
    const p = places.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`Ort „${p.title}“ wirklich löschen?`)) return;
    places = places.filter(x => x.id !== id);
    savePlaces(places);
    if (selectedId === id) setSelected(null);
    applyFilter();
    toast("Ort gelöscht");
  };

  const renderList = (filtered = null) => {
    const src = filtered ?? places;
    listEl.innerHTML = "";
    if (src.length === 0) {
      listEl.innerHTML = `<div style="color:rgba(233,238,252,.70); padding:10px; border:1px dashed rgba(255,255,255,.18); border-radius:14px;">
        Noch keine Orte gespeichert. Klicke oben auf <b>Ort hinzufügen</b>.
      </div>`;
      return;
    }

    src.slice().sort((a,b) => (b.createdAt || "").localeCompare(a.createdAt || "")).forEach(p => {
      const safeUrl = sanitizeUrl(p.url);
      const photo = normalizePhotoUrl(p.photo);
      const meta = `${toFixedCoord(p.lat)}, ${toFixedCoord(p.lng)}${p.createdAt ? " · " + formatDate(p.createdAt) : ""}`;

      const card = document.createElement("div");
      card.className = "card";
      card.setAttribute("data-card-id", p.id);

      if (photo) {
        const img = document.createElement("img");
        img.className = "thumb";
        img.loading = "lazy";
        img.src = photo;
        img.alt = "";
        img.addEventListener("error", () => img.remove());
        img.addEventListener("click", () => selectPlace(p.id, { from: "list" }));
        card.appendChild(img);
      }

      const body = document.createElement("div");
      body.className = "cardbody";
      body.innerHTML = `
        <div class="title">${escapeHtml(p.title)}</div>
        <div class="meta">${meta}</div>
        ${p.note ? `<div class="note">${escapeHtml(p.note)}</div>` : ""}
        <div class="row">
          <button class="smallbtn" data-action="select">Auswählen</button>
          <button class="smallbtn" data-action="zoom">Zoomen</button>
          <button class="smallbtn" data-action="open" ${safeUrl ? "" : "disabled"}>Link</button>
          <button class="smallbtn" data-action="edit">Editieren</button>
          <button class="smallbtn danger" data-action="delete">Löschen</button>
        </div>
      `;

      body.querySelector('[data-action="select"]').addEventListener("click", () => selectPlace(p.id, { from: "list" }));
      body.querySelector('[data-action="zoom"]').addEventListener("click", () => {
        selectPlace(p.id, { from: "list" });
        flyToPlace(p);
        const m = markerById.get(p.id);
        if (m) m.openPopup();
      });
      body.querySelector('[data-action="open"]').addEventListener("click", () => openLink(p));
      body.querySelector('[data-action="edit"]').addEventListener("click", () => openEditModal(p.id));
      body.querySelector('[data-action="delete"]').addEventListener("click", () => deletePlace(p.id));
      body.addEventListener("click", (e) => { if (!e.target.closest("button")) selectPlace(p.id, { from: "list" }); });

      card.appendChild(body);
      listEl.appendChild(card);
    });
  };

  const applyFilter = () => {
    const q = (searchEl.value || "").trim().toLowerCase();
    if (!q) {
      renderList();
      renderMarkers();
      if (selectedId) selectPlace(selectedId, { silent: true });
      return;
    }
    const filtered = places.filter(p =>
      (p.title || "").toLowerCase().includes(q) ||
      (p.note || "").toLowerCase().includes(q)
    );
    renderList(filtered);
    renderMarkers(filtered);
    if (selectedId) selectPlace(selectedId, { silent: true });
  };
  searchEl.addEventListener("input", applyFilter);

  const previewEl = $("preview");
  const previewTitle = $("previewTitle");
  const previewMeta = $("previewMeta");
  const previewImg = $("previewImg");
  const previewNoImg = $("previewNoImg");
  const previewNote = $("previewNote");
  const previewZoom = $("previewZoom");
  const previewOpen = $("previewOpen");
  const previewEdit = $("previewEdit");
  const previewDelete = $("previewDelete");

  const setSelected = (id) => {
    selectedId = id;
    if (!id) { previewEl.classList.add("hidden"); highlightCard(null); return; }
    const p = places.find(x => x.id === id);
    if (!p) { previewEl.classList.add("hidden"); highlightCard(null); return; }

    previewEl.classList.remove("hidden");
    previewTitle.textContent = p.title;
    previewMeta.textContent = `${toFixedCoord(p.lat)}, ${toFixedCoord(p.lng)}${p.createdAt ? " · " + formatDate(p.createdAt) : ""}`;

    const photo = normalizePhotoUrl(p.photo);
    if (photo) {
      previewImg.src = photo;
      previewImg.classList.remove("hidden");
      previewNoImg.style.display = "none";
    } else {
      previewImg.classList.add("hidden");
      previewImg.removeAttribute("src");
      previewNoImg.style.display = "block";
    }

    if (p.note) { previewNote.textContent = p.note; previewNote.classList.remove("hidden"); }
    else { previewNote.textContent = ""; previewNote.classList.add("hidden"); }

    const safeUrl = sanitizeUrl(p.url);
    previewOpen.disabled = !safeUrl;

    highlightCard(id);

    previewZoom.onclick = () => { flyToPlace(p); const m = markerById.get(p.id); if (m) m.openPopup(); };
    previewOpen.onclick = () => openLink(p);
    previewEdit.onclick = () => openEditModal(p.id);
    previewDelete.onclick = () => deletePlace(p.id);
  };

  previewImg.addEventListener("error", () => {
    previewImg.classList.add("hidden");
    previewImg.removeAttribute("src");
    previewNoImg.style.display = "block";
  });

  const selectPlace = (id, opts = {}) => {
    const p = places.find(x => x.id === id);
    if (!p) return;
    setSelected(id);
    highlightCard(id);
    if (!opts.silent) toast("Ort ausgewählt");
    if (opts.from === "marker") {
      const m = markerById.get(id);
      if (m) m.openPopup();
    }
  };

  let addMode = false;
  const setAddMode = (on) => {
    addMode = on;
    $("addModeBanner").classList.toggle("hidden", !on);
    $("btnAdd").classList.toggle("primary", !on);
    $("btnAdd").textContent = on ? "Ort hinzufügen (aktiv)" : "Ort hinzufügen";
    toast(on ? "Karte anklicken, um Ort zu setzen" : "Hinzufügen-Modus beendet");
  };
  $("btnAdd").addEventListener("click", () => setAddMode(!addMode));
  $("btnExitAddMode").addEventListener("click", () => setAddMode(false));

  const showFormImagePreview = (url) => {
    const photo = normalizePhotoUrl(url);
    const img = $("formImgPreview");
    const hint = $("formImgHint");
    if (!photo) {
      img.classList.add("hidden");
      img.removeAttribute("src");
      hint.style.display = "block";
      return;
    }
    img.src = photo;
    img.classList.remove("hidden");
    hint.style.display = "none";
  };
  $("photo").addEventListener("input", (e) => showFormImagePreview(e.target.value));
  $("formImgPreview").addEventListener("error", () => showFormImagePreview(""));

  const openModal = ({ mode, lat, lng, place }) => {
    $("placeId").value = mode === "edit" ? place.id : "";
    $("lat").value = lat;
    $("lng").value = lng;
    $("title").value = place?.title || "";
    $("url").value = place?.url || "";
    $("photo").value = place?.photo || "";
    $("note").value = place?.note || "";
    $("openNewTab").checked = place?.openNewTab !== false;
    $("modalTitle").textContent = mode === "edit" ? "Ort editieren" : "Ort hinzufügen";
    showFormImagePreview(place?.photo || "");
    $("modal").classList.remove("hidden");
    $("title").focus();
  };

  const closeModal = () => $("modal").classList.add("hidden");
  $("modalClose").addEventListener("click", closeModal);
  $("btnCancel").addEventListener("click", closeModal);
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });

  map.on("click", (e) => {
    if (!addMode) return;
    openModal({ mode: "add", lat: e.latlng.lat, lng: e.latlng.lng, place: null });
  });

  const openEditModal = (id) => {
    const p = places.find(x => x.id === id);
    if (!p) return;
    openModal({ mode: "edit", lat: p.lat, lng: p.lng, place: p });
  };

  $("placeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const placeId = ($("placeId").value || "").trim();
    const lat = Number($("lat").value);
    const lng = Number($("lng").value);

    const title = ($("title").value || "").trim();
    const url = sanitizeUrl(($("url").value || "").trim());
    const photoRaw = ($("photo").value || "").trim();
    const note = ($("note").value || "").trim();
    const openNewTab = $("openNewTab").checked;

    if (!title) return;

    if (placeId) {
      const idx = places.findIndex(x => x.id === placeId);
      if (idx === -1) return;
      const old = places[idx];
      places[idx] = { ...old, title, url, photo: photoRaw, note, openNewTab, lat, lng, updatedAt: new Date().toISOString() };
      savePlaces(places);
      closeModal(); setAddMode(false);
      applyFilter(); setSelected(placeId);

      const m = markerById.get(placeId);
      if (m) {
        m.setLatLng([lat,lng]);
        m.setPopupContent(makePopupHtml(places[idx]));
        m.setTooltipContent(makeHoverTooltipHtml(places[idx]));
        m.openPopup();
      }
      toast("Ort aktualisiert");
    } else {
      const p = { id: uuid(), title, url, photo: photoRaw, note, openNewTab, lat, lng, createdAt: new Date().toISOString() };
      places.push(p);
      savePlaces(places);
      closeModal(); setAddMode(false);
      applyFilter(); setSelected(p.id);
      flyToPlace(p);
      const m = markerById.get(p.id);
      if (m) m.openPopup();
      toast("Ort gespeichert");
    }
  });

  $("btnExport").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(places, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "places.json";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast("Export gestartet");
  });

  $("fileImport").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("JSON muss ein Array sein.");

      const normalized = data.filter(x => x && typeof x === "object").map(x => ({
        id: String(x.id || uuid()),
        title: String(x.title || "").slice(0,80),
        url: sanitizeUrl(x.url || ""),
        photo: String(x.photo || ""),
        note: String(x.note || "").slice(0,500),
        openNewTab: x.openNewTab !== false,
        lat: Number(x.lat),
        lng: Number(x.lng),
        createdAt: x.createdAt ? String(x.createdAt) : new Date().toISOString(),
        updatedAt: x.updatedAt ? String(x.updatedAt) : undefined
      })).filter(x => x.title && Number.isFinite(x.lat) && Number.isFinite(x.lng));

      if (normalized.length === 0) throw new Error("Keine gültigen Orte gefunden.");
      const mode = confirm("Import: Bestehende Orte ERSETZEN? (OK=ersetzen / Abbrechen=anhängen)");
      places = mode ? normalized : places.concat(normalized);
      savePlaces(places);
      applyFilter();
      toast("Import erfolgreich");
    } catch (err) {
      console.error(err);
      alert("Import fehlgeschlagen: " + (err?.message || err));
    }
  });

  $("btnClear").addEventListener("click", () => {
    if (!confirm("Wirklich ALLE gespeicherten Orte löschen?")) return;
    places = [];
    savePlaces(places);
    setSelected(null);
    applyFilter();
    toast("Alle Orte gelöscht");
  });

  applyFilter();
  if (places.length) setSelected(places[0].id);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("modal").classList.contains("hidden")) closeModal();
      if (addMode) setAddMode(false);
    }
  });
})();