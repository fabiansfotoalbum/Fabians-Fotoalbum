# Fotowebsite

Digitale Datenbank & Portfolio. Jede **Passage** ist ein 16:9-Canvas mit einem oder mehreren
Fotos und handgemaltem Text/Strichen (druckempfindlicher Pinsel, Grafiktablett).

## Schnellstart (Editor)

**Doppelklick auf `Foto-Editor.app`** → der lokale Editor öffnet sich im Browser.
Mehr ist nicht nötig (kein Terminal, keine Installation – nur Node.js muss vorhanden sein).

> Beim allerersten Mal blockt macOS unsignierte Apps evtl.: Rechtsklick auf die App → **Öffnen** → **Öffnen**. Danach reicht Doppelklick.

## Workflow

1. **Foto in den Passagen-Ordner legen** – `public/passages/<name>/`. Jeder Ordner = eine Passage.
   (Alternativ im Editor über **🖼 Foto** hochladen.)
2. **Editor öffnen** (Foto-Editor.app). Fotos erscheinen rechts in der Leiste „Fotos im Ordner".
3. **Anordnen**: Werkzeug *Auswählen* → Foto anklicken, ziehen, an den Ecken skalieren.
4. **Malen/Schreiben**: Werkzeug *Pinsel* (schwarz, druckempfindlich). *Radierer* zum Löschen.
5. **Speichern** (⌘S). Die Passage steht damit so online, wie gespeichert.
6. **Vorschau**: Button „Vorschau ↗" zeigt den Stapel (von unten hochschieben).

Du kannst jede Passage jederzeit wieder öffnen und alles ändern – die Pinselstriche werden
als Daten gespeichert (`passage.json`), nicht nur als Bild, daher bleibt alles editierbar.

**Passagen-Leiste links**: kleine Vorschau aller Passagen. Klicken → Passage öffnen.
**Rechtsklick** auf eine Vorschau → *neue Passage davor / danach*, *umbenennen* oder *löschen*.
Die Reihenfolge steht in `public/passages/_order.json` (Editor & Website lesen sie).

### Tastenkürzel
- **V** Auswählen · **B** Pinsel · **E** Radierer · **L** Lasso (Gemaltes auswählen/verschieben/skalieren)
- **⌘Z** Rückgängig · **⌘⇧Z** / **⌘Y** Wiederholen
- **⌘S** Speichern · **⌘⇧P** Veröffentlichen (live stellen) · **Entf** ausgewähltes Bild entfernen
- Pinselgröße folgt dem **Druck** des Stifts (Grundgröße über den Regler „Größe").

## Aufbau

```
public/passages/<name>/
  foto-a.jpg          ← deine Fotos
  passage.json        ← Layout (Bildpositionen) + Pinselstriche  ← Quelle der Wahrheit
  drawing.png         ← gerenderte Zeichenebene (für die schnelle Anzeige)

editor/               ← lokaler Editor (Node-Server, keine Abhängigkeiten)
src/pages/index.astro ← öffentliche Seite (Astro, statisch)
Foto-Editor.app       ← Doppelklick-Starter
```

## Veröffentlichen (Astro)

Einmalig:
```
npm install
```
Bauen / lokal ansehen:
```
npm run build      # erzeugt dist/  (statische Seite)
npm run dev        # Astro-Dev-Server
```
Die fertige Seite in `dist/` kann zu **Netlify, Vercel oder GitHub Pages** hochgeladen werden
(Hosting ist noch offen – kann jeder statische Host sein).

## Hinweise
- Der Editor läuft nur lokal (`127.0.0.1:4455`) und kommt **nicht** auf die öffentliche Seite.
- Canvas-Auflösung intern: 2560×1440 (16:9, retina-scharf).
- Icon neu erzeugen: `python3 editor/make_icon.py` (siehe Skript).
