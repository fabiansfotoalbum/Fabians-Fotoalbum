# CLAUDE.md — Fotowebsite

Kontext & Konventionen für die Weiterarbeit an diesem Projekt. (Sprache des Nutzers: **Deutsch**.)

## Was das ist
Digitale Foto-Datenbank & Portfolio. Inhalt sind **Passagen** – je ein **16:9-Canvas** mit
einem/mehreren Fotos und **handgemaltem** Text/Strichen (kein Font). Fotos stehen im Vordergrund.
Gebaut wird mit zwei Teilen:

1. **Editor** – lokaler Web-Builder zum Bauen/Ändern der Passagen (läuft nur auf dem Rechner).
2. **Öffentliche Seite** – statisch mit **Astro**, zeigt die Passagen als hochschiebbaren Stapel.

## Wichtigste Designentscheidungen (vom Nutzer bestätigt)
- **Raster-Pinsel**, ABER die Striche werden als **Daten** (`passage.json`) gespeichert, nicht nur als Bild
  → jede Passage bleibt **dauerhaft editierbar**. `drawing.png` ist nur das gerenderte Ergebnis.
- **Stiftdruck** (Grafiktablett) über Pointer Events. **Wichtig:** Wacom-Druck am Mac kommt nur in
  **Firefox/Chromium** an, **nicht in Safari/WebKit** (auch nicht Tauri/Safari-PWA). Nutzer will
  kein Chrome → der Starter öffnet **Firefox** (`open -a Firefox`, Fallback Standardbrowser).
- **Kein Build-Tool für den Editor**: `editor/server.mjs` ist **pure Node** (keine npm-Abhängigkeiten),
  damit `Foto-Editor.app` per Doppelklick sofort läuft. Astro braucht nur das Publish (`npm install`).
- Kontrast bewusst leicht reduziert: off-white `#f8f7f4`, ink `#141311`.

## Starten / Workflow
- **`Foto-Editor.app`** doppelklicken → startet `editor/server.mjs` (Port **4455**) und öffnet den
  Editor in Firefox. Skript: `Foto-Editor.app/Contents/MacOS/Foto-Editor` (Projektpfad = 3 Ebenen über der Binary).
- Editor-URL: `http://127.0.0.1:4455/` · Vorschau-Stapel: `/view`
- Publish: `npm install` (einmal) → `npm run build` → statische Seite in `dist/` (Hosting noch offen:
  Netlify/Vercel/GitHub Pages). `npm run editor` startet den Server auch ohne die .app.

## Datenmodell (eine Passage)
```
public/passages/<id>/
  <foto>.jpg|png|webp     ← Fotos (frei in den Ordner legbar)
  passage.json           ← QUELLE DER WAHRHEIT: { id, width:2560, height:1440,
                            images:[{src,x,y,w,h}], strokes:[{tool,size,points:[{x,y,p}]}], updated }
  drawing.png            ← gerenderte Zeichenebene (nur Anzeige, beim Speichern neu erzeugt)
public/passages/_order.json  ← Array der Passagen-IDs in Anzeige-Reihenfolge (self-healing)
```
- Canvas intern **2560×1440** (Konstanten `CANVAS_W/CANVAS_H`). Positionen in `passage.json` sind in
  diesen Pixeln; UI/Viewer rechnen in Prozent um.
- Punkte `p` = Druck 0..1. Bei `pen` echter Druck; bei Maus/kein Druck = 0.5.

## Dateien / Verantwortlichkeiten
- `editor/server.mjs` – Node-HTTP-Server. API:
  - `GET /api/passages` · `POST /api/passages {id, before?, after?}` (anlegen + einsortieren)
  - `GET /api/passage?id=` · `POST /api/passage?id=` (passage.json) · `DELETE /api/passage?id=`
  - `POST /api/drawing?id=` (PNG-Body) · `POST /api/image?id=&name=` (Foto-Upload)
  - `POST /api/order {order:[ids]}` (Reihenfolge setzen) · `GET /api/all` (alle inkl. meta für Leiste)
  - Statisch: Editor-UI aus `editor/public/`, Viewer-Assets + `/passages/*` aus `public/`.
  - Sicherheit: `within()` verhindert Path-Traversal; `safeId()`/`safeName()` säubern Eingaben.
- `editor/public/index.html|editor.css|editor.js` – die Editor-Oberfläche.
- `editor/public/view.html` – lokale Vorschau (lädt `viewer.js`, baut Stapel aus der API).
- `public/viewer.css|viewer.js` – **geteilt** von lokaler Vorschau UND Astro-Seite.
- `src/pages/index.astro` – öffentliche Seite; liest `public/passages/*` + `_order.json` beim Build,
  rendert dieselbe Struktur, lädt `viewer.js` (`<script is:inline src="/viewer.js">`).
- `editor/make_icon.py` – erzeugt das App-Icon (pure Python PNG → `iconutil` → `.icns`).
- `Foto-Editor.app/` – handgebautes, unsigniertes Bundle (lokal → keine Quarantäne, läuft per Doppelklick).

## Editor-Funktionen (wo im Code)
- **Pinsel mit Tinten-Textur**: `inkDab()` in `editor.js`. Solider Kern + **leichtes Wobbeln** der
  Strichstärke (`wobble()`) + **selten** ein **flacher** Spritzer (Ellipse entlang Strichrichtung `dir`).
  Radierer nutzt `plainDab()` + `globalCompositeOperation='destination-out'`.
  **Deterministisch** über `hash2(x,y)` → Live-Zeichnen == Neu-Rendern (sonst springt die Textur beim Reload).
  **Stellschrauben** oben in `editor.js`: `WOBBLE_AMOUNT`, `SPECK_CHANCE` (höher=seltener), `SPECK_ALPHA`.
- **Druck → Größe**: `radiusFor()`. Live-Anzeige (`#hud`) zeigt pointerType + Druck; `maybePressureHint()`
  blendet bei erkanntem Stift ohne Druck einen Firefox-Hinweis ein.
- **Undo/Redo**: Snapshot-Stacks (`undoStack/redoStack`, JSON von {images,strokes}). `pushUndo()` vor jeder Aktion.
- **Bilder**: Verschieben/Skalieren (Ecken, Seitenverhältnis gehalten), vorne/hinten, löschen. „Fotos im
  Ordner"-Leiste rechts (`tray`) zum Platzieren; Upload via `POST /api/image`.
- **Lasso** (Tool `lasso`, Taste L): Freihand-Polygon ziehen → wählt **Pinsel-Striche** aus (Stroke gilt
  als gewählt, wenn >50 % seiner Punkte im Polygon liegen; Radierer-Striche ausgenommen). Auswahl =
  `lassoSel` (Indizes) + `selBox`. **Verschieben** (in der Box ziehen) und **Skalieren** (Eck-Anfasser,
  uniform von der Gegenecke, skaliert auch `stroke.size`) transformieren die Punkte direkt; `Entf` löscht
  die Auswahl, `Esc` hebt sie auf. Visualisierung auf separater **Overlay-Canvas** (`#overlay`, z-7,
  pointer-events none); Treffer/Boxen werden in Canvas-Koordinaten gerechnet (`screenScale()`),
  nicht über DOM-Handles. Transform-Start macht `pushUndo()`; `applyState`/`openPassage` löschen die Auswahl.
  Hinweis: Ink-Textur ist koordinaten-deterministisch → nach Verschieben/Skalieren ändert sich die Körnung leicht.
- **Passagen-Leiste links**: Mini-Vorschauen (`buildMini`), Klick öffnet, **Drag&Drop** sortiert
  (`dragAfter`/`persistOrder` → `/api/order`), **Rechtsklick**-Kontextmenü (neu davor/danach, löschen).
- **Tastenkürzel**: V/B/E Werkzeuge · ⌘Z / ⌘⇧Z / ⌘Y · ⌘S speichern · Entf = ausgewähltes Bild weg.

## Öffentliche Navigation (Pager) — `viewer.js setupPager()`
- Kein natives Scrollen; transform-basierter Stapel. `pos` (stufenlos) gerendert: Ganzzahl = Ruhelage,
  Bruchteil = nächste Seite kommt von unten hoch (`translateY`), höhere z-index liegt oben.
- **Scroll-Modell (fullPage.js/GSAP-Stil, nach Web-Recherche):** Eingaben sammeln sich in `intent`
  (px). Die Seite folgt **sanft gefedert** (`frame()` lerpt `pos` → `target+peek`, `EASE`) und **lugt**
  bis `PEEK` hervor (Magnet/Widerstand). Überschreitet `intent` die **Hürde** `HURDLE`, wechselt sie
  ganz (`go()`), danach **`LOCK` ms Sperre** gegen Trägheits-Doppelsprünge (Trackpad-Inertia). Ohne
  Eingabe für `IDLE` ms federt die Vorschau via `settle()` zurück. Wheel-`deltaMode` wird normalisiert.
  **Tuning-Konstanten** oben in `setupPager`: `HURDLE`, `PEEK`, `EASE`, `LOCK`, `IDLE`.
- **Schatten** in `render()` dynamisch: nur **während der Bewegung** sichtbar (`0.55*sin(π·ty/100)`),
  in Ruhelage keiner; Größe `0 -24px 60px`.
- Sprung per `#id` möglich (Editor-Vorschaulink nutzt das).

## Gotchas / Fallen
- Editor-Assets werden mit `Cache-Control: no-store` ausgeliefert → Änderungen nach Browser-Reload sofort da.
  Bei Änderungen an `server.mjs` muss der **Server neu gestartet** werden (App neu starten oder Prozess killen).
- Beim Ändern der Tinten-/Render-Logik die **Determinismus**-Eigenschaft wahren (kein `Math.random`),
  sonst weicht das beim Reload gerenderte Bild vom Live-Strich ab.
- Bestehende `drawing.png` werden erst nach erneutem **Speichern** der Passage neu erzeugt (z. B. nach
  Kontrast-/Textur-Änderungen). Beim Öffnen wird die Canvas aber sofort aus `strokes` neu gerendert.
- `_order.json` ist führend; `listPassages()` heilt sie (fehlende anhängen, gelöschte entfernen).
- Drag in der Leiste setzt `justDragged`, damit kein versehentliches Öffnen nach dem Sortieren passiert.

## Offen / Ideen
- **Hosting** final wählen (Netlify/Vercel/GitHub Pages).
- Mögliche Erweiterung: echtes „Umblättern" als Alternative zum Hochschieben; Einfüge-Indikator beim Sortieren.
