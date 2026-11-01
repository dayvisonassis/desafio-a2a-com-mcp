// O agente como cliente MCP: um Client do SDK oficial, vivo durante o processo,
// falando com o servidor por HTTP (Streamable HTTP, revisao 2026-07-28).
//
// O SDK preenche sozinho, em todo request, o _meta obrigatorio (protocolVersion,
// clientInfo, clientCapabilities) e os headers espelhados (MCP-Protocol-Version,
// Mcp-Method, Mcp-Name). Nao ha sessao nem initialize: a versao fica fixada.
//
// O MRTR nao e resolvido aqui: nenhum handler de elicitation e registrado e o
// tools/call pede o input_required cru, para que a pergunta volte ao cliente A2A.
import { Client, StreamableHTTPClientTransport, isInputRequiredResult } from '@modelcontextprotocol/client';

const PROTOCOLO = '2026-07-28';
const INFO = { name: 'agente-central-de-salas', version: '1.0.0' };
export const URI_POLITICA = 'politica://uso';

// A versao e declarada na primeira linha; [ \t] e \S+ param antes de um \r (CRLF).
export function extrairVersao(texto) {
  const primeira = (texto ?? '').split('\n', 1)[0];
  const m = /^versao:[ \t]*(\S+)/.exec(primeira);
  if (!m) throw new Error('a politica nao declara "versao:" na primeira linha');
  return m[1];
}

// Erro de JSON-RPC (ProtocolError) tem code numerico e mensagem do servidor.
function ehErroDoProtocolo(e) {
  return typeof e?.code === 'number';
}

// Falha de transporte, descrita sem o corpo da resposta HTTP: a mensagem pode
// chegar ao cliente A2A e nada que veio no corpo deve ir junto.
function descreverFalha(e) {
  const detalhe = e?.cause?.code ?? (typeof e?.code === 'string' ? e.code : undefined) ?? e?.name ?? 'erro';
  return `Falha ao falar com o servidor MCP (${detalhe})`;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const INDISPONIVEL = 'O servidor MCP esta indisponivel';

// Prazos: o validador espera no maximo 30 s por resposta A2A. Uma Task faz ate
// tres requests MCP; com 8 s cada (e 8 s de espera pela conexao), ela responde
// antes disso mesmo com o servidor MCP mudo.
export function criarClienteMcp({ url, tentativas = 40, intervaloMs = 250, timeoutMs = 8000, esperaConexaoMs = 8000, log = (linha) => console.error(linha) }) {
  let client;
  let conexao;
  let fechado = false;

  function novoClient() {
    return new Client(INFO, {
      capabilities: { elicitation: { form: {} } },
      versionNegotiation: { mode: { pin: PROTOCOLO } },
      inputRequired: { autoFulfill: false },
    });
  }

  // A conexao so faz a sonda server/discover (sem traceparent). Por isso ela
  // acontece na subida do agente, fora de qualquer Task.
  async function tentarConectar() {
    let ultimo;
    for (let i = 0; i < tentativas && !fechado; i++) {
      const candidato = novoClient();
      try {
        await candidato.connect(new StreamableHTTPClientTransport(new URL(url)), { timeout: timeoutMs });
        client = candidato;
        return;
      } catch (e) {
        ultimo = e;
        await candidato.close().catch(() => {});
        await esperar(intervaloMs);
      }
    }
    conexao = undefined;
    // O detalhe (com a URL interna) fica no log do agente; para fora vai so o resumo.
    log(`[agente] nao consegui conectar ao servidor MCP em ${url}: ${descreverFalha(ultimo)}`);
    throw new Error(INDISPONIVEL);
  }

  function conectar() {
    if (fechado) return Promise.reject(new Error('cliente MCP fechado'));
    conexao ??= tentarConectar();
    return conexao;
  }

  // Uma Task espera a conexao por no maximo esperaConexaoMs; as tentativas da
  // subida continuam em segundo plano.
  async function pronto() {
    if (fechado) throw new Error('cliente MCP fechado');
    let timer;
    const prazo = new Promise((_, rejeitar) => {
      timer = setTimeout(() => rejeitar(new Error(INDISPONIVEL)), esperaConexaoMs);
    });
    try {
      await Promise.race([conectar(), prazo]);
    } finally {
      clearTimeout(timer);
    }
    if (fechado) throw new Error('cliente MCP fechado');
    return client;
  }

  // Erros de protocolo passam como estao; os de transporte viram uma mensagem curta.
  async function chamar(fn) {
    const c = await pronto();
    try {
      return await fn(c);
    } catch (e) {
      if (ehErroDoProtocolo(e)) throw e;
      throw new Error(descreverFalha(e));
    }
  }

  return {
    conectar,

    async listarTools(traceparent) {
      const { tools } = await chamar((c) => c.listTools({ _meta: { traceparent } }, { cacheMode: 'bypass', timeout: timeoutMs }));
      return tools;
    },

    async lerPolitica(traceparent) {
      const { contents } = await chamar((c) => c.readResource({ uri: URI_POLITICA, _meta: { traceparent } }, { cacheMode: 'bypass', timeout: timeoutMs }));
      const texto = contents?.[0]?.text;
      return { texto, versao: extrairVersao(texto) };
    },

    // Devolve { tipo: 'input_required' | 'complete' | 'erro', ... } e nunca lanca
    // por falha do servidor. O requestState vai e volta como string opaca.
    async chamarTool(nome, args, traceparent, { inputResponses, requestState } = {}) {
      const params = { name: nome, arguments: args, _meta: { traceparent } };
      if (inputResponses !== undefined) params.inputResponses = inputResponses;
      if (requestState !== undefined) params.requestState = requestState;
      try {
        const r = await chamar((c) => c.request({ method: 'tools/call', params }, { allowInputRequired: true, timeout: timeoutMs }));
        if (isInputRequiredResult(r)) return { tipo: 'input_required', inputRequests: r.inputRequests, requestState: r.requestState };
        return { tipo: 'complete', result: r };
      } catch (e) {
        if (ehErroDoProtocolo(e)) return { tipo: 'erro', code: e.code, message: e.message };
        return { tipo: 'erro', transporte: true, message: e.message };
      }
    },

    async fechar() {
      fechado = true;
      await conexao?.catch(() => {});
      await client?.close().catch(() => {});
    },
  };
}
