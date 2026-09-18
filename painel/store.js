const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { extrairDados, telefoneDoJid, semCpf } = require('../dados-chamado');

const STATUS = ['Aguardando', 'Em análise', 'Aguardando peças', 'Em reparo', 'Concluído', 'Cancelado'];
const CAMPOS = ['nome', 'telefone', 'notaFiscal', 'modelo', 'problema', 'diagnostico', 'pecas',
  'responsavel', 'statusAssistencia', 'concluidoEm', 'observacoes'];
const ROTULOS = { nome: 'Cliente', telefone: 'Telefone', notaFiscal: 'Nota Fiscal', modelo: 'Modelo',
  problema: 'Problema', diagnostico: 'Diagnóstico', pecas: 'Peças', responsavel: 'Responsável',
  statusAssistencia: 'Status da assistência', concluidoEm: 'Conclusão', observacoes: 'Observações' };
const imagemRegex = /^[a-f0-9]{64}\.(jpg|png|webp|gif|bmp|tiff|heic|heif|avif|svg|ico|img)$/;

function erro(message, status = 400) { return Object.assign(new Error(message), { status }); }
function lerJson(arquivo, fallback) {
  return fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, 'utf8')) : fallback;
}
function textoCelula(value) {
  if (value == null) return '';
  if (typeof value === 'object') return value.text || value.richText?.map(t => t.text).join('') || '';
  return String(value);
}

function criarStore(raiz) {
  const arquivo = path.join(raiz, 'painel-dados.json');
  let cacheExcel = { chave: '', dados: new Map(), aviso: '' };

  function lerPainel() {
    const dados = lerJson(arquivo, { versao: 1, chamados: {} });
    if (dados.versao !== 1 || !dados.chamados || typeof dados.chamados !== 'object' || Array.isArray(dados.chamados)) {
      throw erro('O arquivo de dados do painel é inválido. Restaure um backup antes de continuar.', 500);
    }
    return dados;
  }

  async function lerExcel() {
    const file = path.join(raiz, 'chamados.xlsx');
    if (!fs.existsSync(file)) return { dados: new Map(), aviso: '' };
    const stat = fs.statSync(file), chave = `${stat.mtimeMs}-${stat.size}`;
    if (cacheExcel.chave === chave) return cacheExcel;
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file);
      const sheet = wb.getWorksheet('Chamados');
      if (!sheet || sheet.getCell('A4').value !== 'Chamado') throw new Error('Layout não reconhecido');
      const dados = new Map();
      for (let i = 5; i <= sheet.rowCount; i++) {
        const id = sheet.getCell(i, 1).value;
        if (!/^ME-\d+$/.test(id || '')) continue;
        const campos = {};
        for (const [col, campo] of [[16, 'diagnostico'], [17, 'pecas'], [18, 'responsavel'],
          [19, 'statusAssistencia'], [21, 'observacoes']]) {
          const valor = textoCelula(sheet.getCell(i, col).value);
          if (valor && (campo !== 'statusAssistencia' || STATUS.includes(valor))) campos[campo] = semCpf(valor);
        }
        const conclusao = sheet.getCell(i, 20).value;
        if (conclusao instanceof Date) campos.concluidoEm = conclusao.toISOString().slice(0, 10);
        dados.set(id, campos);
      }
      cacheExcel = { chave, dados, aviso: '' };
    } catch {
      return { dados: cacheExcel.dados, aviso: 'Não foi possível ler os preenchimentos salvos no Excel. Os dados do painel continuam disponíveis.' };
    }
    return cacheExcel;
  }

  function anexos(id) {
    const pasta = path.join(raiz, 'Chamados', id);
    if (!fs.existsSync(pasta)) return [];
    return fs.readdirSync(pasta).filter(n => imagemRegex.test(n)).map(nome => {
      const stat = fs.statSync(path.join(pasta, nome));
      return { nome, url: `/api/imagens/${id}/${nome}`, tamanho: stat.size,
        criadoEm: stat.birthtime.toISOString(), preview: /\.(jpg|png|webp|gif|avif|bmp|ico)$/.test(nome) };
    }).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  }

  async function listar() {
    const estado = lerJson(path.join(raiz, 'estado-bot.json'), {});
    const painel = lerPainel();
    const excel = await lerExcel();
    const todos = new Map(estado.chamados || []);
    let semProtocolo = 0;
    for (const [numero, c] of estado.atendimentos || []) {
      if (!c.protocolo) { semProtocolo++; continue; }
      if (!todos.has(c.protocolo)) todos.set(c.protocolo, { ...c, numero,
        status: (estado.botSilenciado || []).includes(numero) ? 'aguardando_atendente' : 'aberto' });
    }
    const chamados = [...todos].filter(([id]) => /^ME-\d+$/.test(id)).map(([id, c]) => {
      const recebidos = { ...extrairDados(c.dadosInformados), ...c.dadosEstruturados };
      const salvo = painel.chamados[id] || {};
      const base = { nome: semCpf(recebidos.nome || c.nomeCliente), telefone: c.telefone || telefoneDoJid(c.numero),
        notaFiscal: semCpf(recebidos.notaFiscal), modelo: semCpf(recebidos.modelo), problema: semCpf(recebidos.problema),
        diagnostico: '', pecas: '', responsavel: '', statusAssistencia: 'Aguardando', concluidoEm: '', observacoes: '',
        ...excel.dados.get(id), ...salvo.campos };
      const imagens = anexos(id);
      const faltantes = ['nome', 'telefone', 'notaFiscal', 'modelo', 'problema'].filter(k => !base[k]);
      return { id, ...base, setor: c.setor || 'Em triagem', tipo: c.tipoAtendimento || '',
        criadoEm: c.criadoEm || '', encerradoBotEm: c.encerradoEm || '', statusBot: c.status || 'aberto',
        motivoBot: c.motivo || '', triagemEm: c.triagemFinalizadaEm || '',
        atualizadoEm: salvo.atualizadoEm || c.triagemFinalizadaEm || c.encerradoEm || c.criadoEm || '',
        revisao: salvo.revisao || 0, origemEquipe: salvo.revisao ? 'painel' : excel.dados.has(id) ? 'excel' : '',
        historico: salvo.historico || [], imagens, faltantes };
    }).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm) || b.id.localeCompare(a.id));
    return { chamados, semProtocolo, aviso: excel.aviso, atualizadoEm: new Date().toISOString() };
  }

  async function atualizar(id, body) {
    if (!/^ME-\d+$/.test(id)) throw erro('Chamado inválido.');
    if (!Number.isSafeInteger(body.revisao) || body.revisao < 0) throw erro('Revisão inválida.');
    const atual = (await listar()).chamados.find(c => c.id === id);
    if (!atual) throw erro('Chamado não encontrado.', 404);
    const campos = {};
    for (const [campo, valor] of Object.entries(body.campos || {})) {
      if (!CAMPOS.includes(campo) || typeof valor !== 'string') throw erro('Campo inválido.');
      if (valor.length > (['problema', 'diagnostico', 'pecas', 'observacoes'].includes(campo) ? 8000 : 200)) {
        throw erro(`O campo ${ROTULOS[campo]} excedeu o tamanho permitido.`);
      }
      campos[campo] = campo === 'telefone' ? valor.replace(/[\s()+.-]/g, '') : semCpf(valor.trim());
    }
    if (campos.telefone && !/^\d{8,15}$/.test(campos.telefone)) throw erro('Informe o telefone com DDI e DDD, somente números.');
    if (campos.statusAssistencia !== undefined && !STATUS.includes(campos.statusAssistencia)) throw erro('Status inválido.');
    if (campos.concluidoEm && (!/^\d{4}-\d{2}-\d{2}$/.test(campos.concluidoEm) ||
      !Number.isFinite(Date.parse(campos.concluidoEm)) || new Date(campos.concluidoEm).toISOString().slice(0, 10) !== campos.concluidoEm)) {
      throw erro('Data de conclusão inválida.');
    }
    const dados = lerPainel(); // Releitura após os awaits para detectar outra edição.
    const anterior = dados.chamados[id] || { revisao: 0, campos: {}, historico: [] };
    if (anterior.revisao !== body.revisao) throw erro('Este chamado foi alterado em outra janela. Recarregue antes de salvar.', 409);
    const alterados = Object.keys(campos).filter(k => campos[k] !== atual[k]);
    if (!alterados.length) return atual;
    if (campos.statusAssistencia === 'Concluído' && !campos.concluidoEm && !atual.concluidoEm) {
      campos.concluidoEm = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      alterados.push('concluidoEm');
    }
    const agora = new Date().toISOString();
    // A edição do painel fica em arquivo próprio: não disputa a escrita com o bot.
    dados.chamados[id] = { revisao: anterior.revisao + 1, campos: { ...anterior.campos, ...campos }, atualizadoEm: agora,
      historico: [...(anterior.historico || []), { id: crypto.randomUUID(), em: agora,
        campos: alterados.map(k => ROTULOS[k]), status: campos.statusAssistencia || null }].slice(-200) };
    fs.writeFileSync(arquivo + '.tmp', JSON.stringify(dados, null, 2));
    fs.renameSync(arquivo + '.tmp', arquivo);
    return (await listar()).chamados.find(c => c.id === id);
  }

  function imagem(id, nome) {
    if (!/^ME-\d+$/.test(id) || !imagemRegex.test(nome)) throw erro('Imagem não encontrada.', 404);
    const base = path.resolve(raiz, 'Chamados');
    const file = path.resolve(base, id, nome);
    if (!fs.existsSync(file) || !fs.realpathSync(file).startsWith(base + path.sep)) throw erro('Imagem não encontrada.', 404);
    return file;
  }
  return { listar, atualizar, imagem };
}

function csv(chamados) {
  const cols = [['Chamado', 'id'], ['Abertura', 'criadoEm'], ['Cliente', 'nome'], ['Telefone', 'telefone'],
    ['Nota Fiscal', 'notaFiscal'], ['Modelo', 'modelo'], ['Problema', 'problema'], ['Tipo', 'tipo'],
    ['Status da assistência', 'statusAssistencia'], ['Responsável', 'responsavel'], ['Diagnóstico', 'diagnostico'],
    ['Peças', 'pecas'], ['Conclusão', 'concluidoEm'], ['Observações', 'observacoes']];
  const celula = value => {
    let s = String(value ?? '');
    if (/^\s*[=+@\-]|^[\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return '\uFEFF' + [cols.map(([titulo]) => celula(titulo)).join(';'),
    ...chamados.map(c => cols.map(([, key]) => celula(c[key])).join(';'))].join('\r\n');
}

module.exports = { criarStore, STATUS, CAMPOS, csv };
