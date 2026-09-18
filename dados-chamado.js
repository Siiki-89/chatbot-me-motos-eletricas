const COLUNAS = [
  'Chamado', 'Abertura', 'Cliente', 'Telefone', 'Setor', 'Tipo de atendimento',
  'Nº da Nota Fiscal', 'Modelo da moto', 'Problema relatado', 'Status do bot',
  'Encerramento do bot', 'Motivo do encerramento', 'Imagens salvas', 'Pasta das imagens',
  'Dados a revisar', 'Diagnóstico', 'Peças utilizadas', 'Responsável',
  'Status da assistência', 'Conclusão da assistência', 'Observações da equipe',
];

function semCpf(valor) {
  return String(valor || '').replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[documento omitido]');
}

// Extrai somente campos identificados; não adivinha a partir de números soltos.
function extrairDados(texto = '') {
  const resultado = {};
  const marcador = /(?:^|\n|;)[ \t*]*(CPF[^:\n;]*|Nome(?: do cliente)?|(?:N[º°o.]?\s*(?:da\s*)?)?Nota Fiscal|NF|Modelo(?: da moto)?|Descreva o problema|Problema(?: relatado)?)[ \t*]*:[ \t*]*/gim;
  const encontrados = [...texto.matchAll(marcador)];
  for (let i = 0; i < encontrados.length; i++) {
    const atual = encontrados[i];
    const rotulo = atual[1].toLowerCase();
    const valor = semCpf(texto.slice(atual.index + atual[0].length,
      encontrados[i + 1]?.index ?? texto.length).trim());
    const campo = rotulo.startsWith('nome') ? 'nome' : rotulo.startsWith('modelo') ? 'modelo'
      : /problema/.test(rotulo) ? 'problema' : /nota fiscal|^nf$/.test(rotulo) ? 'notaFiscal' : null;
    if (campo && valor) resultado[campo] = valor;
  }
  return resultado;
}

function telefoneDoJid(jid) {
  return /^\d{8,15}@c\.us$/.test(jid || '') ? jid.split('@')[0] : '';
}

module.exports = { COLUNAS, extrairDados, telefoneDoJid, semCpf };
