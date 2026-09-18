import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool';
const require = createRequire(import.meta.url);
const { COLUNAS } = require('../dados-chamado.js');
const revisar = process.argv.includes('--revisar');
const workbook = revisar
  ? await SpreadsheetFile.importXlsx(await FileBlob.load('C:/ME-Motos/chamados.xlsx'))
  : Workbook.create();
if (!revisar) {
  const sheet = workbook.worksheets.add('Chamados');
  sheet.showGridLines = false;
  sheet.tabColor = '#243447';
  sheet.getRange('A1:U4').format.font = { name: 'Arial', size: 10, color: '#243447' };
  sheet.getRange('A2').values = [['ME Motos — Registro de chamados']];
  sheet.getRange('A2').format.font = { name: 'Arial', size: 15, bold: true };
  sheet.getRange('A3').values = [['Dados automáticos até O. Preenchimento da equipe em P:U (amarelo). Datas no horário de São Paulo.']];
  sheet.getRange('A3').format.font = { name: 'Arial', size: 10, italic: true, color: '#64748B' };
  sheet.getRange('A4:U4').values = [COLUNAS];
  sheet.getRange('A4:U4').format = { fill: '#243447', font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' },
    wrapText: true, horizontalAlignment: 'center', verticalAlignment: 'center', rowHeight: 34 };
  sheet.getRange('P4:U4').format.fill = '#765617';
  const larguras = [17, 23, 26, 22, 24, 29, 22, 24, 55, 25, 23, 30, 17, 28, 36, 40, 32, 24, 26, 24, 48];
  larguras.forEach((largura, i) => {
    sheet.getRangeByIndexes(0, i, 4, 1).format.columnWidth = largura;
  });
  sheet.freezePanes.freezeRows(4);
  sheet.freezePanes.freezeColumns(1);
}
workbook.recalculate();
console.log((await workbook.inspect({ kind: 'table', range: 'Chamados!A4:U4', tableMaxRows: 1, tableMaxCols: 21, maxChars: 2000 })).ndjson);
for (const [nome, range] of [['inicio', 'A1:H8'], ['dados', 'I4:O8'], ['equipe', 'P4:U8']]) {
  const preview = await workbook.render({ sheetName: 'Chamados', range, scale: 1.3, format: 'png' });
  await fs.writeFile(`C:/ME-Motos/.artifacts/${revisar ? 'final' : 'modelo'}-${nome}.png`, new Uint8Array(await preview.arrayBuffer()));
}
if (!revisar) {
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save('C:/ME-Motos/modelo-chamados.xlsx');
  execFileSync('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',
    ['C:/ME-Motos/.artifacts/normalizar-xlsx.py', 'C:/ME-Motos/modelo-chamados.xlsx']);
}
