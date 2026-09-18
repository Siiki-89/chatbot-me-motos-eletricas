const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('reentrega com ID $1 e _serialized não duplica o menu', async () => {
  const bot = setup();
  await bot.receive('Oi', { id: { $1: 'false_5511999990000@c.us_OI' } });
  await bot.receive('Oi', { id: { _serialized: 'false_5511999990000@c.us_OI' } });
  assert.equal(bot.sent.length, 1);
});

test('imagens de assistência são salvas em silêncio, inclusive depois da triagem e com contato salvo', async () => {
  const bot = setup();
  for (const body of ['Oi', '2', '1', '1', 'NF: 001\nModelo: ME\nProblema: Não liga']) await bot.receive(body);
  const qtd = bot.sent.length;
  await bot.receive('', { hasMedia: true, type: 'image' });
  await bot.receive('legenda', { hasMedia: true, type: 'document', getContact: async () => ({ isMyContact: true }) });
  assert.equal(bot.imagens.length, 2);
  assert.equal(bot.imagens[0].protocolo, 'ME-000001');
  assert.equal(bot.sent.length, qtd);
  const c = new Map(bot.state().chamados).get('ME-000001');
  assert.equal(c.dadosEstruturados.notaFiscal, '001');
  assert.equal(c.telefone, '5511999990000');
  await bot.receive('Modelo: ME corrigido');
  assert.equal(new Map(bot.state().chamados).get('ME-000001').dadosEstruturados.modelo, 'ME corrigido');
});

test('fotos não completam dados nem são salvas para vendas ou contato sem chamado', async () => {
  const bot = setup();
  await bot.receive('', { hasMedia: true, type: 'image', getContact: async () => ({ isMyContact: true }) });
  assert.equal(bot.imagens.length, 0);
  for (const body of ['Oi', '1']) await bot.receive(body);
  await bot.receive('', { hasMedia: true, type: 'image' });
  assert.equal(bot.imagens.length, 0);
  await bot.receive('encerrar');
  for (const body of ['Oi', '2', '1', '1']) await bot.receive(body);
  const qtd = bot.sent.length;
  await bot.receive('1', { hasMedia: true, type: 'image' });
  assert.equal(bot.imagens.length, 1);
  assert.equal(bot.state().atendimentos[0][1].etapa, 'dados_cliente');
  assert.equal(bot.sent.length, qtd);
});

test('resolve telefone real de LID sem expor identificador interno como telefone', async () => {
  const bot = setup();
  bot.client.getContactLidAndPhone = async () => [{ lid: '99999999999@lid', pn: '5511999990000@c.us' }];
  await bot.receive('Oi', { from: '99999999999@lid', getContact: async () => ({ isMyContact: false, pushname: 'Ana' }) });
  const c = new Map(bot.state().chamados).get('ME-000001');
  assert.equal(c.telefone, '5511999990000');
  assert.equal(c.nomeCliente, 'Ana');
});

function setup(files = new Map(), env = {}) {
  const handlers = {};
  const sent = [];
  const waits = [];
  const logs = [];
  const imagens = [];
  let now = Date.now();
  class TestDate extends Date { static now() { return now; } }
  let fail = false;
  let strategy;
  let cleanups = 0;
  const client = {
    on: (event, callback) => { handlers[event] = callback; },
    initialize: async () => {},
    sendMessage: async (to, body) => {
      if (fail) { fail = false; throw new Error('Falha simulada'); }
      sent.push({ to, body });
    },
  };
  const mockFs = {
    existsSync: name => files.has(name),
    readFileSync: name => files.get(name),
    writeFileSync: (name, text) => files.set(name, text),
    renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from); },
  };
  const context = vm.createContext({
    require: name => ({ fs: mockFs, path, 'qrcode-terminal': { generate() {} },
      './dados-chamado': require('../dados-chamado'),
      './mensagem-id': require('../mensagem-id'),
      './registros': { criarRegistros: () => ({ agendar() {}, async fechar() {},
        async salvarImagem(msg, protocolo) { imagens.push({ msg, protocolo }); } }) },
      'whatsapp-web.js': {
        Client: function (options) {
          strategy = options.authStrategy;
          strategy.client = client;
          return client;
        },
        LocalAuth: class { async logout() { cleanups++; } },
      } })[name],
    __dirname: path.resolve(__dirname, '..'),
    Date: TestDate,
    process: { env, once() {} }, console: { log: (...args) => logs.push(args.join(' ')), warn() {}, error() {} },
    setTimeout: (callback, ms) => { waits.push(ms); callback(); },
  });
  vm.runInContext(source, context);
  return {
    sent, files, client, strategy, waits, logs, imagens, cleanups: () => cleanups,
    advance: ms => { now += ms; },
    state: () => JSON.parse(files.get(path.resolve(__dirname, '..', 'estado-bot.json'))),
    fail: () => { fail = true; },
    receive: (body, extra = {}) => handlers.message({ from: '5511999990000@c.us', body, type: 'chat',
      getContact: async () => ({ isMyContact: false }), ...extra }),
    close: () => handlers.message_create({ fromMe: true, to: '5511999990000@c.us',
      body: 'Este atendimento será finalizado.' }),
  };
}

test('contato não salvo percorre assistência, aguarda atendente e pode reabrir', async () => {
  const bot = setup();
  for (const body of ['Olá', '2', '2', '1', 'Dados fictícios para teste']) await bot.receive(body);
  assert.equal(bot.sent.length, 5);
  assert.match(bot.sent[4].body, /informações foram recebidas/);
  await bot.receive('obrigado');
  assert.equal(bot.sent.length, 5);
  await bot.close();
  await bot.receive('Olá novamente');
  assert.match(bot.sent[5].body, /1 - Vendas/);
});

test('chamado aparece apenas no console e histórico, inclusive no encerramento de vendas', async () => {
  const bot = setup();
  await bot.receive('Oi');
  assert.ok(bot.logs.some(line => line.includes('Chamado ME-000001')));
  await bot.receive('1');
  assert.match(bot.sent[1].body, /atendimento por aqui foi encerrado/);
  for (const msg of bot.sent) assert.doesNotMatch(msg.body, /ME-\d+|Chamado:/);
  assert.ok(bot.logs.some(line => line.includes('ME-000001') && line.includes('encerrado')));
  const record = new Map(bot.state().chamados).get('ME-000001');
  assert.equal(record.status, 'encerrado');
  assert.equal(record.motivo, 'encaminhado_vendas');
  assert.ok(record.encerradoEm);
  assert.equal(bot.state().atendimentos.length, 0);
});

test('numeração cresce entre clientes, reinícios e reaberturas', async () => {
  const bot = setup();
  await Promise.all([
    bot.receive('Oi'), bot.receive('Oi', { from: '5511999991111@c.us' }),
  ]);
  const protocols = bot.state().atendimentos.map(([, a]) => a.protocolo);
  assert.equal(new Set(protocols).size, 2);
  assert.equal(bot.state().ultimoChamado, 2);
  await bot.close();
  const restarted = setup(bot.files);
  await restarted.receive('Oi');
  assert.ok(restarted.logs.some(line => line.includes('ME-000003')));
  assert.doesNotMatch(restarted.sent[0].body, /ME-\d+/);
  assert.equal(new Map(restarted.state().chamados).get('ME-000001').status, 'encerrado');
});

test('chamado de assistência mantém os dados e histórico depois de encerrar', async () => {
  const bot = setup();
  for (const body of ['Oi', '2', '1', '1', 'Dados fictícios']) await bot.receive(body);
  assert.doesNotMatch(bot.sent.at(-1).body, /ME-\d+/);
  assert.equal(new Map(bot.state().chamados).get('ME-000001').status, 'aguardando_atendente');
  await bot.receive('encerrar');
  for (const msg of bot.sent) assert.doesNotMatch(msg.body, /ME-\d+|Chamado:/);
  const record = new Map(bot.state().chamados).get('ME-000001');
  assert.equal(record.status, 'encerrado');
  assert.equal(record.dadosInformados, 'Dados fictícios');
});

test('falha de envio não reutiliza protocolo reservado nem registra encerramento', async () => {
  const bot = setup();
  bot.fail();
  await bot.receive('Oi');
  await bot.receive('Oi');
  assert.ok(bot.logs.some(line => line.includes('ME-000002')));
  bot.fail();
  await bot.receive('1');
  assert.equal(new Map(bot.state().chamados).get('ME-000002').status, 'aberto');
  await bot.receive('1');
  assert.equal(new Map(bot.state().chamados).get('ME-000002').status, 'encerrado');
});

test('arquivo de estado inválido impede iniciar para preservar os protocolos', () => {
  const files = new Map([[path.resolve(__dirname, '..', 'estado-bot.json'), '{inválido']]);
  assert.throws(() => setup(files));
  assert.equal(files.values().next().value, '{inválido');
});

test('reentregas do mesmo ID não repetem mensagens nem avançam etapas', async () => {
  const bot = setup();
  const extra = { id: { _serialized: 'mensagem-oi' } };
  await Promise.all([bot.receive('Oi', extra), bot.receive('Oi', extra), bot.receive('Oi', extra)]);
  assert.equal(bot.sent.length, 1);
  await bot.receive('2', { id: { _serialized: 'nova-escolha' } });
  assert.equal(bot.sent.length, 2);
  assert.match(bot.sent[1].body, /Manutenção/);
});

test('notificações internas não geram menus repetidos', async () => {
  const bot = setup();
  await bot.receive('Oi');
  for (const type of ['e2e_notification', 'notification_template', 'ciphertext', 'revoked', 'protocol']) {
    await bot.receive('', { type });
  }
  assert.equal(bot.sent.length, 1);
});

test('cada resposta espera 3 segundos antes do envio', async () => {
  const bot = setup();
  await bot.receive('Oi');
  await bot.receive('2');
  assert.deepEqual(bot.waits, [3000, 3000]);
});

test('garantia mostra condições e opção 2 encerra em ambos os tipos', async () => {
  for (const choice of ['1', '2']) {
    const bot = setup();
    for (const body of ['Oi', '2', choice]) await bot.receive(body);
    const prompt = bot.sent.at(-1).body;
    if (choice === '2') {
      assert.match(prompt, /3 meses de garantia/);
      assert.match(prompt, /01 ano no motor, controlador e bateria/);
      assert.match(prompt, /desbloqueada/);
    } else {
      assert.match(prompt, /2 - Encerrar/);
    }
    await bot.receive('2');
    assert.match(bot.sent.at(-1).body, /atendimento foi encerrado/);
    await bot.receive('Oi');
    assert.match(bot.sent.at(-1).body, /1 - Vendas/);
  }
});

test('reentrega após falha no envio permite nova tentativa', async () => {
  const bot = setup();
  const extra = { id: { _serialized: 'envio-falhou' } };
  bot.fail();
  await bot.receive('Oi', extra);
  await bot.receive('Oi', extra);
  assert.equal(bot.sent.length, 1);
});

test('logout não apaga perfil enquanto Chromium está conectado', async () => {
  const bot = setup();
  bot.client.pupBrowser = { isConnected: () => true };
  await bot.strategy.logout();
  assert.equal(bot.cleanups(), 0);
  bot.client.pupBrowser = { isConnected: () => false };
  await bot.strategy.logout();
  assert.equal(bot.cleanups(), 1);
});

test('encerrar funciona em cada etapa, no silêncio e após encaminhar para vendas', async () => {
  for (const flow of [[], ['Oi'], ['Oi', '2'], ['Oi', '2', '1'],
    ['Oi', '2', '1', '1'], ['Oi', '2', '1', '1', 'Dados fictícios'], ['Oi', '1']]) {
    const bot = setup();
    for (const text of flow) await bot.receive(text);
    await bot.receive('  ENCERRAR  ');
    assert.match(bot.sent.at(-1).body, flow.length ? /foi encerrado/ : /não tem um atendimento/);
    const restarted = setup(bot.files);
    await restarted.receive('Oi');
    assert.match(restarted.sent[0].body, /1 - Vendas/);
  }
});

test('encerrar preserva isenção de contatos salvos e não afeta outro cliente', async () => {
  const bot = setup();
  await bot.receive('Oi');
  await bot.receive('encerrar', { from: 'outro@c.us' });
  await bot.receive('encerrar', { getContact: async () => ({ isMyContact: true }) });
  assert.equal(bot.sent.length, 2);
  await bot.receive('2');
  assert.match(bot.sent.at(-1).body, /Por favor, selecione/);
});

test('falha ao confirmar encerramento permite tentar novamente', async () => {
  const bot = setup();
  for (const text of ['Oi', '2', '1', '1', 'Dados fictícios']) await bot.receive(text);
  bot.fail();
  await bot.receive('encerrar');
  await bot.receive('Oi');
  assert.equal(bot.sent.length, 5);
  await bot.receive('encerrar');
  assert.match(bot.sent.at(-1).body, /foi encerrado/);
});

test('frases contendo encerrar não são interpretadas como comando', async () => {
  const bot = setup();
  await bot.receive('Oi');
  await bot.receive('não quero encerrar');
  assert.match(bot.sent.at(-1).body, /Por favor/);
});

test('manutenção exige confirmação antes dos dados e repete opção inválida', async () => {
  const bot = setup();
  for (const body of ['Oi', 'inválido', '2', '1', '1']) await bot.receive(body);
  assert.match(bot.sent[1].body, /Por favor/);
  assert.match(bot.sent[4].body, /CPF/);
  assert.match(bot.sent[3].body, /somente para motos adquiridas/);
});

test('silêncio de vendas persiste após reiniciar', async () => {
  const bot = setup();
  await bot.receive('Oi');
  await bot.receive('1');
  assert.equal(bot.sent[1].body,
    'Perfeito.\n\n' +
    'O atendimento de *Vendas* é realizado em outro WhatsApp.\n\n' +
    'Fale diretamente com o Gabriel pelo link abaixo:\n\n' +
    'https://wa.me/5547991651258' +
    '\n\nSeu atendimento por aqui foi encerrado. Continue com o Gabriel pelo link acima.');
  assert.doesNotMatch(bot.sent[1].body, /\?text=|BEGIN:VCARD/);
  assert.equal(bot.sent.length, 2);
  const restarted = setup(bot.files);
  await restarted.receive('Obrigado');
  assert.equal(restarted.sent.length, 0);
});

test('encaminhamento para vendas não reabre após 10 minutos ou no dia seguinte', async () => {
  const bot = setup();
  await bot.receive('Oi');
  await bot.receive('1');
  bot.advance(11 * 60 * 1000);
  await bot.receive('Obrigado');
  bot.advance(24 * 60 * 60 * 1000);
  await bot.receive('Oi');
  assert.equal(bot.sent.length, 2);
  const restarted = setup(bot.files);
  await restarted.receive('2');
  assert.equal(restarted.sent.length, 0);
  await restarted.close();
  await restarted.receive('Oi');
  assert.match(restarted.sent[0].body, /1 - Vendas/);
});

test('falha ao encaminhar para vendas não encerra o atendimento', async () => {
  const bot = setup();
  await bot.receive('Oi');
  bot.fail();
  await bot.receive('1');
  await bot.receive('1');
  assert.equal(bot.sent.length, 2);
  await bot.receive('Obrigado');
  assert.equal(bot.sent.length, 2);
});

test('falha no envio preserva etapa, inclusive após reiniciar', async () => {
  const bot = setup();
  await bot.receive('Oi');
  bot.fail();
  await bot.receive('2');
  const restarted = setup(bot.files);
  await restarted.receive('2');
  assert.match(restarted.sent[0].body, /Por favor, selecione/);
});

test('falha na confirmação final não silencia o cliente', async () => {
  const bot = setup();
  for (const body of ['Oi', '2', '1', '1']) await bot.receive(body);
  bot.fail();
  await bot.receive('Dados fictícios');
  await bot.receive('Dados fictícios novamente');
  assert.match(bot.sent.at(-1).body, /informações foram recebidas/);
});

test('mensagens simultâneas respeitam a sequência das etapas', async () => {
  const bot = setup();
  await Promise.all(['Oi', '2', '1', '1'].map(body => bot.receive(body)));
  assert.equal(bot.sent.length, 4);
  assert.match(bot.sent[1].body, /Por favor, selecione/);
  assert.match(bot.sent[2].body, /comprada/);
  assert.match(bot.sent[3].body, /CPF/);
});

test('ignora grupos, status, canais e mensagens próprias', async () => {
  const bot = setup();
  for (const from of ['grupo@g.us', 'status@broadcast', 'canal@newsletter']) {
    await bot.receive('Oi', { from });
  }
  await bot.receive('Oi', { fromMe: true });
  assert.equal(bot.sent.length, 0);
});

test('contatos salvos são ignorados por padrão em c.us e lid', async () => {
  const bot = setup();
  for (const from of ['5511999990000@c.us', '123456@lid']) {
    await bot.receive('Oi', { from, getContact: async () => ({ isMyContact: true }) });
  }
  assert.equal(bot.sent.length, 0);
});

test('contato salvo durante atendimento deixa de receber mensagens', async () => {
  const bot = setup();
  await bot.receive('Oi');
  await bot.receive('2', { getContact: async () => ({ isMyContact: true }) });
  assert.equal(bot.sent.length, 1);
});

test('falha ou resposta inconclusiva na consulta do contato não dispara mensagens', async () => {
  const bot = setup();
  await bot.receive('Oi', { getContact: async () => { throw new Error('Consulta falhou'); } });
  for (const contact of [null, {}, { isMyContact: undefined }]) {
    await bot.receive('Oi', { getContact: async () => contact });
  }
  assert.equal(bot.sent.length, 0);
  await bot.receive('Oi');
  assert.match(bot.sent[0].body, /1 - Vendas/);
});

test('filtro pode ser desativado explicitamente; desconhecidos lid são aceitos', async () => {
  const unfiltered = setup(new Map(), { IGNORAR_CONTATOS_SALVOS: 'false' });
  await unfiltered.receive('Oi', { getContact: async () => ({ isMyContact: true }) });
  assert.equal(unfiltered.sent.length, 1);
  const bot = setup();
  await bot.receive('Oi', { from: '123456@lid' });
  assert.equal(bot.sent.length, 1);
});

