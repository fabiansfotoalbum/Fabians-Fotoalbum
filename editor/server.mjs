// Lokaler Editor-Server für die Fotowebsite.
// Pure Node (keine npm-Abhängigkeiten) -> läuft sofort per Doppelklick auf Foto-Editor.app.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const pexec = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');         // von Astro & Viewer genutzt
const PASSAGES_DIR = path.join(PUBLIC_DIR, 'passages'); // ein Ordner pro Passage
const EDITOR_PUBLIC = path.join(__dirname, 'public');   // Editor-Oberfläche

const PORT = process.env.EDITOR_PORT ? Number(process.env.EDITOR_PORT) : 4455;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function safeId(id) {
  return String(id || '').toLowerCase().trim()
    .replace(/[^a-z0-9\-_ ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}
function safeName(name) {
  const ext = path.extname(name || '').toLowerCase();
  const base = path.basename(name || '', ext).replace(/[^a-z0-9\-_]/gi, '_').slice(0, 60) || 'bild';
  return base + (IMG_EXT.has(ext) ? ext : '.png');
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');
}

async function serveFile(res, filePath) {
  try {
    const data = await fs.readFile(filePath);
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    send(res, 404, 'Not found');
  }
}

// Pfad sicher innerhalb base auflösen (kein Path-Traversal)
function within(base, ...parts) {
  const p = path.resolve(base, ...parts);
  if (p !== base && !p.startsWith(base + path.sep)) return null;
  return p;
}

const ORDER_FILE = path.join(PASSAGES_DIR, '_order.json');

async function readOrder() {
  try { return JSON.parse(await fs.readFile(ORDER_FILE, 'utf8')); }
  catch { return []; }
}
async function writeOrder(arr) {
  await fs.mkdir(PASSAGES_DIR, { recursive: true });
  await fs.writeFile(ORDER_FILE, JSON.stringify(arr, null, 2), 'utf8');
}

// Reihenfolge = _order.json, ergänzt um neue Ordner, bereinigt um gelöschte.
async function listPassages() {
  await fs.mkdir(PASSAGES_DIR, { recursive: true });
  const entries = await fs.readdir(PASSAGES_DIR, { withFileTypes: true });
  const present = entries.filter(e => e.isDirectory()).map(e => e.name);
  const presentSet = new Set(present);
  const order = await readOrder();
  const result = order.filter(id => presentSet.has(id));
  for (const id of present.sort()) if (!result.includes(id)) result.push(id);
  // Selbstheilung, falls sich etwas geändert hat
  if (result.length !== order.length || result.some((id, i) => id !== order[i])) {
    await writeOrder(result);
  }
  return result;
}

async function listImages(id) {
  const dir = within(PASSAGES_DIR, id);
  if (!dir) return [];
  try {
    const files = await fs.readdir(dir);
    return files
      .filter(f => IMG_EXT.has(path.extname(f).toLowerCase()) && f.toLowerCase() !== 'drawing.png')
      .sort();
  } catch {
    return [];
  }
}

// Git im Projektordner ausführen. GIT_TERMINAL_PROMPT=0 -> kein Hängen, falls
// Zugangsdaten fehlen (dann klarer Fehler statt blockierendem Passwort-Prompt).
function git(args) {
  return pexec('git', args, {
    cwd: ROOT,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

async function readPassage(id) {
  const dir = within(PASSAGES_DIR, id);
  if (!dir) return null;
  let meta = null;
  try {
    meta = JSON.parse(await fs.readFile(path.join(dir, 'passage.json'), 'utf8'));
  } catch { meta = null; }
  const images = await listImages(id);
  return { id, meta, images };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = decodeURIComponent(url.pathname);
    const method = req.method || 'GET';

    if (pathname === '/health') return send(res, 200, 'ok');

    // ---- API ----
    if (pathname === '/api/passages' && method === 'GET') {
      return sendJson(res, 200, { passages: await listPassages() });
    }
    if (pathname === '/api/passages' && method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const id = safeId(body.id);
      if (!id) return sendJson(res, 400, { error: 'Ungültiger Name' });
      const dir = within(PASSAGES_DIR, id);
      if (!dir) return sendJson(res, 400, { error: 'Ungültiger Name' });
      try { await fs.access(dir); return sendJson(res, 400, { error: 'Name existiert bereits' }); } catch {}
      await fs.mkdir(dir, { recursive: true });
      // in Reihenfolge einsortieren (davor/danach), sonst ans Ende
      const order = (await listPassages()).filter(x => x !== id);
      const ref = safeId(body.before || body.after || '');
      let idx = order.indexOf(ref);
      if (ref && idx >= 0) order.splice(body.before ? idx : idx + 1, 0, id);
      else order.push(id);
      await writeOrder(order);
      return sendJson(res, 200, { ok: true, id });
    }
    if (pathname === '/api/passage' && method === 'GET') {
      const id = safeId(url.searchParams.get('id'));
      const data = await readPassage(id);
      if (!data) return sendJson(res, 404, { error: 'Nicht gefunden' });
      return sendJson(res, 200, data);
    }
    if (pathname === '/api/passage' && method === 'DELETE') {
      const id = safeId(url.searchParams.get('id'));
      const dir = within(PASSAGES_DIR, id);
      if (!dir || dir === PASSAGES_DIR) return sendJson(res, 400, { error: 'Ungültige Passage' });
      await fs.rm(dir, { recursive: true, force: true });
      await writeOrder((await readOrder()).filter(x => x !== id));
      return sendJson(res, 200, { ok: true });
    }
    // Reihenfolge der Passagen setzen (Drag & Drop in der Leiste)
    if (pathname === '/api/order' && method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const present = new Set(await listPassages());
      const order = (body.order || []).map(safeId).filter(id => present.has(id));
      for (const id of present) if (!order.includes(id)) order.push(id);
      await writeOrder(order);
      return sendJson(res, 200, { ok: true });
    }
    // Veröffentlichen: alles committen und zu GitHub pushen (Action deployed dann)
    if (pathname === '/api/publish' && method === 'POST') {
      try {
        // Remote vorhanden?
        try { await git(['remote', 'get-url', 'origin']); }
        catch { return sendJson(res, 200, { ok: false, error: 'Kein GitHub-Repo verbunden (origin fehlt). Bitte erst einmal verbinden & pushen.' }); }
        await git(['add', '-A']);
        let changed = true;
        try { await git(['diff', '--cached', '--quiet']); changed = false; } catch { changed = true; }
        if (changed) await git(['commit', '-m', 'Update ' + new Date().toISOString()]);
        const { stdout, stderr } = await git(['push']);
        const out = (stdout + '\n' + stderr).trim();
        const upToDate = /up-to-date/i.test(out);
        return sendJson(res, 200, {
          ok: true,
          message: changed ? 'Veröffentlicht – Seite baut neu' : (upToDate ? 'Bereits aktuell' : 'Ausstehende Änderungen gepusht'),
        });
      } catch (err) {
        const msg = String((err && (err.stderr || err.message)) || err);
        return sendJson(res, 200, { ok: false, error: msg.slice(0, 400) });
      }
    }
    // Alle Passagen inkl. Layout (für die Vorschau-Leiste)
    if (pathname === '/api/all' && method === 'GET') {
      const ids = await listPassages();
      const all = [];
      for (const id of ids) {
        const d = await readPassage(id);
        let hasDrawing = false;
        try { await fs.access(path.join(PASSAGES_DIR, id, 'drawing.png')); hasDrawing = true; } catch {}
        all.push({ ...d, hasDrawing });
      }
      return sendJson(res, 200, { passages: all });
    }
    if (pathname === '/api/passage' && method === 'POST') {
      const id = safeId(url.searchParams.get('id'));
      const dir = within(PASSAGES_DIR, id);
      if (!dir) return sendJson(res, 400, { error: 'Ungültige Passage' });
      await fs.mkdir(dir, { recursive: true });
      const body = (await readBody(req)).toString('utf8');
      JSON.parse(body); // validieren
      await fs.writeFile(path.join(dir, 'passage.json'), body, 'utf8');
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/drawing' && method === 'POST') {
      const id = safeId(url.searchParams.get('id'));
      const dir = within(PASSAGES_DIR, id);
      if (!dir) return sendJson(res, 400, { error: 'Ungültige Passage' });
      await fs.mkdir(dir, { recursive: true });
      const buf = await readBody(req);
      await fs.writeFile(path.join(dir, 'drawing.png'), buf);
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/image' && method === 'POST') {
      const id = safeId(url.searchParams.get('id'));
      const dir = within(PASSAGES_DIR, id);
      if (!dir) return sendJson(res, 400, { error: 'Ungültige Passage' });
      await fs.mkdir(dir, { recursive: true });
      let name = safeName(url.searchParams.get('name') || 'bild.png');
      // Kollisionen vermeiden
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      let final = name, n = 1;
      while (true) {
        try { await fs.access(path.join(dir, final)); final = `${base}-${n++}${ext}`; }
        catch { break; }
      }
      const buf = await readBody(req);
      await fs.writeFile(path.join(dir, final), buf);
      return sendJson(res, 200, { ok: true, name: final });
    }

    // ---- statische Editor-Oberfläche ----
    if (pathname === '/' || pathname === '/index.html') {
      return serveFile(res, path.join(EDITOR_PUBLIC, 'index.html'));
    }
    if (pathname === '/view' || pathname === '/view.html') {
      return serveFile(res, path.join(EDITOR_PUBLIC, 'view.html'));
    }
    if (pathname === '/editor.js' || pathname === '/editor.css') {
      return serveFile(res, path.join(EDITOR_PUBLIC, pathname.slice(1)));
    }
    // gemeinsame Viewer-Assets aus public/
    if (pathname === '/viewer.js' || pathname === '/viewer.css') {
      return serveFile(res, path.join(PUBLIC_DIR, pathname.slice(1)));
    }
    // Passagen-Dateien (Bilder, drawing.png, passage.json)
    if (pathname.startsWith('/passages/')) {
      const rel = pathname.replace(/^\/passages\//, '');
      const fp = within(PASSAGES_DIR, rel);
      if (!fp) return send(res, 403, 'Forbidden');
      return serveFile(res, fp);
    }

    return send(res, 404, 'Not found');
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: String(err && err.message || err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Foto-Editor läuft:  http://127.0.0.1:${PORT}/`);
  console.log(`Vorschau (Stapel):  http://127.0.0.1:${PORT}/view`);
});
