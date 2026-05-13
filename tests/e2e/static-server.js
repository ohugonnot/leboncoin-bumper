#!/usr/bin/env node
// Serveur HTTP statique minimal pour les tests E2E — sert le répertoire racine du projet.
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { resolve, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const PORT = process.env.STATIC_PORT ? +process.env.STATIC_PORT : 7331;

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const fp = resolve(ROOT, '.' + url);
  // Refuse toute sortie hors du répertoire racine
  if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(fp);
    const ct = MIME[extname(fp)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(PORT, () => {
  process.stdout.write(`Static server ready on ${PORT}\n`);
});
