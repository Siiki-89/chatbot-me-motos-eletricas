const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizarIdMensagem } = require('../mensagem-id');
const { Message } = require('whatsapp-web.js');

test('mantém ID antigo e reconhece $1, string e componentes de LID', () => {
  const id = 'false_71121017782418@lid_FOTO123';
  for (const formato of [
    { _serialized: id }, { $1: id }, id,
    { fromMe: false, remote: '71121017782418@lid', id: 'FOTO123' },
    { fromMe: false, remote: { $1: '71121017782418@lid' }, id: 'FOTO123' },
  ]) {
    const msg = { id: formato };
    assert.equal(normalizarIdMensagem(msg), id);
    assert.equal(msg.id._serialized, id);
    assert.equal(normalizarIdMensagem(msg), id);
  }
  const antigo = { _serialized: 'original', $1: 'outro' };
  assert.equal(normalizarIdMensagem({ id: antigo }), 'original');
  assert.equal(normalizarIdMensagem({ from: '5511999990000@c.us' }), undefined);
  assert.equal(normalizarIdMensagem({ id: { id: 'parcial' } }), undefined);
});

test('downloadMedia real da biblioteca recebe o ID normalizado em vez de undefined', async () => {
  const id = 'false_71121017782418@lid_FOTO123';
  const msg = Object.create(Message.prototype);
  msg.id = { fromMe: false, remote: '71121017782418@lid', id: 'FOTO123', $1: id };
  msg.hasMedia = true;
  msg.client = { pupPage: { evaluate: async (_fn, recebido) => {
    assert.equal(recebido, id);
    return { mimetype: 'image/png', data: 'YQ==', filesize: 1 };
  } } };
  normalizarIdMensagem(msg);
  const media = await msg.downloadMedia();
  assert.equal(media.mimetype, 'image/png');
  assert.equal(media.data, 'YQ==');
});
