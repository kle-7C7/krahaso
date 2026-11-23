// Self-hosted mode: serves the website and re-scrapes the stores on a timer.
//   npm start                       -> http://localhost:3000, scrapes every 3 hours
//   PORT=8080 SCRAPE_EVERY_HOURS=1 npm start
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const EVERY_H = Number(process.env.SCRAPE_EVERY_HOURS || 3);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

http
  .createServer(async (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(PUBLIC, urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath);
    if (!file.startsWith(PUBLIC)) return res.writeHead(403).end();
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': file.endsWith('.json') ? 'no-cache' : 'max-age=300' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  })
  .listen(PORT, () => console.log(`Website on http://localhost:${PORT} — scraping every ${EVERY_H}h`));

let running = false;
function scrape() {
  if (running) return;
  running = true;
  console.log(`[${new Date().toISOString()}] scraping…`);
  const child = spawn(process.execPath, [path.join(ROOT, 'scraper', 'index.js')], { stdio: 'inherit' });
  child.on('exit', (code) => {
    running = false;
    console.log(`[${new Date().toISOString()}] scrape finished (exit ${code})`);
  });
}

async function scrapeIfStale() {
  try {
    const idx = JSON.parse(await fs.readFile(path.join(PUBLIC, 'data', 'index.json'), 'utf8'));
    if (Date.now() - Date.parse(idx.updatedAt) < EVERY_H * 36e5) return;
  } catch {}
  scrape();
}

scrapeIfStale();
// setInterval overflows above ~24.8 days, so clamp
setInterval(scrape, Math.min(Math.max(EVERY_H, 0.25) * 36e5, 2 ** 31 - 1));
