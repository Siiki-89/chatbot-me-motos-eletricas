const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { COLUNAS, extrairDados, telefoneDoJid, semCpf } = require('./dados-chamado');
const { normalizarIdMensagem } = require('./mensagem-id');

const EXTENSOES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/bmp': 'bmp', 'image/tiff': 'tiff',
  'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif',
  'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/jpg': 'jpg' };
const imagemSalva = /^[a-f0-9]{64}\.(jpg|png|webp|gif|bmp|tiff|heic|heif|avif|svg|ico|img)$/;
const pausa = ms => new Promise(resolve => setTimeout(resolve, ms));

// Excel não guarda fuso horário: grava a data/hora de São Paulo como data Excel.
function dataExcel(iso) {
  if (!iso || !Number.isFinite(new Date(iso).getTime())) return null;
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map(p => [p.type, p.value]));
  return new Date(`${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}:${partes.second}Z`);
}

function criarRegistros({ raiz = __dirname, logger = console, esperar = pausa } = {}) {
  const arquivo = path.join(raiz, 'chamados.xlsx');
  const modelo = path.join(__dirname, 'modelo-chamados.xlsx');
  let pendente = false;
  let timer;
  let executando;
  let ultimoErro = '';

  function pasta(protocolo) {
    if (!/^ME-\d+$/.test(protocolo || '')) throw new Error('Número de chamado inválido.');
    return path.join(raiz, 'Chamados', protocolo);
  }

  function listarImagens(protocolo) {
    const diretorio = pasta(protocolo);
    return fs.existsSync(diretorio) ? fs.readdirSync(diretorio).filter(n => imagemSalva.test(n)) : [];
  }

  async function salvarImagem(msg, protocolo) {
    if (!msg.hasMedia) return false;
    // Documentos podem ser imagens enviadas como arquivo, sem compressão.
    if (!['image', 'document', 'sticker'].includes(msg.type)) return false;
    const diretorio = pasta(protocolo);
    const id = normalizarIdMensagem(msg);
    if (!id) throw new Error(`[${protocolo}] Imagem sem identificador válido. Reenvie a imagem após reiniciar o bot.`);
    const chave = id && crypto.createHash('sha256').update(id).digest('hex');
    if (chave && listarImagens(protocolo).some(n => n.startsWith(chave + '.'))) return true;
    let media;
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      try {
        media = await msg.downloadMedia();
        if (!media?.data) throw new Error('Mídia indisponível no WhatsApp.');
        break;
      } catch (erro) {
        if (tentativa === 3) {
          const detalhe = erro?.message || String(erro);
          throw new Error(`[${protocolo}] Imagem não baixada (${id}) após 3 tentativas: ${detalhe}. Reenvie a imagem para tentar novamente.`);
        }
        await esperar(1000);
      }
    }
    const mime = String(media.mimetype || '').split(';')[0].toLowerCase();
    const ext = EXTENSOES[mime] || (mime.startsWith('image/') ? 'img' : null);
    if (!ext) return false;
    const bytes = Buffer.from(media.data, 'base64');
    if (!bytes.length) throw new Error('Imagem vazia.');
    const nome = `${chave || crypto.createHash('sha256').update(bytes).digest('hex')}.${ext}`;
    // Só cria a pasta depois de obter os bytes da imagem.
    fs.mkdirSync(diretorio, { recursive: true });
    const destino = path.join(diretorio, nome);
    if (!fs.existsSync(destino)) {
      fs.writeFileSync(destino + '.tmp', bytes);
      fs.renameSync(destino + '.tmp', destino);
      logger.log(`[Chamado ${protocolo}] Imagem salva: ${destino}`);
    }
    agendar();
    return true;
  }

  async function exportar() {
    const estadoPath = path.join(raiz, 'estado-bot.json');
    const estado = fs.existsSync(estadoPath) ? JSON.parse(fs.readFileSync(estadoPath, 'utf8')) : {};
    const registros = new Map(estado.chamados || []);
    for (const [numero, chamado] of estado.atendimentos || []) {
      if (chamado.protocolo && !registros.has(chamado.protocolo)) {
        registros.set(chamado.protocolo, { ...chamado, numero, status: 'aberto' });
      }
    }
    // Respeita o bloqueio criado pelo Excel. Os dados continuam no JSON.
    if (fs.existsSync(path.join(raiz, '~$chamados.xlsx'))) throw new Error('Feche chamados.xlsx no Excel para atualizar.');
    const original = fs.existsSync(arquivo) ? fs.readFileSync(arquivo) : null;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(original || fs.readFileSync(modelo));
    const sheet = workbook.getWorksheet('Chamados');
    if (!sheet || COLUNAS.some((c, i) => sheet.getCell(4, i + 1).value !== c)) {
      throw new Error('Cabeçalhos da planilha alterados. Restaure a linha 4 para sincronizar sem perder dados.');
    }
    const linhas = new Map();
    for (let n = 5; n <= sheet.rowCount; n++) {
      const id = sheet.getCell(n, 1).value;
      if (!id) continue;
      if (typeof id !== 'string' || !/^ME-\d+$/.test(id) || linhas.has(id)) {
        throw new Error('Chamado inválido ou duplicado na planilha. Corrija a coluna A.');
      }
      linhas.set(id, n);
    }
    let proxima = Math.max(5, sheet.rowCount + 1);
    for (const [id, c] of registros) {
      if (!/^ME-\d+$/.test(id)) continue;
      const n = linhas.get(id) || proxima++;
      const dados = { ...extrairDados(c.dadosInformados), ...c.dadosEstruturados };
      const telefone = c.telefone || telefoneDoJid(c.numero);
      const imgs = listarImagens(id);
      const faltantes = [];
      if (!telefone) faltantes.push('Telefone indisponível');
      if (c.setor === 'Assistência Técnica') {
        for (const [chave, rotulo] of [['notaFiscal', 'Nota Fiscal'], ['modelo', 'Modelo'], ['problema', 'Problema']]) {
          if (!dados[chave]) faltantes.push(rotulo);
        }
      }
      const status = { aberto: 'Em triagem', aguardando_atendente: 'Aguardando atendente', encerrado: 'Encerrado' };
      const motivos = { cliente: 'Cliente encerrou', loja: 'Loja encerrou',
        cliente_nao_continuou: 'Cliente não continuou', encaminhado_vendas: 'Encaminhado para vendas' };
      const valores = [id, dataExcel(c.criadoEm), semCpf(dados.nome || c.nomeCliente), telefone,
        c.setor || '', c.tipoAtendimento || '', semCpf(dados.notaFiscal), semCpf(dados.modelo),
        semCpf(dados.problema), status[c.status] || c.status || '', dataExcel(c.encerradoEm),
        motivos[c.motivo] || c.motivo || '', imgs.length, imgs.length ? path.join('Chamados', id) : '',
        faltantes.join(', ')];
      // Atualiza só A:O. As colunas P:U pertencem à equipe e são preservadas.
      valores.forEach((v, i) => { sheet.getCell(n, i + 1).value = v === '' ? null : v; });
      const row = sheet.getRow(n);
      row.height = Math.min(150, Math.max(44, Math.ceil(String(valores[8]).length / 48) * 14));
      for (let i = 1; i <= COLUNAS.length; i++) {
        const cell = row.getCell(i);
        cell.font = { name: 'Arial', size: 10, color: { argb: 'FF243447' } };
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i >= 16 ? 'FFFFF4D6' : n % 2 ? 'FFF1F5F9' : 'FFFFFFFF' } };
      }
      for (const i of [2, 11, 20]) row.getCell(i).numFmt = 'dd/mm/yyyy hh:mm';
      for (const i of [1, 4, 7]) row.getCell(i).numFmt = '@';
      row.getCell(13).numFmt = '0';
      row.getCell(19).dataValidation = { type: 'list', allowBlank: true,
        formulae: ['"Aguardando,Em análise,Aguardando peças,Em reparo,Concluído,Cancelado"'] };
    }
    sheet.autoFilter = { from: 'A4', to: `U${Math.max(4, sheet.rowCount)}` };
    sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }];
    const temporario = arquivo + '.tmp';
    await workbook.xlsx.writeFile(temporario);
    // Evita substituir alterações salvas pela equipe durante a geração.
    const atual = fs.existsSync(arquivo) ? fs.readFileSync(arquivo) : null;
    if ((original && (!atual || !original.equals(atual))) || (!original && atual) ||
        fs.existsSync(path.join(raiz, '~$chamados.xlsx'))) {
      throw new Error('Planilha em edição. A atualização será tentada novamente.');
    }
    fs.renameSync(temporario, arquivo);
  }

  async function sincronizar() {
    if (executando) { pendente = true; return executando; }
    executando = (async () => {
      do {
        pendente = false;
        try { await exportar(); ultimoErro = ''; }
        catch (erro) {
          pendente = true;
          if (erro.message !== ultimoErro) logger.error('Excel pendente:', erro.message);
          ultimoErro = erro.message;
          return false;
        }
      } while (pendente);
      return true;
    })();
    try { return await executando; } finally { executando = undefined; }
  }

  function agendar() {
    pendente = true;
    if (timer) return;
    timer = setTimeout(() => { timer = undefined; void sincronizar(); }, 500);
    timer.unref?.();
  }
  const retry = setInterval(() => { if (pendente) void sincronizar(); }, 30000);
  retry.unref?.();
  async function fechar() {
    clearTimeout(timer);
    clearInterval(retry);
    return sincronizar();
  }
  return { agendar, sincronizar, fechar, salvarImagem, listarImagens };
}

module.exports = { criarRegistros, dataExcel };
