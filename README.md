Tinas Herzen

## Dateien
| Datei | Zweck |
|---|---|
| `index.html` | App-Struktur |
| `style.css` | Design |
| `app.js` | Logik (lädt places.json) |
| `places.json` | **Deine Orte – nur diese Datei bearbeiten!** |

---

## Ort hinzufügen / bearbeiten

Bearbeite `places.json` lokal. Jeder Eintrag hat folgende Felder:

```json
{
  "id": "p_001",
  "title": "Eiffelturm",
  "continent": "Europa",
  "lat": 48.8584,
  "lng": 2.2945,
  "url": "https://www.toureiffel.paris/de",
  "photo": "https://drive.google.com/file/d/DEINE_ID/view",
  "note": "Optionaler Text, erscheint in der Sidebar."
}
```

**Pflichtfelder:** `id`, `title`, `lat`, `lng`, `continent`
**Kontinent-Werte:** `Europa` · `Asien` · `Nordamerika` · `Südamerika` · `Afrika` · `Ozeanien`

---

## Deployment auf GitHub Pages

1. **Repo anlegen** → https://github.com/new (Public, Name z.B. `weltkarte`)
2. **Alle 4 Dateien hochladen** (index.html, style.css, app.js, places.json)
3. **Pages aktivieren:** Settings → Pages → Branch: main / root → Save
4. App läuft nach ~1 Minute unter:
   `https://DEIN-USERNAME.github.io/weltkarte/`

## Update (neue Orte)
Nur `places.json` im GitHub-Repo ersetzen → fertig.

---

## In WordPress einbetten

Block „Benutzerdefiniertes HTML" hinzufügen, folgendes einfügen:

```html
<iframe
  src="https://DEIN-USERNAME.github.io/weltkarte/"
  width="100%"
  height="750"
  style="border:none; border-radius:14px;"
  loading="lazy"
  title="Weltkarte">
</iframe>
```

---

## Google Drive Fotos
Datei auf „Jeder mit dem Link kann ansehen" stellen,
dann den normalen Share-Link als `photo`-Wert eintragen.
Die App wandelt ihn automatisch in eine direkte Bild-URL um.
