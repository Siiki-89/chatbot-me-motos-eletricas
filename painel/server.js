const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { criarStore, STATUS, csv } = require('./store');

function criarServidor({ raiz = path.resolve(__dirname, '..') } = {}) {
  const store = criarStore(raiz);
  const token = crypto.randomBytes(32).toString('hex');
  const tipos = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.bmp': 'image/bmp' };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    function json(value, status = 200) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    }
    try {
      const port = server.address().port;
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) return json({ erro: 'Acesso local somente.' }, 403);
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && url.pathname === '/api/chamados') {
        return json({ ...(await store.listar()), statusDisponiveis: STATUS, token });
      }
      if (req.method === 'PATCH' && /^\/api\/chamados\/ME-\d+$/.test(url.pathname)) {
        if (req.headers['x-painel-token'] !== token ||
            (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) return json({ erro: 'Sessão inválida. Recarregue a página.' }, 403);
        if (!req.headers['content-type']?.startsWith('application/json')) return json({ erro: 'Formato inválido.' }, 415);
        const chunks = []; let tamanho = 0;
        for await (const chunk of req) {
          tamanho += chunk.length;
          if (tamanho > 65536) return json({ erro: 'Conteúdo muito grande.' }, 413);
          chunks.push(chunk);
        }
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json({ erro: 'Dados inválidos.' }, 400); }
        if (!parsed || typeof parsed !== 'object' || !parsed.campos || typeof parsed.campos !== 'object') return json({ erro: 'Dados inválidos.' }, 400);
        return json(await store.atualizar(url.pathname.split('/').pop(), parsed));
      }
      if (req.method === 'GET' && url.pathname === '/api/exportar.csv') {
        const { chamados } = await store.listar();
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="chamados-painel.csv"' });
        return res.end(csv(chamados));
      }
      const match = url.pathname.match(/^\/api\/imagens\/(ME-\d+)\/([^/]+)$/);
      if (req.method === 'GET' && match) {
        const file = store.imagem(match[1], match[2]);
        const ext = path.extname(file);
        res.setHeader('Content-Type', tipos[ext] || 'application/octet-stream');
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
        if (url.searchParams.has('download') || !['.png', '.jpg', '.gif', '.webp', '.avif', '.bmp', '.ico'].includes(ext)) {
          res.setHeader('Content-Disposition', `attachment; filename="${match[1]}-${match[2].slice(0, 12)}${ext}"`);
        }
        fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
        return;
      }
      const publicos = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/marca.svg': 'marca.svg' };
      const asset = publicos[url.pathname];
      if (req.method === 'GET' && asset) {
        res.setHeader('Content-Type', tipos[path.extname(asset)]);
        fs.createReadStream(path.join(__dirname, 'public', asset)).on('error', () => res.destroy()).pipe(res);
        return;
      }
      return json({ erro: 'Não encontrado.' }, 404);
    } catch (err) {
      console.error('Painel:', err.message);
      if (!res.headersSent) json({ erro: err.status ? err.message : 'Não foi possível acessar os dados. Confira o terminal do painel.' }, err.status || 500);
      else res.end();
    }
  });
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PAINEL_PORT || 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PAINEL_PORT inválida.');
  const server = criarServidor();
  server.on('error', err => { console.error(err.code === 'EADDRINUSE' ? `O painel já está aberto na porta ${port}.` : err.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Painel ME Motos: http://127.0.0.1:${port}\nMantenha este terminal aberto. Ctrl+C para parar o painel.`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}

module.exports = { criarServidor };
