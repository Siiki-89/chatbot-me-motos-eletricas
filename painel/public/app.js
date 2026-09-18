'use strict';
const $ = selector => document.querySelector(selector);
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  inbox: '<path d="M4 4h16l2 12v4H2v-4L4 4Z"/><path d="M2 15h6l2 3h4l2-3h6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  chart: '<path d="M4 3v17h17M8 16v-4m5 4V7m5 9V4"/>',
  tool: '<path d="m14 6 4 4 3-3a7 7 0 0 1-9 9l-6 6-4-4 6-6a7 7 0 0 1 9-9Z"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z"/>',
  refresh: '<path d="M20 7a9 9 0 0 0-15-2L2 8m0-6v6h6M4 17a9 9 0 0 0 15 2l3-3m0 6v-6h-6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  right: '<path d="m9 5 7 7-7 7"/>', left: '<path d="m15 5-7 7 7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  box: '<path d="m12 2 10 5-10 5L2 7l10-5Zm0 10v10M2 7v10l10 5 10-5V7M7 4.5l10 5"/>',
  alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v.1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  bike: '<circle cx="5" cy="17" r="4"/><circle cx="19" cy="17" r="4"/><path d="m5 17 4-8h7l3 8M9 9l5 8H5m11-8-1-5h-3M8 6h4"/>',
  phone: '<path d="M5 3h4l2 5-3 2a14 14 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2C9 20 4 15 3 5a2 2 0 0 1 2-2Z"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  save: '<path d="M4 3h13l4 4v14H3V3h1Zm3 0v6h10V3M7 21v-8h10v8"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.inbox}</svg>`;
function icons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const statuses = ['Aguardando', 'Em análise', 'Aguardando peças', 'Em reparo', 'Concluído', 'Cancelado'];
const statusClass = value => ({ Aguardando: 'wait', 'Em análise': 'analysis', 'Aguardando peças': 'parts', 'Em reparo': 'repair', Concluído: 'done', Cancelado: 'cancel' }[value] || 'wait');
const badge = value => `<span class="badge ${statusClass(value)}">${esc(value)}</span>`;
const dataFormat = (value, time = false) => {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : { year: 'numeric' }) }).format(new Date(value.length === 10 ? value + 'T12:00:00Z' : value));
};
const phoneFormat = tel => tel?.length === 13 && tel.startsWith('55') ? `(${tel.slice(2, 4)}) ${tel.slice(4, 9)}-${tel.slice(9)}` : tel || 'Telefone não identificado';
const names = { overview: 'Visão geral', tickets: 'Chamados', photos: 'Galeria de imagens', reports: 'Indicadores' };
let realData = [], demoData = [], page = 'overview', demo = false, token = '', activeId = null, drawerTab = 'dados', dirty = false, saving = false;
let query = '', statusFilter = '', typeFilter = '', periodFilter = '', missingOnly = false, listPage = 1, toastTimer;
let originalTicket, draft = {}, loadSequence = 0, lastFetch = '', lastFocused;
const current = () => demo ? demoData : realData;
const assistencia = () => current().filter(c => c.setor === 'Assistência Técnica');
const open = c => !['Concluído', 'Cancelado'].includes(c.statusAssistencia);
const demoPhoto = label => `<div class="demo-photo">${icon('bike')}<span>${esc(label || 'Imagem ilustrativa')}</span></div>`;

function makeDemo() {
  const linhas = [
    ['Mariana Oliveira', 'ME Sport', 'Assistência Técnica / Garantia', 'Em análise', 'Rafael', 'A bateria descarrega mais rápido que o habitual.', 0, 2],
    ['Carlos Henrique', 'ME Urban', 'Manutenção', 'Aguardando peças', 'Gabriel', 'Ruído na roda traseira ao acelerar.', 1, 1],
    ['Juliana Santos', 'ME City', 'Manutenção', 'Em reparo', 'Rafael', 'Revisão dos freios e troca das pastilhas.', 1, 0],
    ['Pedro Almeida', 'ME Sport', 'Assistência Técnica / Garantia', 'Aguardando', '', 'Painel não acende após carregar a bateria.', 2, 2],
    ['Fernanda Lima', 'ME Urban', 'Manutenção', 'Concluído', 'Gabriel', 'Ajuste da suspensão dianteira.', 3, 1],
    ['Lucas Ribeiro', 'ME City', 'Assistência Técnica / Garantia', 'Em análise', 'Rafael', 'A moto perde potência em subidas.', 3, 0],
    ['Beatriz Costa', 'ME Sport', 'Manutenção', 'Concluído', 'Rafael', 'Revisão periódica e regulagem dos freios.', 4, 0],
    ['André Martins', 'ME Urban', 'Manutenção', 'Aguardando peças', 'Gabriel', 'Substituição do retrovisor.', 5, 1],
    ['Camila Souza', 'ME City', 'Manutenção', 'Concluído', 'Gabriel', 'Troca do pneu traseiro.', 6, 0],
    ['Bruno Ferreira', 'ME Sport', 'Assistência Técnica / Garantia', 'Em reparo', 'Rafael', 'Controlador apresenta falha intermitente.', 6, 1],
    ['Ana Paula', 'ME Urban', 'Manutenção', 'Aguardando', '', '', 7, 0],
    ['Diego Rocha', 'ME City', 'Manutenção', 'Concluído', 'Rafael', 'Manutenção preventiva.', 8, 0],
  ];
  return linhas.map((r, i) => {
    const id = `DEMO-${String(128 - i).padStart(6, '0')}`;
    const criado = new Date(Date.now() - r[6] * 86400000 - (i + 1) * 3600000).toISOString();
    const completo = r[3] === 'Concluído';
    return { id, nome: r[0], telefone: '', notaFiscal: i === 10 ? '' : String(12345 + i), modelo: r[1],
      tipo: r[2], statusAssistencia: r[3], responsavel: r[4], problema: r[5], setor: 'Assistência Técnica',
      diagnostico: ['Em reparo', 'Concluído'].includes(r[3]) ? 'Avaliação realizada pela equipe. Serviço definido e registrado.' : '',
      pecas: r[3] === 'Aguardando peças' ? 'Peça solicitada ao fornecedor. Aguardando previsão de entrega.' : '',
      observacoes: '', concluidoEm: completo ? new Date(Date.now() - (r[6] - 1) * 86400000).toISOString().slice(0, 10) : '',
      criadoEm: criado, atualizadoEm: criado, statusBot: 'aguardando_atendente', triagemEm: criado, revisao: 0,
      encerradoBotEm: '', motivoBot: '', historico: [], faltantes: i === 10 ? ['notaFiscal', 'problema'] : [],
      imagens: Array.from({ length: r[7] }, (_, n) => ({ nome: `exemplo-${n}`, url: '', demo: true, preview: true, tamanho: 0, criadoEm: criado })),
    };
  });
}

function toast(text, error = false) {
  clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').classList.toggle('error', error);
  $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
function empty(title, text = '', type = 'inbox') { return `<div class="empty"><span>${icon(type)}</span><strong>${esc(title)}</strong><p>${esc(text)}</p></div>`; }

async function loadData(manual = false) {
  const seq = ++loadSequence;
  try {
    const res = await fetch('/api/chamados', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha ao atualizar.');
    if (seq !== loadSequence) return;
    realData = data.chamados; token = data.token; lastFetch = data.atualizadoEm;
    $('#error-banner').hidden = !data.aviso; $('#error-banner').textContent = data.aviso || '';
    $('#sync-status').innerHTML = '<i></i>Atualização automática';
    $('#updated-at').textContent = `Atualizado às ${new Date(lastFetch).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    if (!demo) {
      renderStats();
      if (!$('#search') || document.activeElement !== $('#search')) renderContent(); else renderResults();
      $('#nav-count').textContent = realData.length;
    }
    if (manual) toast('Chamados atualizados.');
  } catch (err) {
    $('#error-banner').hidden = false; $('#error-banner').textContent = err.message;
    $('#sync-status').textContent = 'Sem conexão com o painel';
    if (manual) toast(err.message, true);
    if (!current().length) $('#content').innerHTML = empty('Não foi possível carregar os chamados', 'Confira se o terminal do painel está aberto.');
  }
}

function renderStats() {
  const data = assistencia();
  const ativos = data.filter(open).length, pecas = data.filter(c => c.statusAssistencia === 'Aguardando peças').length;
  const feitos = data.filter(c => c.statusAssistencia === 'Concluído').length;
  const values = [
    ['Total de chamados', data.length, 'inbox', '', 'Registrados na assistência'],
    ['Em andamento', ativos, 'tool', 'blue', 'Da triagem ao reparo'],
    ['Aguardando peças', pecas, 'box', 'amber', 'Acompanhar com o fornecedor'],
    ['Concluídos', feitos, 'check', 'green', `${data.length ? Math.round(feitos / data.length * 100) : 0}% dos chamados da assistência`],
  ];
  $('#stats').innerHTML = values.map(([title, number, ico, color, foot]) => `<article class="stat"><div class="stat-heading">${title}<span class="stat-icon ${color}">${icon(ico)}</span></div><div class="stat-number">${String(number).padStart(2, '0')}</div><div class="stat-foot">${foot}</div></article>`).join('');
  $('#stats').hidden = page === 'photos';
}

function render() {
  $('#breadcrumb').textContent = names[page]; $('#page-title').textContent = names[page];
  $('#eyebrow').textContent = ({ overview: 'SEU DIA NA ASSISTÊNCIA', tickets: 'DO PRIMEIRO CONTATO À CONCLUSÃO', photos: 'CADA DETALHE DO ATENDIMENTO', reports: 'DADOS PARA A SUA OPERAÇÃO' })[page];
  $('#page-subtitle').textContent = ({ overview: 'Acompanhe os chamados e organize os próximos atendimentos.',
    tickets: 'Consulte, atualize e acompanhe cada serviço em um só lugar.', photos: 'Todas as imagens recebidas, organizadas por chamado.',
    reports: 'Entenda a demanda e acompanhe o andamento da assistência.' })[page];
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  $('#real-mode').classList.toggle('selected', !demo); $('#demo-mode').classList.toggle('selected', demo);
  $('#banner').hidden = !demo;
  $('#banner').innerHTML = `${icon('alert')}<span><strong>Modo demonstração.</strong> Clientes, motos e atendimentos fictícios. Você pode editar livremente; os chamados reais não serão alterados.</span>`;
  $('#nav-count').textContent = current().length;
  renderStats(); renderContent();
}

function filtered() {
  return current().filter(c => {
    if (statusFilter && (c.statusAssistencia !== statusFilter || c.setor !== 'Assistência Técnica')) return false;
    if (typeFilter && (typeFilter === 'triagem' ? c.setor !== 'Em triagem' : typeFilter === 'vendas' ? c.setor !== 'Vendas' : !normalize(c.tipo).includes(typeFilter))) return false;
    if (missingOnly && (!c.faltantes.length || c.setor !== 'Assistência Técnica')) return false;
    if (periodFilter && Date.parse(c.criadoEm) < Date.now() - Number(periodFilter) * 86400000) return false;
    return !query || normalize([c.id, c.nome, c.telefone, c.modelo, c.notaFiscal, c.responsavel, c.problema].join(' ')).includes(normalize(query));
  });
}

function toolbar() {
  return `<div class="toolbar"><label class="search-wrap">${icon('search')}<input id="search" type="search" aria-label="Buscar chamados" placeholder="Buscar cliente, chamado ou modelo…" value="${esc(query)}"><kbd>/</kbd></label>
    <select class="filter" id="status-filter" aria-label="Filtrar por status"><option value="">Todos os status</option>${statuses.map(s => `<option ${statusFilter === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <select class="filter" id="type-filter" aria-label="Filtrar por tipo"><option value="">Todos os tipos</option>${[['manutencao', 'Manutenção'], ['garantia', 'Garantia'], ['vendas', 'Vendas'], ['triagem', 'Em triagem']].map(([v, label]) => `<option value="${v}" ${typeFilter === v ? 'selected' : ''}>${label}</option>`).join('')}</select>
    ${page === 'tickets' ? `<select class="filter" id="period-filter" aria-label="Filtrar por período"><option value="">Todo o período</option><option value="7" ${periodFilter === '7' ? 'selected' : ''}>Últimos 7 dias</option><option value="30" ${periodFilter === '30' ? 'selected' : ''}>Últimos 30 dias</option></select>` : ''}
    ${missingOnly ? '<button class="chip active" id="clear-missing">Dados a revisar ×</button>' : ''}</div>`;
}

function renderContent() {
  if (page === 'photos') return renderGallery();
  if (page === 'reports') return renderReports();
  const list = `<section class="panel"><div class="panel-heading"><div><h2>${page === 'overview' ? 'Chamados recentes' : 'Todos os chamados'}<span class="count" id="list-count">${current().length}</span></h2><p>${page === 'overview' ? 'Os últimos atendimentos recebidos pelo WhatsApp' : 'Clique em um chamado para ver os detalhes e atualizar o serviço'}</p></div>${page === 'overview' ? '<button class="button subtle" data-go="tickets">Ver todos ' + icon('right') + '</button>' : ''}</div>${toolbar()}<div id="list-results"></div></section>`;
  $('#content').innerHTML = page === 'overview' ? `<div class="overview-grid">${list}<aside class="right-column">${renderStages()}${renderAttention()}</aside></div>` : list;
  renderResults();
}

function renderResults() {
  if (!$('#list-results')) return;
  const data = filtered(), perPage = page === 'overview' ? 6 : 10;
  listPage = Math.max(1, Math.min(listPage, Math.ceil(data.length / perPage) || 1));
  const start = (listPage - 1) * perPage, visible = data.slice(start, start + perPage);
  $('#list-count').textContent = data.length;
  $('#list-results').innerHTML = !data.length ? empty('Nenhum chamado encontrado', 'Tente outra busca ou ajuste os filtros.') : `<div class="table-wrap"><table><thead><tr><th>CHAMADO / CLIENTE</th><th>MOTO / ATENDIMENTO</th><th>STATUS</th>${page === 'tickets' ? '<th>RESPONSÁVEL</th>' : ''}<th>RECEBIDO</th><th></th></tr></thead><tbody>${visible.map(c => `<tr data-ticket="${c.id}" tabindex="0" role="button" aria-label="Abrir chamado ${esc(c.id)} de ${esc(c.nome || 'cliente não identificado')}"><td><span class="ticket-id">#${c.id}</span><span class="customer">${esc(c.nome || 'Cliente não identificado')}</span><div class="customer-sub">${esc(phoneFormat(c.telefone))}</div></td><td><div class="model-name">${esc(c.modelo || 'Modelo não informado')}</div><div class="subtext">${esc(c.tipo.includes('Garantia') ? 'Garantia' : c.tipo || c.setor)}</div></td><td>${c.setor === 'Assistência Técnica' ? badge(c.statusAssistencia) : `<span class="badge">${esc(c.setor === 'Vendas' ? 'Vendas' : 'Em triagem')}</span>`}</td>${page === 'tickets' ? `<td>${esc(c.responsavel || 'Não atribuído')}</td>` : ''}<td><div class="subtext">${esc(dataFormat(c.criadoEm).replace(/ de /g, ' '))}</div><div class="img-count">${c.imagens.length ? icon('image') + c.imagens.length + (c.imagens.length === 1 ? ' imagem' : ' imagens') : 'Sem imagens'}</div></td><td class="arrow-cell">${icon('right')}</td></tr>`).join('')}</tbody></table></div><div class="table-footer"><span>Exibindo ${start + 1}–${Math.min(start + perPage, data.length)} de ${data.length} chamados</span><div class="pagination"><button data-paginate="-1" ${listPage === 1 ? 'disabled' : ''} aria-label="Página anterior">${icon('left')}</button><span>${listPage}</span><button data-paginate="1" ${start + perPage >= data.length ? 'disabled' : ''} aria-label="Próxima página">${icon('right')}</button></div></div>`;
}

function renderStages() {
  const data = assistencia().filter(open), total = data.length;
  return `<section class="panel"><div class="panel-heading"><div><h2>Fila por etapa</h2><p>${total} ${total === 1 ? 'serviço em andamento' : 'serviços em andamento'}</p></div>${icon('chart')}</div><div class="stages">${statuses.slice(0, 4).map(s => {
    const n = data.filter(c => c.statusAssistencia === s).length;
    return `<button class="stage" data-stage="${s}"><span class="stage-head"><span>${s}</span><strong>${String(n).padStart(2, '0')}</strong></span><span class="bar"><i class="${statusClass(s)}" style="width:${total ? n / total * 100 : 0}%"></i></span></button>`;
  }).join('')}</div></section>`;
}
function renderAttention() {
  const n = assistencia().filter(c => c.faltantes.length).length;
  return `<section class="panel attention"><div class="panel-heading"><h2>${icon('alert')}Atenção da equipe</h2></div><div class="attention-body"><strong>${String(n).padStart(2, '0')}</strong><p>${n ? 'Chamados com informações incompletas. Confira os dados do cliente e da moto.' : 'Todos os chamados têm os dados principais preenchidos.'}</p><button class="button subtle" id="review-missing">Revisar informações ${icon('right')}</button></div></section>`;
}

function allPhotos() { return current().flatMap(c => c.imagens.map((img, index) => ({ ...img, ticket: c, index }))); }
function photoCard(img, ticket, index) {
  return `<article class="gallery-card"><button class="gallery-thumb" data-photo-ticket="${ticket.id}" data-photo-index="${index}" aria-label="Ver imagem ${index + 1} do chamado ${ticket.id}">${img.demo ? demoPhoto() : img.preview ? `<img src="${esc(img.url)}" alt="Imagem ${index + 1} do chamado ${esc(ticket.id)}" loading="lazy">` : `<div class="demo-photo">${icon('image')}<span>Arquivo ${esc(img.nome.split('.').pop().toUpperCase())}</span></div>`}</button><div class="gallery-info"><strong>${esc(ticket.nome || ticket.id)}</strong><p>#${ticket.id} · ${dataFormat(img.criadoEm)}</p><div class="gallery-actions"><button data-open-photo-ticket="${ticket.id}">Ver chamado ${icon('right')}</button>${!img.demo ? `<a href="${esc(img.url)}?download=1" download aria-label="Baixar imagem">${icon('download')}</a>` : '<span>Exemplo</span>'}</div></div></article>`;
}
function renderGallery() {
  const imgs = allPhotos();
  $('#content').innerHTML = `<div class="section-intro"><h2>Imagens dos chamados <span class="count">${imgs.length}</span></h2><span>Novas imagens aparecem automaticamente</span></div>${imgs.length ? `<div class="gallery">${imgs.map(img => photoCard(img, img.ticket, img.index)).join('')}</div>` : `<section class="panel">${empty('As imagens aparecerão aqui', 'A primeira imagem recebida na assistência cria a pasta do chamado.', 'image')}</section>`}`;
}
function reportBars(title, subtitle, entries, note = '') {
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return `<section class="panel"><div class="panel-heading"><div><h2>${title}</h2><p>${subtitle}</p></div></div><div class="report-list">${entries.length ? entries.map(([name, n]) => `<div class="report-row"><div><span>${esc(name)}</span><strong>${n}</strong></div><div class="bar"><i style="width:${n / max * 100}%"></i></div></div>`).join('') : '<p class="subtext">Ainda não há dados suficientes.</p>'}</div>${note ? `<div class="report-note">${note}</div>` : ''}</section>`;
}
function renderReports() {
  const data = assistencia();
  const group = (arr, field, fallback) => Object.entries(arr.reduce((acc, c) => { const k = c[field] || fallback; acc[k] = (acc[k] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]);
  const done = data.filter(c => c.statusAssistencia === 'Concluído' && c.concluidoEm && c.criadoEm);
  const days = done.map(c => Math.max(0, (Date.parse(c.concluidoEm + 'T23:59:59-03:00') - Date.parse(c.criadoEm)) / 86400000));
  const avg = days.length ? (days.reduce((a, b) => a + b, 0) / days.length).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' dias' : 'Aguardando conclusões registradas';
  $('#content').innerHTML = `<div class="section-intro"><h2>Como está a sua assistência</h2><span>Todo o histórico disponível</span></div><div class="reports-grid">${reportBars('Distribuição por status', 'Chamados da assistência em cada etapa', statuses.map(s => [s, data.filter(c => c.statusAssistencia === s).length]))}${reportBars('Motos mais atendidas', 'Modelos registrados nos chamados', group(data, 'modelo', 'Modelo não informado').slice(0, 6))}${reportBars('Serviços por responsável', 'Somente chamados em andamento', group(data.filter(open), 'responsavel', 'Não atribuído'), 'Tempo médio da abertura à conclusão: <strong>' + avg + '</strong>. Calculado com os serviços concluídos que têm data registrada.')}${reportBars('Tipos de atendimento', 'Demanda de manutenção e garantia', group(data, 'tipo', 'Tipo não informado'), 'O encerramento da conversa no WhatsApp não conclui o serviço. O status da assistência é atualizado pela equipe.')}</div>`;
}

function changePage(next) { page = next; listPage = 1; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function setMode(value) {
  if (!closeDrawer()) return;
  demo = value; query = ''; statusFilter = ''; typeFilter = ''; periodFilter = ''; missingOnly = false; listPage = 1;
  render();
}
function openTicket(id) {
  if (activeId && !closeDrawer()) return;
  const c = current().find(c => c.id === id); if (!c) return;
  lastFocused = document.activeElement;
  originalTicket = structuredClone(c); draft = structuredClone(c); activeId = id; drawerTab = 'dados'; dirty = false;
  $('#drawer').hidden = false; $('#drawer-backdrop').hidden = false; document.body.style.overflow = 'hidden';
  renderDrawer(); $('#close-drawer').focus();
}
function closeDrawer() {
  if (saving) return false;
  if (dirty && !window.confirm('Há alterações não salvas. Deseja descartá-las?')) return false;
  $('#drawer').hidden = true; $('#drawer-backdrop').hidden = true; $('#lightbox').hidden = true;
  document.body.style.overflow = ''; activeId = null; dirty = false;
  if (lastFocused?.isConnected) lastFocused.focus();
  return true;
}
function field(key, label, wide = false, textarea = false, type = 'text') {
  return `<label class="field ${wide ? 'wide' : ''}">${label}${textarea ? `<textarea data-field="${key}" maxlength="8000" placeholder="Não informado">${esc(draft[key])}</textarea>` : `<input data-field="${key}" type="${type}" maxlength="200" value="${esc(draft[key])}" placeholder="Não informado">`}</label>`;
}
function renderDrawer() {
  const c = draft;
  $('#drawer').innerHTML = `<header class="drawer-header"><div class="drawer-title-row"><div><div class="drawer-kicker"><span>#${c.id}</span>${badge(c.statusAssistencia)}</div><h2>${esc(c.nome || 'Cliente não identificado')}</h2></div><button class="icon-button" id="close-drawer" aria-label="Fechar chamado">${icon('close')}</button></div><p class="drawer-summary">${esc(c.modelo || 'Modelo não informado')} · ${esc(c.tipo || c.setor)} · Recebido em ${dataFormat(c.criadoEm, true)}</p><nav class="drawer-tabs" aria-label="Seções do chamado">${[['dados', 'Dados do chamado'], ['fotos', `Imagens (${c.imagens.length})`], ['historico', 'Histórico']].map(([key, title]) => `<button data-tab="${key}" class="${drawerTab === key ? 'active' : ''}">${title}</button>`).join('')}</nav></header><div class="drawer-body">${drawerContent()}</div><footer class="drawer-footer"><p id="save-note">${dirty ? 'Você tem alterações não salvas.' : demo ? 'Alterações apenas na demonstração.' : c.revisao ? 'Última edição: ' + dataFormat(c.atualizadoEm, true) : 'Dados recebidos pelo WhatsApp.'}</p><div class="actions"><button class="button secondary" id="cancel-edit">Fechar</button><button class="button primary" id="save-ticket" ${!dirty || saving ? 'disabled' : ''}>${icon('save')}${saving ? 'Salvando…' : 'Salvar alterações'}</button></div></footer>`;
}
function drawerContent() {
  const c = draft;
  if (drawerTab === 'fotos') return c.imagens.length ? `<div class="gallery">${c.imagens.map((img, i) => photoCard(img, c, i)).join('')}</div>` : empty('Nenhuma imagem neste chamado', 'As imagens recebidas durante a assistência serão exibidas aqui.', 'image');
  if (drawerTab === 'historico') {
    const eventos = [{ em: c.criadoEm, title: 'Chamado aberto', description: 'Atendimento recebido pelo WhatsApp.' }];
    if (c.triagemEm) eventos.push({ em: c.triagemEm, title: 'Triagem recebida', description: 'Cliente aguardando a equipe de assistência.' });
    if (c.encerradoBotEm) eventos.push({ em: c.encerradoBotEm, title: 'Conversa com o bot encerrada', description: 'O andamento do serviço é acompanhado separadamente.' });
    for (const img of c.imagens) eventos.push({ em: img.criadoEm, title: 'Imagem recebida', description: 'Disponível na aba Imagens.' });
    for (const e of c.historico) eventos.push({ em: e.em, title: e.status ? `Serviço: ${e.status}` : 'Chamado atualizado', description: `Campos: ${e.campos.join(', ')}.` });
    eventos.sort((a, b) => b.em.localeCompare(a.em));
    return `<div class="timeline">${eventos.map(e => `<div class="timeline-item"><strong>${esc(e.title)}</strong><p>${esc(e.description)}</p><small>${dataFormat(e.em, true)}</small></div>`).join('')}</div>`;
  }
  return `<div class="context-note">${icon('inbox')}<span>${c.statusBot === 'encerrado' ? 'A conversa com o bot foi encerrada.' : c.statusBot === 'aguardando_atendente' ? 'O cliente já passou pela triagem e aguarda a equipe.' : 'O cliente está na triagem do WhatsApp.'} O status abaixo acompanha o serviço da assistência.</span></div><section class="form-section"><h3>${icon('user')}Cliente e moto</h3><div class="form-grid">${field('nome', 'Nome do cliente')}${field('telefone', 'Telefone com DDI e DDD', false, false, 'tel')}${field('notaFiscal', 'Nº da Nota Fiscal')}${field('modelo', 'Modelo da moto')}${field('problema', 'Problema relatado pelo cliente', true, true)}</div>${c.telefone && !demo ? `<a class="phone-link" href="https://wa.me/${encodeURIComponent(c.telefone)}" target="_blank" rel="noopener noreferrer">${icon('phone')}Abrir conversa no WhatsApp ${icon('external')}</a>` : ''}</section><section class="form-section"><h3>${icon('tool')}Acompanhamento do serviço</h3><div class="form-grid"><label class="field">Status da assistência<select data-field="statusAssistencia">${statuses.map(s => `<option ${c.statusAssistencia === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>${field('responsavel', 'Responsável pelo atendimento')}${field('diagnostico', 'Diagnóstico técnico', true, true)}${field('pecas', 'Peças utilizadas ou necessárias', true, true)}${field('concluidoEm', 'Data de conclusão', false, false, 'date')}${field('observacoes', 'Observações da equipe', true, true)}</div></section>`;
}

async function saveTicket() {
  if (!dirty || saving) return;
  const campos = {};
  for (const key of ['nome', 'telefone', 'notaFiscal', 'modelo', 'problema', 'diagnostico', 'pecas', 'responsavel', 'statusAssistencia', 'concluidoEm', 'observacoes']) {
    if (draft[key] !== originalTicket[key]) campos[key] = draft[key] || '';
  }
  saving = true; $('#save-ticket').disabled = true; $('#save-ticket').textContent = 'Salvando…';
  try {
    let salvo;
    if (demo) {
      salvo = { ...draft, revisao: draft.revisao + 1, atualizadoEm: new Date().toISOString() };
      if (salvo.statusAssistencia === 'Concluído' && !salvo.concluidoEm) salvo.concluidoEm = new Date().toISOString().slice(0, 10);
      salvo.faltantes = ['nome', 'notaFiscal', 'modelo', 'problema'].filter(k => !salvo[k]);
      salvo.historico.push({ em: salvo.atualizadoEm, campos: Object.keys(campos), status: campos.statusAssistencia || null });
      demoData = demoData.map(c => c.id === activeId ? salvo : c);
    } else {
      const response = await fetch(`/api/chamados/${activeId}`, { method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Painel-Token': token },
        body: JSON.stringify({ revisao: originalTicket.revisao, campos }) });
      salvo = await response.json();
      if (!response.ok) throw new Error(salvo.erro || 'Não foi possível salvar.');
      realData = realData.map(c => c.id === activeId ? salvo : c);
    }
    dirty = false; draft = structuredClone(salvo); originalTicket = structuredClone(salvo);
    render(); toast(demo ? 'Exemplo atualizado. Os dados reais permanecem intactos.' : 'Alterações salvas no chamado.');
  } catch (error) { toast(error.message, true); }
  finally { saving = false; renderDrawer(); }
}

function showPhoto(id, index) {
  const c = current().find(c => c.id === id), img = c?.imagens[index];
  if (!img) return;
  if (!img.demo && !img.preview) { window.open(img.url + '?download=1', '_blank', 'noopener'); return; }
  $('#lightbox').innerHTML = `<button class="icon-button" id="close-lightbox" aria-label="Fechar imagem">${icon('close')}</button>${img.demo ? demoPhoto('Exemplo visual — nenhuma imagem real') : `<a class="button secondary" href="${esc(img.url)}?download=1" download>${icon('download')}Baixar imagem</a><img src="${esc(img.url)}" alt="Imagem do chamado ${c.id}">`}`;
  $('#lightbox').hidden = false; $('#close-lightbox').focus();
}

document.addEventListener('click', event => {
  const t = event.target;
  const nav = t.closest('[data-page]'); if (nav) return changePage(nav.dataset.page);
  const go = t.closest('[data-go]'); if (go) return changePage(go.dataset.go);
  const stage = t.closest('[data-stage]'); if (stage) { statusFilter = stage.dataset.stage; return changePage('tickets'); }
  const pag = t.closest('[data-paginate]'); if (pag) { listPage += Number(pag.dataset.paginate); return renderResults(); }
  const ticket = t.closest('[data-ticket]'); if (ticket) return openTicket(ticket.dataset.ticket);
  const photo = t.closest('[data-photo-ticket]'); if (photo) return showPhoto(photo.dataset.photoTicket, Number(photo.dataset.photoIndex));
  const photoTicket = t.closest('[data-open-photo-ticket]'); if (photoTicket) return openTicket(photoTicket.dataset.openPhotoTicket);
  const tab = t.closest('[data-tab]'); if (tab) { drawerTab = tab.dataset.tab; return renderDrawer(); }
  if (t.closest('#refresh')) return loadData(true);
  if (t.closest('#real-mode')) return setMode(false);
  if (t.closest('#demo-mode')) return setMode(true);
  if (t.closest('#review-missing')) { missingOnly = true; statusFilter = ''; typeFilter = ''; return changePage('tickets'); }
  if (t.closest('#clear-missing')) { missingOnly = false; return renderContent(); }
  if (t.closest('#close-drawer,#cancel-edit') || t.id === 'drawer-backdrop') return closeDrawer();
  if (t.closest('#save-ticket')) return saveTicket();
  if (t.closest('#close-lightbox') || t.id === 'lightbox') { $('#lightbox').hidden = true; return; }
  if (t.closest('#export')) {
    if (demo) return toast('Selecione Dados reais para exportar os chamados da assistência.');
    window.location.href = '/api/exportar.csv';
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'search') { query = event.target.value; listPage = 1; renderResults(); }
  if (event.target.dataset.field) {
    draft[event.target.dataset.field] = event.target.value;
    dirty = true; $('#save-ticket').disabled = false; $('#save-note').textContent = 'Você tem alterações não salvas.';
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'status-filter') statusFilter = event.target.value;
  else if (event.target.id === 'type-filter') typeFilter = event.target.value;
  else if (event.target.id === 'period-filter') periodFilter = event.target.value;
  else return;
  listPage = 1; renderResults();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!$('#lightbox').hidden) $('#lightbox').hidden = true; else closeDrawer();
  }
  if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { event.preventDefault(); $('#search')?.focus(); }
  if (event.key === 'Enter' && event.target.dataset.ticket) openTicket(event.target.dataset.ticket);
  const modal = !$('#lightbox').hidden ? $('#lightbox') : !$('#drawer').hidden ? $('#drawer') : null;
  if (event.key === 'Tab' && modal) {
    const focusable = [...modal.querySelectorAll('button:not(:disabled),input,textarea,select,a[href]')];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
icons(); demoData = makeDemo();
const initial = new URLSearchParams(location.search);
demo = initial.get('demo') === '1';
render(); void loadData();
setInterval(() => { if (!document.hidden) void loadData(); }, 15000);
