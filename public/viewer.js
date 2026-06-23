// Öffentliche Vorschau / Seite.
// - Baut den Stapel aus der API, falls noch leer (lokaler /view-Server).
//   Auf der gebauten Astro-Seite sind die .passage-Sektionen schon da.
// - Steuert die Navigation: magnetisches Einrasten mit kleiner Hürde
//   (man muss einen Punkt überschreiten -> nächste Seite flutscht hoch;
//    hört man vorher auf -> die Seite flutscht zurück).
'use strict';
const CANVAS_W = 2560, CANVAS_H = 1440;

// clip-path (inset), das ein Bild exakt auf den Canvas beschränkt – nur für
// Bilder mit `clip:true` (Option „kein Überlauf"). Werte in % der Bildkante.
function clipInset(im) {
  const t = Math.max(0, -im.y) / im.h * 100;
  const r = Math.max(0, (im.x + im.w) - CANVAS_W) / im.w * 100;
  const b = Math.max(0, (im.y + im.h) - CANVAS_H) / im.h * 100;
  const l = Math.max(0, -im.x) / im.w * 100;
  return `inset(${t}% ${r}% ${b}% ${l}%)`;
}
// Innen-Bild-Style für den Beschnitt (crop: Bruchteile des Originals).
function cropInnerStyle(im) {
  const c = im.crop;
  if (!c) return 'width:100%;height:100%;left:0;top:0';
  return `width:${100 / c.w}%;height:${100 / c.h}%;left:${-c.x / c.w * 100}%;top:${-c.y / c.h * 100}%`;
}

async function buildFromApi(root) {
  const list = (await (await fetch('/api/passages')).json()).passages;
  if (!list.length) { document.body.innerHTML = '<div class="empty">Noch keine Passagen.</div>'; return []; }
  let z = 1;
  for (const id of list) {
    const data = await (await fetch(`/api/passage?id=${encodeURIComponent(id)}`)).json();
    const sec = document.createElement('section');
    sec.className = 'passage';
    sec.id = id;
    sec.style.zIndex = z++;
    const stage = document.createElement('div');
    stage.className = 'stage';
    for (const im of ((data.meta && data.meta.images) || [])) {
      const wrap = document.createElement('div');
      wrap.className = 'layer-img';
      wrap.style.cssText =
        `left:${im.x / CANVAS_W * 100}%;top:${im.y / CANVAS_H * 100}%;` +
        `width:${im.w / CANVAS_W * 100}%;height:${im.h / CANVAS_H * 100}%`;
      if (im.clip) wrap.style.clipPath = clipInset(im);
      const el = document.createElement('img');
      el.src = `/passages/${id}/${encodeURIComponent(im.src)}`;
      el.style.cssText = cropInnerStyle(im);
      wrap.appendChild(el);
      stage.appendChild(wrap);
    }
    const d = document.createElement('img');
    d.className = 'drawing';
    d.src = `/passages/${id}/drawing.png?v=${(data.meta && data.meta.updated) || ''}`;
    d.onerror = () => d.remove();
    stage.appendChild(d);
    sec.appendChild(stage);
    root.appendChild(sec);
  }
  return [...root.querySelectorAll('.passage')];
}

function setupPager(sections) {
  const N = sections.length;
  // z-Reihenfolge + EINMALIG einen statischen clip-path setzen: er deckelt den
  // Überlauf jeder Seite auf max. eine Seitenhöhe in jede Richtung (Sicherheits-
  // Deckel), wird aber nie umgeschaltet oder animiert. Der CSS-Default inset(0%)
  // verhindert nur den Flash der noch gestapelten Seiten vor dem ersten render().
  sections.forEach((s, i) => { s.style.zIndex = i + 1; s.style.clipPath = 'inset(-100% -100% -100% -100%)'; });
  if (N <= 1) { if (sections[0]) sections[0].style.transform = 'translateY(0)'; return; }

  // --- Scroll-Gefühl (fullPage.js / GSAP-ScrollSmoother-Stil) ---------------
  // Eingaben sammeln sich zu einer "Absicht". Die Seite folgt sanft gefedert
  // und lugt ein Stück hervor (Magnet/Widerstand). Erst wenn die Absicht die
  // Hürde überschreitet, wechselt sie ganz; danach kurze Sperre gegen
  // Trägheits-Doppelsprünge. Hört man vorher auf, federt sie zurück.
  const HURDLE = 150;     // Scrollweg (px) bis zum Seitenwechsel ("Hürde")
  const PEEK   = 0.16;    // wie weit die nächste Seite vor dem Wechsel hervorlugt
  const EASE   = 0.16;    // Glättung der Bewegung ("flutsch")
  const LOCK   = 420;     // ms Sperre nach einem Wechsel
  const IDLE   = 110;     // ms ohne Eingabe -> Vorschau federt zurück
  // -------------------------------------------------------------------------
  // Kein Umschalt-/Animationssystem mehr für den Überlauf: über den Canvas
  // gezogene Fotos sind starr Teil ihrer Seite und bewegen sich allein über
  // deren translateY (s. render() – wartende Seiten staffeln sich nach unten).
  // Der statische clip-path (setupPager) deckelt nur auf max. eine Seitenhöhe.

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let pos = 0;            // gerenderte Position (stufenlos)
  let target = 0;         // Zielseite (Ganzzahl)
  let intent = 0;         // aufgelaufener Scrollweg in Richtung nächste/vorherige
  let lockUntil = 0;      // Zeitpunkt, bis zu dem Eingaben geschluckt werden
  let raf = 0;
  let idleTimer = 0;

  const hint = document.querySelector('.scroll-hint');
  function hideHint() { if (hint) { hint.style.opacity = '0'; setTimeout(() => hint.remove(), 400); } }

  function render() {
    // Wartende Seiten staffeln sich nach UNTEN (100 %, 200 %, 300 % …) statt
    // alle auf 100 % zu stapeln. Dadurch ragt von Natur aus nur der Überlauf
    // der direkt nächsten Seite in den Blick – alle weiteren liegen weit genug
    // unter der Kante. Der über den Canvas gezogene Überlauf ist so STARR Teil
    // seiner Seite und bewegt sich zu 100 % mit deren translateY mit; kein
    // Umschalten, kein Ein-/Ausblenden (der statische clip-path aus setupPager
    // deckelt nur sicherheitshalber auf max. eine Seitenhöhe).
    for (let i = 0; i < N; i++) {
      const ty = Math.max(0, i - pos) * 100;               // 0 = sichtbar/oben, >0 = nach unten gestaffelt
      const s = sections[i];
      s.style.transform = `translateY(${ty}%)`;
      // Schatten nur an der einen Seite, die gerade hochschiebt (0..1).
      const a = (ty > 0 && ty < 100) ? 0.55 * Math.sin(Math.PI * ty / 100) : 0;
      s.style.boxShadow = a > 0.01 ? `0 -24px 60px rgba(0,0,0,${a.toFixed(3)})` : 'none';
    }
  }
  function frame() {
    const peek = clamp(intent / HURDLE, -1, 1) * PEEK;
    const desired = clamp(target + peek, 0, N - 1);
    pos += (desired - pos) * EASE;
    if (Math.abs(desired - pos) < 0.0005) pos = desired;
    render();
    raf = (Math.abs(desired - pos) > 0.0005 || intent !== 0) ? requestAnimationFrame(frame) : 0;
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  function go(dir) {
    target = clamp(target + dir, 0, N - 1);
    intent = 0;
    lockUntil = performance.now() + LOCK;
    hideHint();
    kick();
  }
  function settle() { intent = 0; kick(); }                 // Vorschau zurückfedern

  function input(delta) {
    if (performance.now() < lockUntil) { kick(); return; } // während Sperre schlucken
    intent = clamp(intent + delta, -HURDLE * 1.4, HURDLE * 1.4);
    if (intent >= HURDLE && target < N - 1) go(1);
    else if (intent <= -HURDLE && target > 0) go(-1);
    else { clearTimeout(idleTimer); idleTimer = setTimeout(settle, IDLE); hideHint(); kick(); }
  }

  // Mausrad / Trackpad (deltaMode normalisieren)
  addEventListener('wheel', e => {
    e.preventDefault();
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 30;        // Zeilen -> px
    else if (e.deltaMode === 2) d *= innerHeight;
    input(d);
  }, { passive: false });

  // Touch
  let touchY = null;
  addEventListener('touchstart', e => { touchY = e.touches[0].clientY; }, { passive: true });
  addEventListener('touchmove', e => {
    if (touchY == null) return;
    const y = e.touches[0].clientY;
    input((touchY - y) * 1.5);             // hoch wischen = vorwärts
    touchY = y;
    e.preventDefault();
  }, { passive: false });
  addEventListener('touchend', () => { touchY = null; clearTimeout(idleTimer); settle(); });

  // Tastatur
  addEventListener('keydown', e => {
    if (['ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); if (performance.now() >= lockUntil) go(1); }
    if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); if (performance.now() >= lockUntil) go(-1); }
  });

  addEventListener('resize', render);

  // Sprung zu Passage per #id (z. B. aus dem Editor)
  if (location.hash) {
    const idx = sections.findIndex(s => '#' + s.id === location.hash);
    if (idx > 0) { target = idx; pos = idx; }
  }
  render();
}

(async function () {
  const root = document.querySelector('.stack') || document.body;
  let sections = [...document.querySelectorAll('.passage')];
  if (!sections.length) sections = await buildFromApi(root);
  if (sections.length) setupPager(sections);
})();
