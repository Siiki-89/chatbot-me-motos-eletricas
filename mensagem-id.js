// Compatibilidade com mensagens cujo identificador serializado vem em $1.
// A biblioteca 1.34.7 ainda lê this.id._serialized no downloadMedia().
function normalizarIdMensagem(msg) {
  const original = msg.id;
  const dados = original && typeof original === 'object' ? original : {};
  let serializado = typeof original === 'string' ? original : dados._serialized;
  if (!serializado && typeof dados.$1 === 'string') serializado = dados.$1;
  if (!serializado) {
    const remote = typeof dados.remote === 'string' ? dados.remote
      : dados.remote?._serialized || dados.remote?.$1;
    // Não inventa IDs com o remetente ou timestamp: exige os componentes reais.
    if (typeof dados.fromMe === 'boolean' && typeof remote === 'string' &&
        typeof dados.id === 'string' && dados.id && /@(?:c\.us|lid)$/.test(remote)) {
      serializado = `${dados.fromMe}_${remote}_${dados.id}`;
    }
  }
  if (typeof serializado !== 'string' || !serializado.trim()) return undefined;
  if (dados._serialized !== serializado) msg.id = { ...dados, _serialized: serializado };
  return serializado;
}

module.exports = { normalizarIdMensagem };
