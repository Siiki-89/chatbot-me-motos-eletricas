const fs = require("node:fs");
const path = require("node:path");

const protocolo = (process.argv[2] || "").trim().toUpperCase();
if (!protocolo || protocolo === "--HELP") {
  console.log("Uso: npm.cmd run chamado -- ME-000001");
} else if (!/^ME-\d+$/.test(protocolo)) {
  console.error("Informe um chamado no formato ME-000001.");
  process.exitCode = 1;
} else {
  try {
    const arquivo = path.join(__dirname, "estado-bot.json");
    const estado = JSON.parse(fs.readFileSync(arquivo, "utf8"));
    const chamado = new Map(estado.chamados || []).get(protocolo);
    if (!chamado) {
      console.log(`Chamado ${protocolo} não encontrado.`);
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(chamado, null, 2));
    }
  } catch (erro) {
    console.error("Não foi possível consultar o chamado:", erro.message);
    process.exitCode = 1;
  }
}
