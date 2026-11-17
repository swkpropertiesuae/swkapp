// Local dev server. On Vercel the same handler runs as api/[...path].js and public/ is served by the CDN.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { handler, init } from './lib/app.js'

const PUBLIC = path.resolve('public')
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }
const SEC = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin',
  'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" }

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
  const file = path.resolve(PUBLIC, rel)
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"Not found"}') }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', ...SEC })
  fs.createReadStream(file).pipe(res)
}

await init() // fail fast if the database or first-manager variables are missing
http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x')
  return pathname.startsWith('/api/') ? handler(req, res) : serveStatic(res, pathname)
}).listen(Number(process.env.PORT) || 8080, () => console.log('SWK Daily listening'))
