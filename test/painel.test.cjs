const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const ExcelJS = require('exceljs');
const { criarStore, csv } = require('../painel/store');
const { criarServidor } = require('../painel/server');

function fixture(t) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'me-painel-test-'));
  const chamado = { protocolo: 'ME-000001', criadoEm: '2026-09-18T12:00:00Z',
    setor: 'Assistência Técnica', tipoAtendimento: 'Manutenção', numero: '5511999990000@c.us',
    dadosInformados: 'CPF: 123.456.789-01\nNF: 000123\nModelo: ME\nProblema: Não liga', status: 'encerrado' };
  const state = { chamados: [['ME-000001', chamado]], atendimentos: [['123@lid', { etapa: 'setor' }]] };
  fs.writeFileSync(path.join(raiz, 'estado-bot.json'), JSON.stringify(state));
  t.after(() => {
    if (!path.resolve(raiz).startsWith(path.resolve(os.tmpdir()) + path.sep + 'me-painel-test-')) throw new Error('Pasta inesperada');
    fs.rmSync(raiz, { recursive: true, force: true });
  });
  return { raiz, store: criarStore(raiz) };
}

test('painel lê chamados sem CPF/LID e distingue conversa encerrada de reparo concluído', async t => {
  const { raiz, store } = fixture(t);
  const data = await store.listar();
  assert.equal(data.chamados.length, 1);
  assert.equal(data.semProtocolo, 1);
  assert.equal(data.chamados[0].telefone, '5511999990000');
  assert.equal(data.chamados[0].notaFiscal, '000123');
  assert.equal(data.chamados[0].statusAssistencia, 'Aguardando');
  assert.equal(data.chamados[0].statusBot, 'encerrado');
  assert.doesNotMatch(JSON.stringify(data), /123\.456\.789|dadosInformados|@lid/);
  assert.equal(fs.existsSync(path.join(raiz, 'painel-dados.json')), false);
  assert.equal(fs.existsSync(path.join(raiz, 'Chamados')), false);
});

test('edição persiste após reiniciar, mantém estado do bot e rejeita revisão desatualizada', async t => {
  const { raiz, store } = fixture(t);
  const estadoAnterior = fs.readFileSync(path.join(raiz, 'estado-bot.json'), 'utf8');
  const salvo = await store.atualizar('ME-000001', { revisao: 0, campos: { nome: 'Ana', statusAssistencia: 'Em reparo', responsavel: 'Equipe', diagnostico: 'Falha no controlador' } });
  assert.equal(salvo.revisao, 1);
  assert.equal(salvo.historico.length, 1);
  const reinicio = criarStore(raiz);
  assert.equal((await reinicio.listar()).chamados[0].diagnostico, 'Falha no controlador');
  assert.equal(fs.readFileSync(path.join(raiz, 'estado-bot.json'), 'utf8'), estadoAnterior);
  await assert.rejects(store.atualizar('ME-000001', { revisao: 0, campos: { nome: 'Sobrescrito' } }), { status: 409 });
  const fim = await store.atualizar('ME-000001', { revisao: 1, campos: { statusAssistencia: 'Concluído' } });
  assert.match(fim.concluidoEm, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(fim.statusBot, 'encerrado');
});

test('importa preenchimentos do Excel e mantém prioridade das edições do painel', async t => {
  const { raiz, store } = fixture(t);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(__dirname, '..', 'modelo-chamados.xlsx'));
  const sheet = wb.getWorksheet('Chamados');
  sheet.getCell('A5').value = 'ME-000001';
  sheet.getCell('P5').value = 'Diagnóstico no Excel';
  sheet.getCell('R5').value = 'Rafael';
  sheet.getCell('S5').value = 'Em análise';
  await wb.xlsx.writeFile(path.join(raiz, 'chamados.xlsx'));
  const c = (await store.listar()).chamados[0];
  assert.equal(c.diagnostico, 'Diagnóstico no Excel');
  assert.equal(c.statusAssistencia, 'Em análise');
  await store.atualizar('ME-000001', { revisao: 0, campos: { diagnostico: 'Revisado no painel' } });
  assert.equal((await store.listar()).chamados[0].diagnostico, 'Revisado no painel');
  assert.equal((await store.listar()).chamados[0].responsavel, 'Rafael');
});

test('valida campos e arquivos sem substituir dados corrompidos', async t => {
  const { raiz, store } = fixture(t);
  for (const campos of [{ telefone: 'abc' }, { statusAssistencia: 'Inexistente' }, { concluidoEm: '2026-02-30' }, { cpf: '123' }]) {
    await assert.rejects(store.atualizar('ME-000001', { revisao: 0, campos }), { status: 400 });
  }
  fs.writeFileSync(path.join(raiz, 'painel-dados.json'), 'quebrado');
  await assert.rejects(store.listar());
  assert.equal(fs.readFileSync(path.join(raiz, 'painel-dados.json'), 'utf8'), 'quebrado');
});

test('API protege edição, serve imagem permitida e bloqueia caminhos externos', async t => {
  const { raiz } = fixture(t);
  const pasta = path.join(raiz, 'Chamados', 'ME-000001');
  fs.mkdirSync(pasta, { recursive: true });
  const nome = 'a'.repeat(64) + '.png';
  fs.writeFileSync(path.join(pasta, nome), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6QAAAABJRU5ErkJggg==', 'base64'));
  const server = criarServidor({ raiz });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const resposta = await fetch(base + '/api/chamados');
    const data = await resposta.json();
    assert.equal(data.chamados[0].imagens.length, 1);
    let res = await fetch(base + '/api/chamados/ME-000001', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revisao: 0, campos: { nome: 'Ana' } }) });
    assert.equal(res.status, 403);
    res = await fetch(base + '/api/chamados/ME-000001', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Painel-Token': data.token, Origin: 'http://outra-origem' }, body: '{}' });
    assert.equal(res.status, 403);
    res = await fetch(base + '/api/chamados/ME-000001', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Painel-Token': data.token }, body: JSON.stringify({ revisao: 0, campos: { nome: 'João', diagnostico: 'Não liga' } }) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).nome, 'João');
    res = await fetch(base + data.chamados[0].imagens[0].url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(base + '/estado-bot.json')).status, 404);
    assert.equal((await fetch(base + '/api/imagens/ME-000001/estado-bot.json')).status, 404);
    const hostExterno = await new Promise((resolve, reject) => {
      const req = http.get(base + '/api/chamados', { headers: { Host: 'host-externo:123' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
    });
    assert.equal(hostExterno, 403);
    const exported = await (await fetch(base + '/api/exportar.csv')).text();
    assert.match(exported, /João/);
    assert.doesNotMatch(exported, /123\.456\.789/);
    assert.equal((await fetch(base + '/')).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('CSV escapa fórmulas e preserva acentos e quebras de linha', () => {
  const result = csv([{ nome: '=HYPERLINK("evil")', problema: 'Revisão\nFreios', id: 'ME-000001' }]);
  assert.ok(result.startsWith('\uFEFF'));
  assert.match(result, /'=HYPERLINK/);
  assert.match(result, /"Revisão\nFreios"/);
});
