// Foto-Editor – Canvas, druckempfindlicher Pinsel, Radierer, Undo/Redo, Bilder, Speichern.
'use strict';

const CANVAS_W = 2560;
const CANVAS_H = 1440; // 16:9
const INK = '#141311'; // off-black (etwas mehr Kontrast)

const stage = document.getElementById('stage');
const imagesLayer = document.getElementById('imagesLayer');
const handlesLayer = document.getElementById('handles');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
overlay.width = CANVAS_W;
overlay.height = CANVAS_H;

const els = {
  passageSelect: document.getElementById('passageSelect'),
  newPassage: document.getElementById('newPassage'),
  brushSize: document.getElementById('brushSize'),
  brushSizeVal: document.getElementById('brushSizeVal'),
  addImage: document.getElementById('addImage'),
  fileInput: document.getElementById('fileInput'),
  toFront: document.getElementById('toFront'),
  toBack: document.getElementById('toBack'),
  deleteImg: document.getElementById('deleteImg'),
  undo: document.getElementById('undo'),
  redo: document.getElementById('redo'),
  save: document.getElementById('save'),
  status: document.getElementById('status'),
  trayItems: document.getElementById('trayItems'),
  tools: document.getElementById('tools'),
};

// ---------- Zustand ----------
let currentId = null;
let images = [];   // {src, x, y, w, h}
let strokes = [];  // {tool:'brush'|'eraser', size, points:[{x,y,p}]}
let tool = 'select';
let brushSize = Number(els.brushSize.value);
let selected = -1; // Index in images
let dirty = false;

const imgCache = new Map(); // src -> HTMLImageElement (geladen)

// ---------- Undo/Redo ----------
let undoStack = [];
let redoStack = [];
function snapshot() { return JSON.stringify({ images, strokes }); }
function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
}
function applyState(s) {
  const o = JSON.parse(s);
  images = o.images; strokes = o.strokes;
  if (selected >= images.length) selected = -1;
  clearLassoSelection(); // Strich-Indizes können sich geändert haben
  renderImages(); redrawCanvas(); renderHandles(); updateImageButtons();
  markDirty();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  applyState(undoStack.pop());
  updateHistoryButtons();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  applyState(redoStack.pop());
  updateHistoryButtons();
}
function updateHistoryButtons() {
  els.undo.disabled = !undoStack.length;
  els.redo.disabled = !redoStack.length;
}

// ---------- Statusanzeige ----------
let statusTimer = null;
function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.status.className = 'status ' + kind;
  clearTimeout(statusTimer);
  if (text) statusTimer = setTimeout(() => { els.status.textContent = ''; els.status.className = 'status'; }, 2500);
}
function markDirty() { dirty = true; }

// ---------- Werkzeugwahl ----------
function setTool(t) {
  tool = t;
  document.body.dataset.tool = t;
  for (const b of els.tools.querySelectorAll('.tool')) b.classList.toggle('active', b.dataset.tool === t);
  if (t !== 'select') selectImage(-1);
  if (t !== 'lasso') clearLassoSelection();
}
els.tools.addEventListener('click', e => {
  const b = e.target.closest('.tool');
  if (b) setTool(b.dataset.tool);
});
document.body.dataset.tool = 'select';

els.brushSize.addEventListener('input', () => {
  brushSize = Number(els.brushSize.value);
  els.brushSizeVal.textContent = brushSize;
});

// ---------- Koordinaten: Bildschirm -> Canvas-Pixel ----------
function toCanvasXY(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (clientX - r.left) / r.width * CANVAS_W,
    y: (clientY - r.top) / r.height * CANVAS_H,
  };
}

// ---------- Pinsel-Rendering ----------
const TAU = Math.PI * 2;
// deterministischer Pseudo-Zufall aus Koordinaten -> Live-Zeichnen & Neu-Rendern identisch
function hash2(x, y) {
  const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return h - Math.floor(h);
}
function radiusFor(p, size) {
  // Druck 0..1 -> Radius. Etwas Grundgröße, damit auch leichter Druck malt.
  return size * (0.22 + 0.78 * Math.max(0, Math.min(1, p))) / 2;
}
// glatte, niederfrequente Schwankung ~[-1,1] für leichtes "Wobbeln" der Strichstärke
function wobble(x, y) {
  return Math.sin(x * 0.028 + y * 0.017) * 0.6 + Math.sin(x * 0.011 - y * 0.023) * 0.4;
}

// --- Tinten-Stellschrauben -------------------------------------------------
const WOBBLE_AMOUNT = 0.05;   // Strichstärke variiert um ±5%
const SPECK_CHANCE  = 0.972;  // höher = seltener Spritzer (0.972 ≈ ~3% der Tupfer)
const SPECK_ALPHA   = 0.18;   // Deckkraft der Spritzer (schwach)
// ---------------------------------------------------------------------------

// glatter Tupfer (Radierer, Maus)
function plainDab(c, x, y, r) {
  c.beginPath();
  c.arc(x, y, Math.max(0.4, r), 0, TAU);
  c.fill();
}
// Tinten-Tupfer: solider Kern mit leichtem Wobbeln + selten ein flacher Spritzer am Strich
function inkDab(c, x, y, r, dir = 0) {
  r = Math.max(0.4, r) * (1 + WOBBLE_AMOUNT * wobble(x, y));
  // Kern (fast voll deckend, minimale Dichtevariation)
  c.globalAlpha = 0.93 + 0.07 * hash2(x * 0.7, y * 0.9);
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
  // selten ein schwacher, flacher Spritzer, der am Rand des Strichs klebt
  if (r > 1.6 && hash2(x * 0.5, y * 0.5) > SPECK_CHANCE) {
    const side = hash2(y, x) > 0.5 ? 1 : -1;             // an welcher Strichseite
    const off = r * (0.7 + 0.3 * hash2(x * 1.7, y));     // knapp am Rand
    const nx = x + Math.cos(dir + Math.PI / 2) * off * side;
    const ny = y + Math.sin(dir + Math.PI / 2) * off * side;
    const len = r * (0.45 + 0.5 * hash2(nx, ny));        // länglich, am Strich entlang
    const thick = r * (0.07 + 0.08 * hash2(ny, nx));     // flach (kaum rund)
    c.globalAlpha = SPECK_ALPHA * (0.5 + 0.5 * hash2(nx * 0.3, ny * 0.3));
    c.save();
    c.translate(nx, ny);
    c.rotate(dir);
    c.beginPath();
    c.ellipse(0, 0, len, thick, 0, 0, TAU);
    c.fill();
    c.restore();
  }
  c.globalAlpha = 1;
}
function stampSegment(c, a, b, size, ink) {
  const fn = ink ? inkDab : plainDab;
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const dir = Math.atan2(dy, dx);
  const rA = radiusFor(a.p, size), rB = radiusFor(b.p, size);
  const spacing = Math.max(1, Math.min(rA, rB) * (ink ? 0.3 : 0.4));
  const steps = Math.max(1, Math.ceil(dist / spacing));
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    fn(c, a.x + dx * t, a.y + dy * t, rA + (rB - rA) * t, dir);
  }
}
function strokeStyleFor(c, stroke) {
  c.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  c.fillStyle = INK;
}
function renderStroke(c, stroke) {
  c.save();
  strokeStyleFor(c, stroke);
  const ink = stroke.tool !== 'eraser';
  const fn = ink ? inkDab : plainDab;
  const pts = stroke.points;
  if (pts.length === 1) fn(c, pts[0].x, pts[0].y, radiusFor(pts[0].p, stroke.size));
  for (let i = 1; i < pts.length; i++) stampSegment(c, pts[i - 1], pts[i], stroke.size, ink);
  c.restore();
}
function redrawCanvas() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  for (const s of strokes) renderStroke(ctx, s);
}

// ---------- Bilder ----------
function loadImage(src) {
  if (imgCache.has(src)) return Promise.resolve(imgCache.get(src));
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => { imgCache.set(src, im); resolve(im); };
    im.onerror = reject;
    im.src = `/passages/${currentId}/${encodeURIComponent(src)}`;
  });
}
function renderImages() {
  imagesLayer.innerHTML = '';
  images.forEach((im, i) => {
    const el = document.createElement('img');
    el.src = `/passages/${currentId}/${encodeURIComponent(im.src)}`;
    el.dataset.index = i;
    el.style.left = (im.x / CANVAS_W * 100) + '%';
    el.style.top = (im.y / CANVAS_H * 100) + '%';
    el.style.width = (im.w / CANVAS_W * 100) + '%';
    el.style.height = (im.h / CANVAS_H * 100) + '%';
    imagesLayer.appendChild(el);
  });
}
function selectImage(i) {
  selected = i;
  renderHandles();
  updateImageButtons();
}
function updateImageButtons() {
  const has = selected >= 0;
  els.deleteImg.disabled = !has;
  els.toFront.disabled = !has;
  els.toBack.disabled = !has;
}
function renderHandles() {
  handlesLayer.innerHTML = '';
  if (selected < 0 || !images[selected]) return;
  const im = images[selected];
  const box = document.createElement('div');
  box.className = 'selbox';
  box.style.left = (im.x / CANVAS_W * 100) + '%';
  box.style.top = (im.y / CANVAS_H * 100) + '%';
  box.style.width = (im.w / CANVAS_W * 100) + '%';
  box.style.height = (im.h / CANVAS_H * 100) + '%';
  handlesLayer.appendChild(box);
  for (const [cls, fx, fy] of [['nw',0,0],['ne',1,0],['se',1,1],['sw',0,1]]) {
    const h = document.createElement('div');
    h.className = 'handle ' + cls;
    h.dataset.corner = cls;
    h.style.left = ((im.x + im.w * fx) / CANVAS_W * 100) + '%';
    h.style.top = ((im.y + im.h * fy) / CANVAS_H * 100) + '%';
    handlesLayer.appendChild(h);
  }
}

// Bild aus Tray auf die Mitte legen
async function placeImage(src) {
  const im = await loadImage(src);
  const maxW = CANVAS_W * 0.6, maxH = CANVAS_H * 0.6;
  let w = im.naturalWidth, h = im.naturalHeight;
  const scale = Math.min(maxW / w, maxH / h, 1);
  w *= scale; h *= scale;
  pushUndo();
  images.push({ src, x: (CANVAS_W - w) / 2, y: (CANVAS_H - h) / 2, w, h });
  renderImages();
  selectImage(images.length - 1);
  setTool('select');
  markDirty();
  refreshTrayPlaced();
}

// ---------- Tray (Fotos im Ordner) ----------
let folderImages = [];
function renderTray() {
  els.trayItems.innerHTML = '';
  folderImages.forEach(src => {
    const item = document.createElement('div');
    item.className = 'tray-item';
    item.title = src;
    const img = document.createElement('img');
    img.src = `/passages/${currentId}/${encodeURIComponent(src)}`;
    item.appendChild(img);
    item.addEventListener('click', () => placeImage(src));
    item.dataset.src = src;
    els.trayItems.appendChild(item);
  });
  refreshTrayPlaced();
}
function refreshTrayPlaced() {
  const placed = new Set(images.map(i => i.src));
  for (const item of els.trayItems.children) {
    item.classList.toggle('placed', placed.has(item.dataset.src));
  }
}

// ---------- Zeichnen (Pointer + Druck) ----------
let drawing = null; // aktueller Stroke
const hud = document.getElementById('hud');
const pressureHint = document.getElementById('pressureHint');
let penSeen = false, penMaxPressure = 0, hintShown = false;

function reportPressure(type, raw) {
  if (hud) hud.textContent = `${type} · Druck ${(raw || 0).toFixed(2)}`;
  if (type === 'pen') { penSeen = true; penMaxPressure = Math.max(penMaxPressure, raw || 0); }
}
function maybePressureHint() {
  // Stift erkannt, aber über die ganze Sitzung kein Druck -> Hinweis (meist Safari).
  if (penSeen && penMaxPressure < 0.02 && !hintShown && pressureHint) {
    pressureHint.hidden = false;
    hintShown = true;
  }
}
function pointFromEvent(e) {
  const { x, y } = toCanvasXY(e.clientX, e.clientY);
  let p = e.pressure;
  if (e.pointerType === 'pen') {
    // echter Stift: Druck verwenden (0 beim Aufsetzen ist ok -> dünn)
    if (p == null || Number.isNaN(p)) p = 0.5;
    reportPressure('pen', e.pressure);
  } else {
    // Maus / Trackpad: kein echter Druck -> mittlere Größe
    p = 0.5;
    reportPressure(e.pointerType || 'maus', e.pressure);
  }
  return { x, y, p };
}
canvas.addEventListener('pointerdown', e => {
  if (tool !== 'brush' && tool !== 'eraser') return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  pushUndo();
  drawing = { tool, size: brushSize, points: [pointFromEvent(e)] };
  // ersten Punkt sofort sichtbar
  ctx.save(); strokeStyleFor(ctx, drawing);
  const fn0 = tool === 'eraser' ? plainDab : inkDab;
  fn0(ctx, drawing.points[0].x, drawing.points[0].y, radiusFor(drawing.points[0].p, brushSize));
  ctx.restore();
});
canvas.addEventListener('pointermove', e => {
  if (!drawing) return;
  e.preventDefault();
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  ctx.save(); strokeStyleFor(ctx, drawing);
  const ink = drawing.tool !== 'eraser';
  for (const ev of (events.length ? events : [e])) {
    const pt = pointFromEvent(ev);
    const prev = drawing.points[drawing.points.length - 1];
    stampSegment(ctx, prev, pt, drawing.size, ink);
    drawing.points.push(pt);
  }
  ctx.restore();
});
function endStroke(e) {
  if (!drawing) return;
  if (drawing.points.length) strokes.push(drawing);
  drawing = null;
  markDirty();
  maybePressureHint();
}
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('pointerleave', e => { if (drawing) endStroke(e); });

// ---------- Lasso: Gemaltes auswählen / verschieben / skalieren ----------
let lasso = null;       // aktuelle Aktion {type:'draw'|'move'|'resize', ...}
let lassoSel = [];      // ausgewählte Stroke-Indizes (nur Pinsel, keine Radierer)
let selBox = null;      // Auswahl-Rechteck {x,y,w,h} in Canvas-Pixeln
const HANDLE_HIT = 16;  // Trefferradius der Eck-Anfasser (Bildschirm-px)

function screenScale() {
  return CANVAS_W / canvas.getBoundingClientRect().width; // Bildschirm-px -> Canvas-px
}
function boxCorners(b) {
  return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
}
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function selectInLasso(poly) {
  const sel = [];
  strokes.forEach((s, i) => {
    if (s.tool === 'eraser' || !s.points.length) return;
    let inside = 0;
    for (const pt of s.points) if (pointInPoly(pt.x, pt.y, poly)) inside++;
    if (inside > s.points.length * 0.5) sel.push(i); // Mehrheit der Punkte im Lasso
  });
  return sel;
}
function bboxOf(indices) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const i of indices) {
    const s = strokes[i], r = s.size / 2;
    for (const pt of s.points) {
      minX = Math.min(minX, pt.x - r); minY = Math.min(minY, pt.y - r);
      maxX = Math.max(maxX, pt.x + r); maxY = Math.max(maxY, pt.y + r);
    }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
function renderOverlay() {
  octx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  const sc = screenScale();
  octx.strokeStyle = '#4f8cff';
  octx.lineWidth = 1.5 * sc;
  if (lasso && lasso.type === 'draw' && lasso.points.length > 1) {
    octx.setLineDash([8 * sc, 6 * sc]);
    octx.beginPath();
    octx.moveTo(lasso.points[0].x, lasso.points[0].y);
    for (const p of lasso.points) octx.lineTo(p.x, p.y);
    octx.stroke();
    octx.setLineDash([]);
  }
  if (selBox) {
    octx.setLineDash([8 * sc, 6 * sc]);
    octx.strokeRect(selBox.x, selBox.y, selBox.w, selBox.h);
    octx.setLineDash([]);
    const hs = 10 * sc;
    octx.fillStyle = '#fff';
    for (const c of boxCorners(selBox)) {
      octx.beginPath(); octx.rect(c.x - hs / 2, c.y - hs / 2, hs, hs); octx.fill(); octx.stroke();
    }
  }
}
function clearLassoSelection() {
  lasso = null; lassoSel = []; selBox = null;
  renderOverlay();
}
function clonePoints(i) { return strokes[i].points.map(q => ({ ...q })); }

canvas.addEventListener('pointerdown', e => {
  if (tool !== 'lasso') return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  const p = toCanvasXY(e.clientX, e.clientY);
  const hit = HANDLE_HIT * screenScale();
  if (selBox && lassoSel.length) {
    const cs = boxCorners(selBox);
    let ci = -1;
    for (let i = 0; i < 4; i++) if (Math.hypot(cs[i].x - p.x, cs[i].y - p.y) < hit) { ci = i; break; }
    if (ci >= 0) { // Skalieren von der gegenüberliegenden Ecke aus
      pushUndo();
      const anchor = cs[(ci + 2) % 4];
      lasso = {
        type: 'resize', anchor,
        d0: Math.hypot(cs[ci].x - anchor.x, cs[ci].y - anchor.y) || 1,
        orig: lassoSel.map(clonePoints), origSizes: lassoSel.map(i => strokes[i].size),
      };
      return;
    }
    if (p.x >= selBox.x && p.x <= selBox.x + selBox.w && p.y >= selBox.y && p.y <= selBox.y + selBox.h) {
      pushUndo();
      lasso = { type: 'move', start: p, orig: lassoSel.map(clonePoints), origBox: { ...selBox } };
      return;
    }
  }
  clearLassoSelection();
  lasso = { type: 'draw', points: [p] };
  renderOverlay();
});
canvas.addEventListener('pointermove', e => {
  if (!lasso) return;
  e.preventDefault();
  const p = toCanvasXY(e.clientX, e.clientY);
  if (lasso.type === 'draw') {
    lasso.points.push(p);
    renderOverlay();
  } else if (lasso.type === 'move') {
    const dx = p.x - lasso.start.x, dy = p.y - lasso.start.y;
    lassoSel.forEach((idx, k) => {
      strokes[idx].points = lasso.orig[k].map(q => ({ x: q.x + dx, y: q.y + dy, p: q.p }));
    });
    selBox = { x: lasso.origBox.x + dx, y: lasso.origBox.y + dy, w: lasso.origBox.w, h: lasso.origBox.h };
    redrawCanvas(); renderOverlay(); markDirty();
  } else if (lasso.type === 'resize') {
    const a = lasso.anchor;
    const s = Math.max(0.05, Math.hypot(p.x - a.x, p.y - a.y) / lasso.d0);
    lassoSel.forEach((idx, k) => {
      strokes[idx].points = lasso.orig[k].map(q => ({ x: a.x + (q.x - a.x) * s, y: a.y + (q.y - a.y) * s, p: q.p }));
      strokes[idx].size = Math.max(1, lasso.origSizes[k] * s);
    });
    selBox = bboxOf(lassoSel);
    redrawCanvas(); renderOverlay(); markDirty();
  }
});
function endLasso() {
  if (!lasso) return;
  if (lasso.type === 'draw') {
    if (lasso.points.length > 2) {
      lassoSel = selectInLasso(lasso.points);
      selBox = lassoSel.length ? bboxOf(lassoSel) : null;
    }
  }
  lasso = null;
  renderOverlay();
}
canvas.addEventListener('pointerup', endLasso);
canvas.addEventListener('pointercancel', endLasso);

// ---------- Bild bewegen / skalieren ----------
let drag = null;
imagesLayer.addEventListener('pointerdown', e => {
  if (tool !== 'select') return;
  const el = e.target.closest('img');
  if (!el) return;
  e.preventDefault();
  const i = Number(el.dataset.index);
  selectImage(i);
  pushUndo();
  const start = toCanvasXY(e.clientX, e.clientY);
  drag = { mode: 'move', i, startX: start.x, startY: start.y, orig: { ...images[i] } };
  imagesLayer.setPointerCapture(e.pointerId);
});
handlesLayer.addEventListener('pointerdown', e => {
  const h = e.target.closest('.handle');
  if (!h || selected < 0) return;
  e.preventDefault();
  pushUndo();
  const start = toCanvasXY(e.clientX, e.clientY);
  drag = { mode: 'resize', corner: h.dataset.corner, i: selected, startX: start.x, startY: start.y, orig: { ...images[selected] } };
  handlesLayer.setPointerCapture(e.pointerId);
});
function onDragMove(e) {
  if (!drag) return;
  const p = toCanvasXY(e.clientX, e.clientY);
  const dx = p.x - drag.startX, dy = p.y - drag.startY;
  const o = drag.orig;
  const im = images[drag.i];
  if (drag.mode === 'move') {
    im.x = o.x + dx; im.y = o.y + dy;
  } else {
    const ar = o.w / o.h;
    const fixed = { // gegenüberliegende Ecke bleibt fest
      nw: { x: o.x + o.w, y: o.y + o.h }, ne: { x: o.x, y: o.y + o.h },
      se: { x: o.x, y: o.y }, sw: { x: o.x + o.w, y: o.y },
    }[drag.corner];
    let nx = o.x + (drag.corner.includes('w') ? dx : 0);
    let ny = o.y + (drag.corner.includes('n') ? dy : 0);
    let nw = o.w + (drag.corner.includes('e') ? dx : -dx);
    let nh = o.h + (drag.corner.includes('s') ? dy : -dy);
    // Seitenverhältnis halten (anhand Breite), Mindestgröße
    nw = Math.max(20, nw);
    nh = nw / ar;
    // neu relativ zur festen Ecke positionieren
    im.w = nw; im.h = nh;
    im.x = drag.corner.includes('w') ? fixed.x - nw : fixed.x;
    im.y = drag.corner.includes('n') ? fixed.y - nh : fixed.y;
  }
  renderImages(); renderHandles();
}
window.addEventListener('pointermove', onDragMove);
window.addEventListener('pointerup', () => { if (drag) { drag = null; markDirty(); } });

// Klick ins Leere -> Auswahl aufheben
canvas.addEventListener('pointerdown', e => { if (tool === 'select') selectImage(-1); });

// ---------- Buttons: Bild-Reihenfolge / löschen ----------
els.deleteImg.addEventListener('click', () => {
  if (selected < 0) return;
  pushUndo();
  images.splice(selected, 1);
  selectImage(-1);
  renderImages(); refreshTrayPlaced(); markDirty();
});
els.toFront.addEventListener('click', () => {
  if (selected < 0) return;
  pushUndo();
  const [it] = images.splice(selected, 1);
  images.push(it); selectImage(images.length - 1);
  renderImages(); markDirty();
});
els.toBack.addEventListener('click', () => {
  if (selected < 0) return;
  pushUndo();
  const [it] = images.splice(selected, 1);
  images.unshift(it); selectImage(0);
  renderImages(); markDirty();
});

// ---------- Foto hinzufügen (Upload in Ordner) ----------
els.addImage.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', async () => {
  const files = [...els.fileInput.files];
  els.fileInput.value = '';
  for (const f of files) {
    const buf = await f.arrayBuffer();
    const res = await fetch(`/api/image?id=${encodeURIComponent(currentId)}&name=${encodeURIComponent(f.name)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf,
    });
    const j = await res.json();
    if (j.name) {
      folderImages.push(j.name);
      imgCache.delete(j.name);
      renderTray();
      await placeImage(j.name);
    }
  }
  setStatus('Foto hinzugefügt', 'ok');
});

// ---------- Speichern ----------
function canvasToBlob() {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
async function save() {
  if (!currentId) return;
  setStatus('Speichern…');
  redrawCanvas(); // sicherstellen, dass der Export sauber ist
  const meta = { id: currentId, width: CANVAS_W, height: CANVAS_H, images, strokes, updated: Date.now() };
  await fetch(`/api/passage?id=${encodeURIComponent(currentId)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta),
  });
  const blob = await canvasToBlob();
  await fetch(`/api/drawing?id=${encodeURIComponent(currentId)}`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob,
  });
  dirty = false;
  setStatus('Gespeichert ✓', 'ok');
  refreshSidebar();
}
els.save.addEventListener('click', save);
els.undo.addEventListener('click', undo);
els.redo.addEventListener('click', redo);
document.getElementById('hintClose')?.addEventListener('click', () => { pressureHint.hidden = true; });

// ---------- Passagen laden / wechseln / neu ----------
async function loadPassageList(selectId) {
  const j = await (await fetch('/api/passages')).json();
  els.passageSelect.innerHTML = '';
  for (const id of j.passages) {
    const o = document.createElement('option');
    o.value = id; o.textContent = id;
    els.passageSelect.appendChild(o);
  }
  if (selectId && j.passages.includes(selectId)) els.passageSelect.value = selectId;
  return j.passages;
}
async function openPassage(id) {
  if (dirty && !confirm('Ungespeicherte Änderungen verwerfen?')) {
    els.passageSelect.value = currentId; return;
  }
  currentId = id;
  imgCache.clear();
  const data = await (await fetch(`/api/passage?id=${encodeURIComponent(id)}`)).json();
  folderImages = data.images || [];
  if (data.meta) {
    images = data.meta.images || [];
    strokes = data.meta.strokes || [];
  } else {
    // Neue Passage: alle vorhandenen Fotos automatisch grob platzieren
    images = [];
    strokes = [];
  }
  undoStack = []; redoStack = []; updateHistoryButtons();
  selected = -1;
  // Bilder vorladen, dann zeichnen
  await Promise.all((folderImages).map(s => loadImage(s).catch(() => {})));
  if (!data.meta && folderImages.length) {
    // einfache automatische Platzierung beim ersten Öffnen
    await placeImage(folderImages[0]);
    undoStack = []; redoStack = []; updateHistoryButtons();
    dirty = false;
  }
  clearLassoSelection();
  renderImages(); redrawCanvas(); renderHandles(); renderTray(); updateImageButtons();
  els.passageSelect.value = id;
  document.getElementById('previewLink').href = `/view#${encodeURIComponent(id)}`;
  markSidebarActive();
}
els.passageSelect.addEventListener('change', () => openPassage(els.passageSelect.value));

// Neue Passage anlegen (optional davor/danach einer anderen)
async function createPassage(opts = {}) {
  const name = prompt('Name der neuen Passage (z. B. 02-strasse):');
  if (!name) return;
  const res = await fetch('/api/passages', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: name, before: opts.before, after: opts.after }),
  });
  const j = await res.json();
  if (j.id) {
    await loadPassageList(j.id); await refreshSidebar(); await openPassage(j.id);
    setStatus('Passage angelegt', 'ok');
  } else setStatus(j.error || 'Fehler', 'err');
}
els.newPassage.addEventListener('click', () => createPassage());
document.getElementById('addPassageSide').addEventListener('click', () => createPassage());

// Passage löschen
async function deletePassage(id) {
  if (!confirm(`Passage „${id}" wirklich löschen? Das entfernt den gesamten Ordner inkl. Fotos.`)) return;
  await fetch(`/api/passage?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  const list = await loadPassageList();
  if (id === currentId) {
    dirty = false;
    if (list.length) await openPassage(list[0]);
    else { currentId = null; images = []; strokes = []; renderImages(); redrawCanvas(); renderTray(); }
  }
  await refreshSidebar();
  setStatus('Passage gelöscht', 'ok');
}

// ---------- Passagen-Leiste (Vorschauen) ----------
const passageListEl = document.getElementById('passageList');
let sidebarData = [];
let justDragged = false;

// Element, vor dem beim Ziehen eingefügt werden soll (anhand Mausposition)
function dragAfter(y) {
  const items = [...passageListEl.querySelectorAll('.passage-item:not(.dragging)')];
  let best = { offset: -Infinity, el: null };
  for (const el of items) {
    const box = el.getBoundingClientRect();
    const offset = y - (box.top + box.height / 2);
    if (offset < 0 && offset > best.offset) best = { offset, el };
  }
  return best.el;
}
async function persistOrder() {
  const order = [...passageListEl.querySelectorAll('.passage-item')].map(el => el.dataset.id);
  await fetch('/api/order', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }),
  });
}
passageListEl.addEventListener('dragover', e => {
  e.preventDefault();
  const dragging = passageListEl.querySelector('.dragging');
  if (!dragging) return;
  const after = dragAfter(e.clientY);
  if (after == null) passageListEl.appendChild(dragging);
  else passageListEl.insertBefore(dragging, after);
});

function buildMini(p) {
  const mini = document.createElement('div');
  mini.className = 'mini';
  for (const im of ((p.meta && p.meta.images) || [])) {
    const el = document.createElement('img');
    el.src = `/passages/${p.id}/${encodeURIComponent(im.src)}`;
    el.style.cssText =
      `left:${im.x / CANVAS_W * 100}%;top:${im.y / CANVAS_H * 100}%;` +
      `width:${im.w / CANVAS_W * 100}%;height:${im.h / CANVAS_H * 100}%`;
    mini.appendChild(el);
  }
  if (p.hasDrawing) {
    const d = document.createElement('img');
    d.className = 'mini-draw';
    d.src = `/passages/${p.id}/drawing.png?v=${(p.meta && p.meta.updated) || ''}`;
    mini.appendChild(d);
  }
  return mini;
}
function renderSidebar() {
  passageListEl.innerHTML = '';
  for (const p of sidebarData) {
    const item = document.createElement('div');
    item.className = 'passage-item' + (p.id === currentId ? ' active' : '');
    item.dataset.id = p.id;
    item.draggable = true;
    item.appendChild(buildMini(p));
    const name = document.createElement('div');
    name.className = 'name'; name.textContent = p.id;
    item.appendChild(name);
    item.addEventListener('click', () => { if (!justDragged) openPassage(p.id); });
    item.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e.clientX, e.clientY, p.id); });
    item.addEventListener('dragstart', () => { justDragged = true; item.classList.add('dragging'); });
    item.addEventListener('dragend', async () => {
      item.classList.remove('dragging');
      await persistOrder();
      await refreshSidebar();
      setStatus('Reihenfolge gespeichert', 'ok');
      setTimeout(() => { justDragged = false; }, 60);
    });
    passageListEl.appendChild(item);
  }
}
function markSidebarActive() {
  for (const el of passageListEl.children) el.classList.toggle('active', el.dataset.id === currentId);
}
async function refreshSidebar() {
  sidebarData = (await (await fetch('/api/all')).json()).passages || [];
  renderSidebar();
}

// ---------- Kontextmenü ----------
const ctxmenu = document.getElementById('ctxmenu');
function hideCtxMenu() { ctxmenu.hidden = true; ctxmenu.innerHTML = ''; }
function showCtxMenu(x, y, id) {
  ctxmenu.innerHTML = '';
  const add = (label, fn, danger) => {
    const b = document.createElement('button');
    b.textContent = label; if (danger) b.className = 'danger';
    b.addEventListener('click', () => { hideCtxMenu(); fn(); });
    ctxmenu.appendChild(b);
  };
  add('Neue Passage davor', () => createPassage({ before: id }));
  add('Neue Passage danach', () => createPassage({ after: id }));
  const div = document.createElement('div'); div.className = 'divider'; ctxmenu.appendChild(div);
  add('Passage löschen', () => deletePassage(id), true);
  ctxmenu.hidden = false;
  // in den Viewport rücken
  const w = 200, h = ctxmenu.offsetHeight || 120;
  ctxmenu.style.left = Math.min(x, innerWidth - w - 8) + 'px';
  ctxmenu.style.top = Math.min(y, innerHeight - h - 8) + 'px';
}
window.addEventListener('click', hideCtxMenu);
window.addEventListener('scroll', hideCtxMenu, true);

// ---------- Tastenkürzel ----------
window.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === 'v') setTool('select');
  if (e.key === 'b') setTool('brush');
  if (e.key === 'e') setTool('eraser');
  if (e.key === 'l') setTool('lasso');
  if (e.key === 'Escape' && lassoSel.length) { clearLassoSelection(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (tool === 'lasso' && lassoSel.length) {
      e.preventDefault(); pushUndo();
      for (const i of [...lassoSel].sort((a, b) => b - a)) strokes.splice(i, 1);
      clearLassoSelection(); redrawCanvas(); markDirty();
    } else if (selected >= 0) {
      e.preventDefault(); els.deleteImg.click();
    }
  }
});
window.addEventListener('beforeunload', e => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- Start ----------
(async function init() {
  let list = await loadPassageList();
  if (!list.length) {
    // erste Passage automatisch anlegen
    await fetch('/api/passages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: '01-start' }) });
    list = await loadPassageList('01-start');
  }
  await openPassage(els.passageSelect.value || list[0]);
  await refreshSidebar();
})();
