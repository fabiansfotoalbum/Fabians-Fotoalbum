// Öffentliche Vorschau / Seite.
// - Baut den Stapel aus der API, falls noch leer (lokaler /view-Server).
//   Auf der gebauten Astro-Seite sind die .passage-Sektionen schon da.
// - Steuert die Navigation: magnetisches Einrasten mit kleiner Hürde
//   (man muss einen Punkt überschreiten -> nächste Seite flutscht hoch;
//    hört man vorher auf -> die Seite flutscht zurück).
'use strict';
const CANVAS_W = 2560, CANVAS_H = 1440;

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
      const el = document.createElement('img');
      el.className = 'layer-img';
      el.src = `/passages/${id}/${encodeURIComponent(im.src)}`;
      el.style.cssText =
        `left:${im.x / CANVAS_W * 100}%;top:${im.y / CANVAS_H * 100}%;` +
        `width:${im.w / CANVAS_W * 100}%;height:${im.h / CANVAS_H * 100}%`;
      stage.appendChild(el);
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
  sections.forEach((s, i) => { s.style.zIndex = i + 1; });
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
    for (let i = 0; i < N; i++) {
      const ty = clamp(i - pos, 0, 1) * 100;               // 0 = oben (sichtbar), 100 = unten (wartet)
      const s = sections[i];
      s.style.transform = `translateY(${ty}%)`;
      // Schatten nur während der Bewegung, in Ruhelage keiner.
      const a = 0.55 * Math.sin(Math.PI * ty / 100);
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
