// Borda HTTP do servidor MCP: le o corpo, registra cada request no stderr e
// recusa o que chega sem os campos obrigatorios de _meta antes de entregar ao SDK.
//
// O SDK ja responde -32602/400 quando o header MCP-Protocol-Version vem e o _meta
// nao, mas sem header nenhum ele trata o request como protocolo legado (com
// legacy:'reject', responde -32022). O enunciado exige -32602/400 em qualquer
// request sem os campos, entao a regra fica aqui, igual para todos.

const PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
const CLIENT_INFO = 'io.modelcontextprotocol/clientInfo';
const LIMITE_CORPO = 1024 * 1024;

function responderJson(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

// So string e numero voltam como id; qualquer outra coisa vira null, como no SDK.
function idEcoavel(id) {
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

function erroJsonRpc(id, code, message) {
  return { jsonrpc: '2.0', id: idEcoavel(id), error: { code, message } };
}

async function lerCorpo(req) {
  const pedacos = [];
  let tamanho = 0;
  for await (const pedaco of req) {
    tamanho += pedaco.length;
    if (tamanho > LIMITE_CORPO) return null;
    pedacos.push(pedaco);
  }
  return Buffer.concat(pedacos).toString('utf8');
}

// Uma linha por request: o valor nunca quebra a linha nem o formato chave=valor.
function valor(v) {
  if (v === undefined) return '-';
  let texto;
  if (typeof v === 'string') texto = v === '' ? '""' : v;
  else if (typeof v === 'number' || typeof v === 'boolean' || v === null) texto = String(v);
  else {
    try {
      texto = JSON.stringify(v) ?? '?';
    } catch {
      texto = '?';
    }
  }
  return texto.replace(/\s/g, '_');
}

export function linhaDeLog(mensagem) {
  const params = mensagem?.params ?? {};
  const meta = params._meta ?? {};
  const nome = params.name ?? params.uri;
  return [
    '[mcp]',
    new Date().toISOString(),
    `method=${valor(mensagem?.method)}`,
    `id=${valor(mensagem?.id)}`,
    `name=${valor(nome)}`,
    `cliente=${valor(meta[CLIENT_INFO]?.name)}`,
    `traceparent=${valor(meta.traceparent)}`,
    `retry=${params.requestState !== undefined ? 'sim' : 'nao'}`,
  ].join(' ');
}

function camposFaltando(mensagem) {
  const meta = mensagem?.params?._meta ?? {};
  return [PROTOCOL_VERSION, CLIENT_CAPABILITIES].filter((chave) => meta[chave] === undefined);
}

function caminhoDe(req) {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return null;
  }
}

export function criarBorda(handlerSdk, { log = (linha) => console.error(linha) } = {}) {
  async function atender(req, res) {
    const caminho = caminhoDe(req);
    if (caminho !== '/mcp') {
      log(linhaDeLog({ method: req.method }));
      responderJson(res, caminho === null ? 400 : 404, { erro: 'o endpoint MCP e POST /mcp' });
      return;
    }
    if (req.method !== 'POST') {
      log(linhaDeLog({ method: req.method }));
      await handlerSdk(req, res);
      return;
    }

    const bruto = await lerCorpo(req);
    if (bruto === null) {
      log(linhaDeLog({ method: 'POST' }));
      responderJson(res, 413, erroJsonRpc(null, -32600, 'Request body too large'));
      return;
    }
    let mensagem;
    try {
      mensagem = JSON.parse(bruto);
    } catch {
      log(linhaDeLog(undefined));
      responderJson(res, 400, erroJsonRpc(null, -32700, 'Parse error'));
      return;
    }

    for (const item of Array.isArray(mensagem) ? mensagem : [mensagem]) log(linhaDeLog(item));

    const ehRequest = !Array.isArray(mensagem) && mensagem?.method !== undefined && mensagem?.id !== undefined;
    const faltando = ehRequest ? camposFaltando(mensagem) : [];
    if (faltando.length > 0) {
      responderJson(res, 400, erroJsonRpc(mensagem.id, -32602, `Invalid params: _meta sem ${faltando.join(' e ')}`));
      return;
    }

    await handlerSdk(req, res, mensagem);
  }

  // Nenhuma falha de um request (cliente que aborta, entrada estranha) pode
  // derrubar o processo: as reservas vivem em memoria.
  return async function borda(req, res) {
    try {
      await atender(req, res);
    } catch (e) {
      console.error(`[mcp] erro atendendo request: ${e?.message ?? e}`);
      if (!res.headersSent && !res.destroyed) responderJson(res, 500, erroJsonRpc(null, -32603, 'Internal error'));
      else res.destroy();
    }
  };
}
