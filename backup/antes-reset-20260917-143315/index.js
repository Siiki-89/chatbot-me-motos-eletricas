// =====================================
// IMPORTAÇÕES
// =====================================
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const fs = require("fs");
const path = require("path");

// =====================================
// CONFIGURAÇÃO DO CLIENTE
// =====================================
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, ".wwebjs_auth") }),
  webVersionCache: { type: "local", path: path.join(__dirname, ".wwebjs_cache") },

  puppeteer: {
    headless: true,

    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  },
});

// =====================================
// NÚMERO DO VENDEDOR
// Gabriel: (47) 99165-1258
// =====================================
const numeroVendas = "5547991651258";

const mensagemVendas =
  "Olá Gabriel! Vim pelo atendimento da ME Motos Elétricas e gostaria de falar sobre vendas.";

// =====================================
// ARQUIVO DE ESTADO
// =====================================
const estadoPrincipal = path.join(__dirname, "estado-bot.json");
const estadoAnterior = path.join(__dirname, "bot-assistencia", "estado-bot.json");
const ARQUIVO_ESTADO = fs.existsSync(estadoPrincipal) || !fs.existsSync(estadoAnterior)
  ? estadoPrincipal : estadoAnterior;
const ignorarContatosSalvos = process.env.IGNORAR_CONTATOS_SALVOS === "true";

// =====================================
// MEMÓRIA DO BOT
// =====================================
let atendimentos = new Map();

let botSilenciado = new Set();

let redirecionadosVendas = new Map();

// =====================================
// CARREGA ESTADO
// =====================================
function carregarEstado() {
  try {
    if (!fs.existsSync(ARQUIVO_ESTADO)) {
      return;
    }

    const dados = JSON.parse(
      fs.readFileSync(
        ARQUIVO_ESTADO,
        "utf8"
      )
    );

    if (dados.atendimentos) {
      atendimentos = new Map(
        dados.atendimentos
      );
    }

    if (dados.botSilenciado) {
      botSilenciado = new Set(
        dados.botSilenciado
      );
    }

    if (dados.redirecionadosVendas) {
      redirecionadosVendas = new Map(dados.redirecionadosVendas);
    }

    console.log(
      "Estado anterior carregado."
    );

  } catch (error) {

    console.error(
      "Erro ao carregar estado:",
      error.message
    );

  }
}

// =====================================
// SALVA ESTADO
// =====================================
function salvarEstado() {
  try {
    const dados = {
      redirecionadosVendas: Array.from(redirecionadosVendas.entries()),
      atendimentos:
        Array.from(
          atendimentos.entries()
        ),

      botSilenciado:
        Array.from(
          botSilenciado
        ),
    };

    fs.writeFileSync(
      ARQUIVO_ESTADO + ".tmp",

      JSON.stringify(
        dados,
        null,
        2
      )
    );
    fs.renameSync(ARQUIVO_ESTADO + ".tmp", ARQUIVO_ESTADO);

  } catch (error) {

    console.error(
      "Erro ao salvar estado:",
      error.message
    );

  }
}

carregarEstado();

// =====================================
// NORMALIZA TEXTO
// =====================================
function normalizarTexto(texto = "") {
  return texto

    .normalize("NFD")

    .replace(
      /[\u0300-\u036f]/g,
      ""
    )

    .toLowerCase()

    .trim()

    .replace(
      /\s+/g,
      " "
    );
}

// =====================================
// DELAY
// =====================================
const delay = (ms) =>
  new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );

// =====================================
// ENVIA MENSAGEM
//
// Não utiliza msg.getChat().
// =====================================
async function enviarMensagem(
  numero,
  mensagem
) {
  try {
    await delay(700);

    await client.sendMessage(
      numero,
      mensagem,
      { sendSeen: false }
    );

    return true;

  } catch (error) {

    console.error(
      `Erro ao enviar mensagem para ${numero}:`,
      error.message
    );

    throw error;
  }
}

// =====================================
// SAUDAÇÃO
// =====================================
function obterSaudacao() {
  const horaTexto =
    new Intl.DateTimeFormat(
      "pt-BR",
      {
        hour: "2-digit",
        hour12: false,
        timeZone:
          "America/Sao_Paulo",
      }
    ).format(
      new Date()
    );

  const hora =
    Number(horaTexto) % 24;

  if (
    hora >= 5 &&
    hora < 12
  ) {
    return "Bom dia";
  }

  if (
    hora >= 12 &&
    hora < 18
  ) {
    return "Boa tarde";
  }

  return "Boa noite";
}

// =====================================
// QR CODE
// =====================================
client.on(
  "qr",

  (qr) => {

    console.log(
      "Escaneie o QR Code abaixo:"
    );

    qrcode.generate(
      qr,
      {
        small: true,
      }
    );
  }
);

// =====================================
// CONECTADO
// =====================================
client.on(
  "ready",

  () => {

    console.log(
      "WhatsApp da ME Motos Elétricas conectado."
    );

  }
);

// =====================================
// AUTENTICADO
// =====================================
client.on(
  "authenticated",

  () => {

    console.log(
      "WhatsApp autenticado."
    );

  }
);

// =====================================
// FALHA DE AUTENTICAÇÃO
// =====================================
client.on(
  "auth_failure",

  (mensagem) => {

    console.error(
      "Falha de autenticação:",
      mensagem
    );

  }
);

// =====================================
// DESCONEXÃO
// =====================================
client.on(
  "disconnected",

  (reason) => {

    console.log(
      "WhatsApp desconectado:",
      reason
    );

  }
);

// =====================================
// INICIALIZA
// =====================================
console.log(
  "Iniciando WhatsApp da ME Motos Elétricas..."
);

async function inicializarWhatsApp() {
  const maxTentativas = 3;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      await client.initialize();
      return;
    } catch (erro) {
      const mensagem = String(erro?.message || erro);
      const contextoDestruido = /Execution context was destroyed|Cannot find context with specified id/i.test(mensagem);

      // Fecha o navegador antes de reutilizar o perfil salvo pelo LocalAuth.
      // destroy() preserva a sessao; logout() apagaria a autenticacao.
      if (client.pupBrowser) {
        try {
          await client.destroy();
        } catch (erroFechamento) {
          throw new Error(
            'Falha ao fechar o navegador. Encerre a instancia anterior antes de reiniciar o bot.',
            { cause: erroFechamento }
          );
        }
      }

      if (!contextoDestruido || tentativa === maxTentativas) {
        throw erro;
      }

      console.warn(
        `O WhatsApp Web recarregou durante a inicializacao (${tentativa}/${maxTentativas}). Nova tentativa em 5 segundos.`
      );
      await delay(5000);
    }
  }
}

inicializarWhatsApp().catch((erro) => {
  console.error('Nao foi possivel iniciar o WhatsApp:', erro);
  process.exitCode = 1;
});

// =====================================================
// MENSAGENS RECEBIDAS
// =====================================================
// Serializa eventos de cada cliente e só confirma a etapa após o envio.
const filas = new Map();
function enfileirar(numero, executar) {
  if (!numero) return Promise.resolve();
  const tarefa = (filas.get(numero) || Promise.resolve()).then(async () => {
    const anterior = atendimentos.has(numero)
      ? JSON.parse(JSON.stringify(atendimentos.get(numero))) : undefined;
    const silenciado = botSilenciado.has(numero);
    const vendas = redirecionadosVendas.get(numero);
    try {
      await executar();
      salvarEstado();
    } catch (erro) {
      if (anterior === undefined) atendimentos.delete(numero);
      else atendimentos.set(numero, anterior);
      if (silenciado) botSilenciado.add(numero);
      else botSilenciado.delete(numero);
      if (vendas === undefined) redirecionadosVendas.delete(numero);
      else redirecionadosVendas.set(numero, vendas);
      salvarEstado();
      console.error("Etapa preservada para nova tentativa:", erro.message);
    }
  });
  filas.set(numero, tarefa);
  return tarefa.finally(() => {
    if (filas.get(numero) === tarefa) filas.delete(numero);
  });
}

client.on(
  "message",

  (msg) => enfileirar(msg.from, async () => {

    try {

      // =====================================
      // VALIDA REMETENTE
      // =====================================
      if (!msg.from || msg.fromMe || !/@(?:c\.us|lid)$/.test(msg.from)) {
        return;
      }

      const numero =
        msg.from;
      // =====================================
      // Filtro opcional: IGNORAR_CONTATOS_SALVOS=true.
      // Por padrão, clientes salvos também recebem atendimento.
      // =====================================

      if (ignorarContatosSalvos) try {
      
        const contato = await msg.getContact();
      
        if (contato && contato.isMyContact) {
      
          console.log(
            `Contato salvo ignorado: ${
              contato.name ||
              contato.pushname ||
              contato.number ||
              numero
            }`
          );
      
          return;
        }
      
      } catch (erroContato) {
      
        console.log(
          "Não foi possível verificar se o contato está salvo:",
          erroContato.message
        );
      
      }
      // =====================================
      // IGNORA MENSAGENS DA PRÓPRIA ME
      // =====================================
      if (msg.fromMe) {
        return;
      }

      // =====================================
      // IGNORA GRUPOS
      // =====================================
      if (
        numero.endsWith("@g.us")
      ) {
        return;
      }

      // =====================================
      // IGNORA STATUS
      // =====================================
      if (
        numero === "status@broadcast"
      ) {
        return;
      }

      // =====================================
      // IGNORA BROADCASTS
      // =====================================
      if (
        numero.endsWith("@broadcast")
      ) {
        return;
      }

      // =====================================
      // IGNORA CANAIS / NEWSLETTERS
      // =====================================
      if (
        numero.endsWith("@newsletter")
      ) {
        return;
      }

      // =====================================
      // TEXTO DA MENSAGEM
      // =====================================
      const textoOriginal =
        msg.body?.trim() || "";

      const texto =
        normalizarTexto(
          textoOriginal
        );

      // =====================================
      // CLIENTE REDIRECIONADO PARA VENDAS
      //
      // Durante 10 minutos o bot ignora
      // mensagens como "obrigado", "certo" etc.
      // =====================================
      if (
        redirecionadosVendas.has(
          numero
        )
      ) {

        const ate =
          redirecionadosVendas.get(
            numero
          );

        if (
          Date.now() < ate
        ) {
          return;
        }

        redirecionadosVendas.delete(
          numero
        );
      }

      // =====================================
      // CLIENTE AGUARDANDO ATENDENTE
      //
      // Bot fica totalmente em silêncio.
      // =====================================
      if (
        botSilenciado.has(numero)
      ) {
        return;
      }

      // =====================================
      // NOVO ATENDIMENTO
      // =====================================
      if (
        !atendimentos.has(numero)
      ) {

        const novoAtendimento = {

          etapa: "setor",

          setor: "",

          tipoAtendimento: "",

          clienteME: null,

          dadosInformados: "",

          criadoEm:
            new Date().toISOString(),

        };

        atendimentos.set(
          numero,
          novoAtendimento
        );


        await enviarMensagem(
          numero,

          `${obterSaudacao()}!\n\n` +

          `Você está falando com a *ME Motos Elétricas*.\n\n` +

          `Para direcionarmos seu atendimento corretamente, selecione a opção que corresponde à sua necessidade:\n\n` +

          `*1 - Vendas*\n` +

          `*2 - Assistência Técnica*`
        );

        return;
      }

      const atendimento =
        atendimentos.get(numero);

      // =====================================
      // ETAPA 1
      // VENDAS OU ASSISTÊNCIA
      // =====================================
      if (
        atendimento.etapa ===
        "setor"
      ) {

        // ===================================
        // VENDAS
        // ===================================
        if (
          texto === "1" ||
          texto === "vendas" ||
          texto === "vendedor"
        ) {

          atendimento.setor =
            "Vendas";

          const linkVendas =
            `https://wa.me/${numeroVendas}?text=${encodeURIComponent(
              mensagemVendas
            )}`;

          await enviarMensagem(
            numero,

            `Perfeito.\n\n` +

            `O atendimento de *Vendas* é realizado em outro WhatsApp.\n\n` +

            `Fale diretamente com o Gabriel pelo link abaixo:\n\n` +

            `${linkVendas}`
          );

          // Atendimento de vendas ocorre
          // em outro WhatsApp.
          atendimentos.delete(
            numero
          );

          // Silêncio temporário de 10 minutos.
          redirecionadosVendas.set(
            numero,

            Date.now() +
              10 * 60 * 1000
          );


          console.log(
            `Cliente encaminhado para vendas: ${numero}`
          );

          return;
        }

        // ===================================
        // ASSISTÊNCIA
        // ===================================
        if (
          texto === "2" ||
          texto.includes(
            "assistencia"
          ) ||
          texto.includes(
            "suporte"
          )
        ) {

          atendimento.setor =
            "Assistência Técnica";

          atendimento.etapa =
            "tipo_suporte";


          await enviarMensagem(
            numero,

            `Qual tipo de atendimento você precisa?\n\n` +

            `*1 - Manutenção*\n` +

            `*2 - Assistência Técnica / Garantia*`
          );

          return;
        }

        // ===================================
        // OPÇÃO INVÁLIDA
        // ===================================
        await enviarMensagem(
          numero,

          `Por favor, selecione uma das opções:\n\n` +

          `*1 - Vendas*\n` +

          `*2 - Assistência Técnica*`
        );

        return;
      }

      // =====================================
      // ETAPA 2
      // TIPO DE ATENDIMENTO
      // =====================================
      if (
        atendimento.etapa ===
        "tipo_suporte"
      ) {

        // ===================================
        // MANUTENÇÃO
        // ===================================
        if (
          texto === "1" ||
          texto.includes(
            "manutencao"
          )
        ) {

          atendimento.tipoAtendimento =
            "Manutenção";

        }

        // ===================================
        // ASSISTÊNCIA / GARANTIA
        // ===================================
        else if (

          texto === "2" ||

          texto.includes(
            "garantia"
          ) ||

          texto.includes(
            "assistencia"
          )

        ) {

          atendimento.tipoAtendimento =
            "Assistência Técnica / Garantia";

        }

        // ===================================
        // INVÁLIDO
        // ===================================
        else {

          await enviarMensagem(
            numero,

            `Por favor, selecione uma das opções:\n\n` +

            `*1 - Manutenção*\n` +

            `*2 - Assistência Técnica / Garantia*`
          );

          return;
        }

        atendimento.etapa =
          "cliente_me";


        await enviarMensagem(
          numero,

          `A moto foi comprada na *ME Motos Elétricas*?\n\n` +

          `*1 - Sim*\n` +

          `*2 - Não*`
        );

        return;
      }

      // =====================================
      // ETAPA 3
      // COMPROU NA ME?
      // =====================================
      if (
        atendimento.etapa ===
        "cliente_me"
      ) {

        // ===================================
        // SIM
        // ===================================
        if (
          texto === "1" ||
          texto === "sim"
        ) {

          atendimento.clienteME =
            true;

          atendimento.etapa =
            "dados_cliente";


          await enviarMensagem(
            numero,

            `Perfeito! Para agilizar seu atendimento, informe os dados abaixo:\n\n` +

            `*CPF do proprietário/comprador:*\n` +

            `*Nº da Nota Fiscal:*\n` +

            `*Modelo da moto:*\n` +

            `*Descreva o problema:*\n\n` +

            `Você pode enviar todas essas informações em uma única mensagem.`
          );

          return;
        }

        // ===================================
        // NÃO
        // ===================================
        if (
          texto === "2" ||
          texto === "nao"
        ) {

          atendimento.clienteME =
            false;

          atendimento.etapa =
            "dados_cliente";


          await enviarMensagem(
            numero,

            `Para agilizar seu atendimento, informe os dados abaixo:\n\n` +

            `*Nome:*\n` +

            `*Modelo da moto:*\n` +

            `*Descreva o problema:*\n\n` +

            `Você pode enviar todas essas informações em uma única mensagem.`
          );

          return;
        }

        await enviarMensagem(
          numero,

          `Por favor, selecione uma das opções:\n\n` +

          `*1 - Sim*\n` +

          `*2 - Não*`
        );

        return;
      }

      // =====================================
      // ETAPA 4
      // RECEBE OS DADOS
      // =====================================
      if (
        atendimento.etapa ===
        "dados_cliente"
      ) {

        if (
          !textoOriginal
        ) {

          await enviarMensagem(
            numero,

            `Por favor, envie os dados solicitados em uma mensagem de texto.`
          );

          return;
        }

        atendimento.dadosInformados =
          textoOriginal;

        atendimento.etapa =
          "aguardando_atendente";

        atendimento.triagemFinalizadaEm =
          new Date().toISOString();

        // ===================================
        // BOT FICA EM SILÊNCIO
        // ===================================
        botSilenciado.add(
          numero
        );


        await enviarMensagem(
          numero,

          `Certo. Suas informações foram recebidas.\n\n` +

          `Aguarde, em breve nossa equipe dará continuidade ao seu atendimento.`
        );

        // ===================================
        // LOG NO TERMINAL
        // ===================================
        console.log(
          "\n======================================"
        );

        console.log(
          "NOVO ATENDIMENTO"
        );

        console.log(
          "======================================"
        );

        console.log(
          `Cliente: ${numero}`
        );

        console.log(
          `Tipo: ${atendimento.tipoAtendimento}`
        );

        console.log(
          `Comprou na ME: ${
            atendimento.clienteME
              ? "SIM"
              : "NÃO"
          }`
        );

        console.log(
          `Dados:\n${atendimento.dadosInformados}`
        );

        console.log(
          "======================================\n"
        );

        return;
      }

    } catch (error) {

      console.error(
        "Erro no processamento da mensagem:"
      );

      console.error(
        error?.message ||
        error
      );
      throw error;

    }
  })
);

// =====================================================
// ENCERRAMENTO DO ATENDIMENTO
//
// Quando a ME enviar uma mensagem contendo:
//
// "este atendimento será finalizado"
//
// o cliente é liberado para iniciar um novo
// atendimento no futuro.
// =====================================================
client.on(
  "message_create",

  (msg) => enfileirar(msg.to, async () => {

    try {

      // =====================================
      // SOMENTE MENSAGENS ENVIADAS PELA ME
      // =====================================
      if (
        !msg.fromMe
      ) {
        return;
      }

      const texto =
        normalizarTexto(
          msg.body || ""
        );

      // =====================================
      // FRASE-CHAVE
      // =====================================
      if (
        !texto.includes(
          "este atendimento sera finalizado"
        )
      ) {
        return;
      }

      // =====================================
      // DESTINATÁRIO
      //
      // Não usamos msg.getChat().
      // =====================================
      const numeroCliente =
        msg.to;

      if (
        !numeroCliente
      ) {

        console.log(
          "Não foi possível identificar o cliente para encerrar o atendimento."
        );

        return;
      }

      // =====================================
      // IGNORA GRUPOS
      // =====================================
      if (
        numeroCliente.endsWith(
          "@g.us"
        )
      ) {
        return;
      }

      // =====================================
      // LIBERA CLIENTE
      // =====================================
      botSilenciado.delete(
        numeroCliente
      );

      atendimentos.delete(
        numeroCliente
      );

      redirecionadosVendas.delete(
        numeroCliente
      );


      console.log(
        "\n======================================"
      );

      console.log(
        "ATENDIMENTO ENCERRADO"
      );

      console.log(
        "======================================"
      );

      console.log(
        `Cliente: ${numeroCliente}`
      );

      console.log(
        "O próximo contato iniciará um novo atendimento."
      );

      console.log(
        "======================================\n"
      );

    } catch (error) {

      console.error(
        "Erro ao encerrar atendimento:"
      );

      console.error(
        error?.message ||
        error
      );
      throw error;

    }
  })
);
