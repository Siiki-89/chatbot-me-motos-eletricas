const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { criarRegistros, dataExcel } = require('../registros');
const { extrairDados, telefoneDoJid } = require('../dados-chamado');

function preparar(t) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'me-motos-test-'));
  const logs = [];
  const servico = criarRegistros({ raiz, esperar: async () => {},
    logger: { log: m => logs.push(m), error: (...m) => logs.push(m.join(' ')) } });
  t.after(async () => {
    await servico.fechar();
    // Apenas o diretório temporário retornado por mkdtemp neste teste.
    if (!path.resolve(raiz).startsWith(path.resolve(os.tmpdir()) + path.sep + 'me-motos-test-')) throw new Error('Pasta inesperada');
    fs.rmSync(raiz, { recursive: true, force: true });
  });
  const estado = chamados => fs.writeFileSync(path.join(raiz, 'estado-bot.json'), JSON.stringify({ chamados }));
  const ler = async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(raiz, 'chamados.xlsx'));
    return wb;
  };
  return { raiz, logs, servico, estado, ler };
}

const chamado = { protocolo: 'ME-000001', numero: '5511999990000@c.us',
  setor: 'Assistência Técnica', tipoAtendimento: 'Manutenção', status: 'aguardando_atendente',
  criadoEm: '2026-09-18T13:30:00.000Z', nomeCliente: 'Cliente de teste',
  dadosInformados: 'CPF: 123.456.789-01\nNº da Nota Fiscal: 00045\nModelo da moto: ME 01\nDescreva o problema: Não liga\nLuz apagada' };

test('imagem com ID $1 baixa uma vez; mensagem sem ID não chega ao navegador', async t => {
  const { servico, raiz } = preparar(t);
  let downloads = 0;
  const msg = { id: { $1: 'false_123@lid_FOTO' }, type: 'image', hasMedia: true,
    async downloadMedia() {
      assert.equal(this.id._serialized, 'false_123@lid_FOTO');
      downloads++;
      return { mimetype: 'image/png', data: 'YQ==' };
    } };
  await servico.salvarImagem(msg, 'ME-000009');
  await servico.salvarImagem({ ...msg, id: { _serialized: 'false_123@lid_FOTO' } }, 'ME-000009');
  assert.equal(downloads, 1);
  await assert.rejects(servico.salvarImagem({ ...msg, id: {} }, 'ME-000010'), /sem identificador válido/);
  assert.equal(downloads, 1);
  assert.equal(fs.existsSync(path.join(raiz, 'Chamados', 'ME-000010')), false);
});

test('extrai campos rotulados sem CPF e sem adivinhar texto livre', () => {
  assert.deepEqual(extrairDados(chamado.dadosInformados), {
    notaFiscal: '00045', modelo: 'ME 01', problema: 'Não liga\nLuz apagada',
  });
  assert.deepEqual(extrairDados('12345678901, 0010, ME, Não liga'), {});
  assert.deepEqual(extrairDados('*Nome:* Ana\n*NF:* 002\n*Modelo:* ME\n*Problema:* Motor\nCPF: 12345678901'),
    { nome: 'Ana', notaFiscal: '002', modelo: 'ME', problema: 'Motor' });
  assert.doesNotMatch(extrairDados('Problema: não liga 123.456.789-01').problema, /123/);
  assert.equal(telefoneDoJid('123456789012345@lid'), '');
  assert.equal(dataExcel(chamado.criadoEm).toISOString(), '2026-09-18T10:30:00.000Z');
});

test('Excel inclui telefone e NF como texto, sem CPF e sem criar pasta vazia', async t => {
  const { servico, estado, ler, raiz } = preparar(t);
  estado([['ME-000001', chamado]]);
  assert.equal(await servico.sincronizar(), true);
  const wb = await ler();
  const s = wb.getWorksheet('Chamados');
  assert.equal(s.getCell('A5').value, 'ME-000001');
  assert.equal(s.getCell('D5').value, '5511999990000');
  assert.equal(s.getCell('G5').value, '00045');
  assert.equal(s.getCell('H5').value, 'ME 01');
  assert.equal(s.getCell('I5').value, 'Não liga\nLuz apagada');
  assert.equal(s.getCell('M5').value, 0);
  assert.equal(s.getCell('N5').value, null);
  assert.ok(s.getCell('B5').value instanceof Date);
  assert.doesNotMatch(JSON.stringify(s.getSheetValues()), /123\.456\.789|CPF/);
  assert.equal(fs.existsSync(path.join(raiz, 'Chamados')), false);
  assert.equal(s.views[0].ySplit, 4);
  assert.ok(s.autoFilter);
});

test('atualiza por protocolo após ordenar e preserva trabalho manual da equipe', async t => {
  const { servico, estado, ler, raiz } = preparar(t);
  estado([['ME-000001', chamado], ['ME-000002', { ...chamado, protocolo: 'ME-000002' }]]);
  await servico.sincronizar();
  let wb = await ler();
  let s = wb.getWorksheet('Chamados');
  s.getCell('P5').value = 'Controlador com defeito';
  s.getCell('S5').value = 'Em reparo';
  const a = s.getRow(5).values, b = s.getRow(6).values;
  s.getRow(5).values = b;
  s.getRow(6).values = a;
  await wb.xlsx.writeFile(path.join(raiz, 'chamados.xlsx'));
  estado([['ME-000001', { ...chamado, status: 'encerrado', motivo: 'loja', encerradoEm: '2026-09-18T14:00:00Z' }],
    ['ME-000002', { ...chamado, protocolo: 'ME-000002' }]]);
  await servico.sincronizar();
  wb = await ler(); s = wb.getWorksheet('Chamados');
  assert.equal(s.getCell('A6').value, 'ME-000001');
  assert.equal(s.getCell('P6').value, 'Controlador com defeito');
  assert.equal(s.getCell('S6').value, 'Em reparo');
  assert.equal(s.getCell('J6').value, 'Encerrado');
  assert.equal(s.rowCount, 6);
});

test('arquivo bloqueado ou corrompido não é sobrescrito; sincroniza depois de fechar', async t => {
  const { servico, estado, ler, raiz } = preparar(t);
  estado([['ME-000001', chamado]]);
  await servico.sincronizar();
  const file = path.join(raiz, 'chamados.xlsx');
  const antes = fs.readFileSync(file);
  const lock = path.join(raiz, '~$chamados.xlsx');
  fs.writeFileSync(lock, 'lock');
  estado([['ME-000001', { ...chamado, status: 'encerrado' }]]);
  assert.equal(await servico.sincronizar(), false);
  assert.deepEqual(fs.readFileSync(file), antes);
  fs.unlinkSync(lock);
  assert.equal(await servico.sincronizar(), true);
  assert.equal((await ler()).getWorksheet('Chamados').getCell('J5').value, 'Encerrado');
  fs.writeFileSync(file, 'corrompido');
  assert.equal(await servico.sincronizar(), false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'corrompido');
});

test('salva imagem e imagem-documento, deduplica após reinício e atualiza contagem', async t => {
  const { servico, estado, raiz, ler } = preparar(t);
  estado([['ME-000001', chamado]]);
  let downloads = 0;
  const msg = { id: { _serialized: 'foto-1' }, type: 'image', hasMedia: true,
    downloadMedia: async () => { downloads++; return { mimetype: 'image/png', data: Buffer.from('foto teste').toString('base64'), filename: '../../escape.png' }; } };
  assert.equal(await servico.salvarImagem(msg, 'ME-000001'), true);
  await servico.salvarImagem(msg, 'ME-000001');
  assert.equal(downloads, 1);
  await servico.salvarImagem({ ...msg, id: { _serialized: 'foto-2' }, type: 'document' }, 'ME-000001');
  const reinicio = criarRegistros({ raiz });
  try { await reinicio.salvarImagem(msg, 'ME-000001'); } finally { await reinicio.fechar(); }
  assert.equal(downloads, 2);
  assert.equal(servico.listarImagens('ME-000001').length, 2);
  const names = fs.readdirSync(path.join(raiz, 'Chamados', 'ME-000001'));
  assert.ok(names.every(n => /^[a-f0-9]{64}\.png$/.test(n)));
  await servico.sincronizar();
  const s = (await ler()).getWorksheet('Chamados');
  assert.equal(s.getCell('M5').value, 2);
  assert.equal(s.getCell('N5').value, path.join('Chamados', 'ME-000001'));
  await assert.rejects(servico.salvarImagem(msg, '../../escape'), /inválido/);
});

test('PDF, vídeo e falha de download não criam pasta; download falho é repetido', async t => {
  const { servico, raiz } = preparar(t);
  let tentativas = 0;
  await assert.rejects(servico.salvarImagem({ id: { _serialized: 'offline' }, type: 'image', hasMedia: true,
    downloadMedia: async () => { tentativas++; throw new Error('offline'); } }, 'ME-000001'), /Imagem não baixada/);
  assert.equal(tentativas, 3);
  assert.equal(await servico.salvarImagem({ id: { _serialized: 'pdf' }, type: 'document', hasMedia: true,
    downloadMedia: async () => ({ mimetype: 'application/pdf', data: 'YQ==' }) }, 'ME-000001'), false);
  assert.equal(await servico.salvarImagem({ type: 'video', hasMedia: true }, 'ME-000001'), false);
  assert.equal(fs.existsSync(path.join(raiz, 'Chamados')), false);
});
