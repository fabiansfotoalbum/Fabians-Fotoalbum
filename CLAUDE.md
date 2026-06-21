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
- Publish lokal testen: `npm install` (einmal) → `npm run build` → statische Seite in `dist/`.
  `npm run editor` startet den Server auch ohne die .app. Live-Deploy s. Abschnitt „Veröffentlichen & Deployment".

## Veröffentlichen & Deployment (GitHub Pages) — LIVE
- **Live:** https://fabiansfotoalbum.github.io/Fabians-Fotoalbum/
- **Repo:** `git@github.com:fabiansfotoalbum/Fabians-Fotoalbum.git` · Branch `main`
- **One-Click:** Editor-Button **„⤴ Veröffentlichen"** (⌘⇧P) → `save()` + `POST /api/publish` → Server macht
  `git add -A` / `commit` / `push` (über SSH-Alias, s. u.). Die GitHub-Action baut Astro und deployed → live nach ~1 Min.

### Reproduzierbares Setup von Null (z. B. neuer Rechner / neues Repo)
**1) Leeres Repo** auf GitHub anlegen (Public, OHNE README/.gitignore).

**2) SSH einrichten — die Falle:** Ein SSH-Schlüssel gehört immer zu **genau einem** GitHub-Account.
Hier gehört der Standardschlüssel `~/.ssh/id_ed25519` zum Account `FabianN1111`, das Repo aber zu
`fabiansfotoalbum` → „Repository not found". Lösung: eigener Schlüssel + Host-Alias, der NUR für dieses
Repo genutzt wird:
```bash
ssh-keygen -t ed25519 -C "fabiansfotoalbum" -f ~/.ssh/id_ed25519_album -N ""   # ohne Passphrase -> App kann pushen
# ~/.ssh/config ergänzen:
#   Host github-album
#     HostName github.com
#     User git
#     IdentityFile ~/.ssh/id_ed25519_album
#     IdentitiesOnly yes        # << wichtig, sonst bietet ssh den falschen Schlüssel an
cat ~/.ssh/id_ed25519_album.pub   # diesen Public Key beim RICHTIGEN Account (fabiansfotoalbum) unter Settings -> SSH keys hinterlegen
ssh -T git@github-album            # muss "Hi fabiansfotoalbum!" begrüßen (Exit 1 ist normal)
```

**3) Remote setzen (Alias-Host verwenden!) und pushen:**
```bash
git init -b main                                   # falls noch kein Repo
git remote add origin git@github-album:fabiansfotoalbum/Fabians-Fotoalbum.git
git add -A && git commit -m "Initial" && git push -u origin main
```

**4) GitHub Pages aktivieren — KRITISCH:** Settings → Pages → **Source = „GitHub Actions"**
(NICHT „Deploy from a branch"!).
- **Falsch-Symptom:** Seite zeigt die README via Jekyll (`<meta name="generator" content="Jekyll …">`)
  und alle Assets (`viewer.js`, Fotos) sind **404** → Quelle steht noch auf „Deploy from a branch".
  GitHub serviert dann das Repo-Wurzelverzeichnis (kein `index.html` dort → README) statt unseres `dist/`.
- Nach Umstellen einen **frischen Deploy** auslösen: leerer Commit `git commit --allow-empty -m "deploy" && git push`
  (re-run des alten Laufs reicht oft nicht). Erster grüner deploy-Job ersetzt die alte Jekyll-Bereitstellung nach ~30 s.
- **Neuer GitHub-Account:** E-Mail muss **verifiziert** sein, sonst laufen Actions gar nicht.

**5) Workflow** `.github/workflows/deploy.yml`: `on: push main` → Job *build* (`npm ci` → `npm run build` →
`upload-pages-artifact path:./dist`) → Job *deploy* (`deploy-pages`). Braucht `package-lock.json` (für `npm ci`,
ist committet). Die „Node 20 deprecated"-Warnung ist **harmlos**.

### Laufender Betrieb
- App: **⤴ Veröffentlichen**. Oder manuell: `git add -A && git commit -m "…" && git push`.
- Prüfen, ob live korrekt: `curl -s <URL>/ | grep -i generator` darf **kein** Jekyll zeigen;
  `curl -o /dev/null -w "%{http_code}" <URL>/viewer.js` muss **200** sein.
- `GIT_TERMINAL_PROMPT=0` im `git()`-Helper → bei fehlendem Zugang klare Fehlermeldung statt Hängen.
- Pfade in `index.astro` sind **relativ** (`passages/…`, `viewer.css`) → läuft unter `…github.io/<repo>/`
  UND auf Root/Custom-Domain ohne `base`-Konfiguration.

## Datenmodell (eine Passage)
```
public/passages/<id>/
  <foto>.jpg|png|webp     ← Fotos (frei in den Ordner legbar)
  passage.json           ← QUELLE DER WAHRHEIT: { id, width:2560, height:1440,
                            images:[{src,x,y,w,h, clip?, crop?}], strokes:[{tool,size,points:[{x,y,p}]}], updated }
                            · clip:true  = Bild auf den Canvas beschränken (kein Überlauf/Anschnitt)
                            · crop:{x,y,w,h} = sichtbarer Ausschnitt als Bruchteile (0..1) des Originalfotos
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
  - `POST /api/rename {id, newId}` (Ordner umbenennen + `_order.json` + `passage.json.id`)
  - `POST /api/drawing?id=` (PNG-Body) · `POST /api/image?id=&name=` (Foto-Upload)
  - `POST /api/order {order:[ids]}` (Reihenfolge setzen) · `GET /api/all` (alle inkl. meta für Leiste)
  - `POST /api/publish` (git add+commit+push im Projektordner; `git()`-Helper mit `GIT_TERMINAL_PROMPT=0`).
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
  Ordner"-Leiste rechts (`tray`) zum Platzieren; Upload via `POST /api/image`. Im Viewer/Editor sind Bilder
  jetzt in einen Wrapper `.layer-img` (div, `overflow:hidden`) gepackt; das innere `<img>` realisiert den
  Beschnitt (`cropInnerStyle()` – identisch in `editor.js`, `viewer.js`, `index.astro`).
- **„⛶ Im Canvas" (Taste C)**: schaltet `clip` fürs gewählte Bild → `clip-path` (`clipInset()`) beschneidet
  es exakt auf den Canvas, kein Anschnitt auf Nachbarseiten.
- **„✂ Zuschneiden" (Taste K, Toggle)**: `enterCrop()`/`exitCrop()` – **live an Ort und Stelle**, kein
  Extra-Fenster. Eine `.crop-layer` (z-8) über der Stage zeigt das volle Foto abgedunkelt (`.crop-ghost`),
  den hellen Ausschnitt (`.crop-bright`) und einen Rahmen (`.crop-frame`) mit 8 Handles. Verschieben =
  Ausschnitt übers Foto schieben, Ecken/Kanten = frei skalieren – alles in Canvas-px (`box`/`fullGeom`),
  live aktualisiert (`refresh()`). Da das volle Foto unverzerrt liegt, hat jeder Ausschnitt automatisch das
  richtige Seitenverhältnis → die Box wird = Ausschnitt, `crop` (Bruchteile des Originals) wird daraus
  berechnet (keine Aspekt-Korrektur nötig). Übernehmen: Klick daneben / Enter / Toggle / Werkzeug-/
  Passagenwechsel. Abbrechen: Esc (verwirft den Undo-Eintrag, da `images` erst beim Übernehmen geschrieben
  wird). Voller Ausschnitt ⇒ `crop` wird entfernt.
- **Lasso** (Tool `lasso`, Taste L): Freihand-Polygon ziehen → wählt **Pinsel-Striche** aus (Stroke gilt
  als gewählt, wenn >50 % seiner Punkte im Polygon liegen; Radierer-Striche ausgenommen). Auswahl =
  `lassoSel` (Indizes) + `selBox`. **Verschieben** (in der Box ziehen) und **Skalieren** (Eck-Anfasser,
  uniform von der Gegenecke, skaliert auch `stroke.size`) transformieren die Punkte direkt; `Entf` löscht
  die Auswahl, `Esc` hebt sie auf. Visualisierung auf separater **Overlay-Canvas** (`#overlay`, z-7,
  pointer-events none); Treffer/Boxen werden in Canvas-Koordinaten gerechnet (`screenScale()`),
  nicht über DOM-Handles. Transform-Start macht `pushUndo()`; `applyState`/`openPassage` löschen die Auswahl.
  Hinweis: Ink-Textur ist koordinaten-deterministisch → nach Verschieben/Skalieren ändert sich die Körnung leicht.
- **Passagen-Leiste links**: Mini-Vorschauen (`buildMini`), Klick öffnet, **Drag&Drop** sortiert
  (`dragAfter`/`persistOrder` → `/api/order`), **Rechtsklick**-Kontextmenü (neue Passage davor/danach,
  **umbenennen** via `renamePassage` → `/api/rename`, löschen). Umbenennen der aktuellen Passage speichert
  vorher (Ordner zieht um) und öffnet sie unter neuem Namen neu.
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
- **Überlauf/Anschnitt nur auf EINE Nachbarseite:** Alle wartenden Seiten liegen gestapelt bei
  `translateY(100%)` mit höherer z-index als die aktuelle Seite – ohne Beschnitt würde der oben überstehende
  Teil der **obersten** (= letzten) wartenden Passage über JEDE frühere Seite ragen. `render()` setzt darum
  pro Frame `clip-path`: nur die aktive Seite (`base=⌊pos⌋`) und die direkt angrenzende (`base+1`) dürfen
  bluten (`inset(-100% …)` ≈ max. eine Seitenhöhe), alle anderen `inset(0% 0% 0% 0%)`. CSS-Default `.passage`
  ist `inset(0% …)` (kein Flash vor JS). `.passage` hat `transition: clip-path .4s …` → der Anschnitt
  gleitet beim Seitenwechsel sanft nach oben/unten rein/raus statt hart zu verschwinden (Werte als % für
  saubere Interpolation).

## Gotchas / Fallen
- Editor-Assets werden mit `Cache-Control: no-store` ausgeliefert → Änderungen nach Browser-Reload sofort da.
  Bei Änderungen an `server.mjs` muss der **Server neu gestartet** werden (App neu starten oder Prozess killen).
- Beim Ändern der Tinten-/Render-Logik die **Determinismus**-Eigenschaft wahren (kein `Math.random`),
  sonst weicht das beim Reload gerenderte Bild vom Live-Strich ab.
- Bestehende `drawing.png` werden erst nach erneutem **Speichern** der Passage neu erzeugt (z. B. nach
  Kontrast-/Textur-Änderungen). Beim Öffnen wird die Canvas aber sofort aus `strokes` neu gerendert.
- `_order.json` ist führend; `listPassages()` heilt sie (fehlende anhängen, gelöschte entfernen).
- Drag in der Leiste setzt `justDragged`, damit kein versehentliches Öffnen nach dem Sortieren passiert.
- **GitHub Pages MUSS auf Source „GitHub Actions" stehen** (nicht „Deploy from a branch") — sonst rendert
  Jekyll die README und alle Assets sind 404. Siehe Abschnitt „Veröffentlichen & Deployment".
- Push läuft über den SSH-Alias `github-album` (Remote-URL = `git@github-album:…`), NICHT über `git@github.com:…`,
  weil der Standardschlüssel zu einem anderen Account gehört.

## Offen / Ideen
- Mögliche Erweiterung: echtes „Umblättern" als Alternative zum Hochschieben; Einfüge-Indikator beim Sortieren;
  Bildunterschriften; eigene Domain (Settings → Pages → Custom domain, dank relativer Pfade ohne Codeänderung).
