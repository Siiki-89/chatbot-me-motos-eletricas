const { criarRegistros } = require('./registros');

const registros = criarRegistros();
registros.fechar().then(ok => {
  if (ok) console.log('Planilha atualizada: chamados.xlsx');
  else process.exitCode = 1;
}).catch(erro => { console.error(erro.message); process.exitCode = 1; });
