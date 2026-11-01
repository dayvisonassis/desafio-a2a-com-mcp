// Apoio dos testes: sobe os processos de verdade (nunca importa o codigo de um no
// outro) e fala com eles por HTTP, do mesmo jeito que o validador.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';

export const PROTOCOLO = '2026-07-28';
export const CAP_FORM = { elicitation: { form: {} } };
export const SEGREDO_TESTE = randomBytes(32).toString('hex');

const INDEX_MCP = fileURLToPath(new URL('../servidor-mcp/src/index.js', import.meta.url));

export function traceparentNovo() {
  return `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;
}

// Sobe um script Node com process.execPath e espera a linha "ouvindo em http://localhost:<porta>".
export function subirProcesso(script, env = {}, { timeoutMs = 15000 } = {}) {
  const filho = spawn(process.execPath, [script], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const linhas = []; // stdout e stderr, na ordem em que chegaram
  const linhasStderr = [];
  const saida = new Promise((resolve) => filho.on('exit', (codigo) => resolve(codigo)));

  const pronto = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      filho.kill();
      reject(new Error(`timeout subindo ${script}\n${linhas.join('\n')}`));
    }, timeoutMs);
    const leitor = (destino) => {
      let resto = '';
      return (pedaco) => {
        resto += pedaco.toString('utf8');
        const partes = resto.split(/\r?\n/);
        resto = partes.pop();
        for (const linha of partes) {
          linhas.push(linha);
          destino?.push(linha);
          const m = /ouvindo em http:\/\/localhost:(\d+)/.exec(linha);
          if (m) {
            clearTimeout(timer);
            resolve(Number(m[1]));
          }
        }
      };
    };
    filho.stderr.on('data', leitor(linhasStderr));
    filho.stdout.on('data', leitor(null));
    saida.then((codigo) => {
      clearTimeout(timer);
      reject(Object.assign(new Error(`${script} saiu com codigo ${codigo}\n${linhas.join('\n')}`), { codigo, linhas }));
    });
  });

  return {
    filho,
    linhas,
    linhasStderr,
    saida,
    pronto,
    // Espera (com polling) uma linha do stderr que satisfaca o predicado.
    async esperarLinhaStderr(predicado, timeoutMs = 3000) {
      const limite = Date.now() + timeoutMs;
      while (Date.now() < limite) {
        const achada = linhasStderr.find(predicado);
        if (achada) return achada;
        await new Promise((r) => setTimeout(r, 20));
      }
      return undefined;
    },
    async parar() {
      if (filho.exitCode === null && filho.signalCode === null) filho.kill();
      await saida;
    },
  };
}

export async function subirServidorMcp({ segredo = SEGREDO_TESTE, env = {} } = {}) {
  const proc = subirProcesso(INDEX_MCP, { MCP_PORT: '0', REQUEST_STATE_SECRET: segredo, ...env });
  const porta = await proc.pronto;
  return { ...proc, porta, url: `http://localhost:${porta}/mcp` };
}

export { INDEX_MCP };

export async function postar(url, corpo, headers = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let json;
  try {
    json = JSON.parse(texto);
  } catch {
    json = undefined;
  }
  return { status: r.status, tipo: r.headers.get('content-type') ?? '', corpo: json, texto };
}

// Espelha a funcao mcp() de validador/validar.py.
export function montarMcp(metodo, params = {}, opcoes = {}) {
  const {
    id = randomBytes(6).toString('hex'),
    capabilities = CAP_FORM,
    omitir,
    traceparent,
    nome,
    headers: extras = {},
    semHeaderVersao = false,
  } = opcoes;
  const meta = {
    'io.modelcontextprotocol/protocolVersion': PROTOCOLO,
    'io.modelcontextprotocol/clientCapabilities': capabilities,
  };
  if (traceparent) meta.traceparent = traceparent;
  if (omitir === 'protocolVersion') delete meta['io.modelcontextprotocol/protocolVersion'];
  if (omitir === 'clientCapabilities') delete meta['io.modelcontextprotocol/clientCapabilities'];
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOLO,
    'Mcp-Method': metodo,
    ...extras,
  };
  if (semHeaderVersao) delete headers['MCP-Protocol-Version'];
  if (nome) headers['Mcp-Name'] = nome;
  const corpo = { jsonrpc: '2.0', id, method: metodo, params: { ...params, _meta: meta } };
  return { corpo, headers };
}

export async function mcp(url, metodo, params = {}, opcoes = {}) {
  const { corpo, headers } = montarMcp(metodo, params, opcoes);
  return postar(url, corpo, headers);
}

// Envia bytes crus por TCP (para requests que o fetch nao deixa montar) e devolve a
// resposta crua, ou '' se o servidor fechar sem responder.
export function tcpCru(porta, bytes, { fecharDepoisDeEnviar = false } = {}) {
  return new Promise((resolve) => {
    const sock = connect(porta, 'localhost');
    let resposta = '';
    sock.on('data', (d) => { resposta += d.toString('utf8'); });
    sock.on('error', () => resolve(resposta));
    sock.on('close', () => resolve(resposta));
    sock.write(bytes, () => {
      if (fecharDepoisDeEnviar) sock.destroy();
      else setTimeout(() => sock.end(), 300);
    });
  });
}

export function texto(resultado) {
  return (resultado?.content ?? []).map((p) => p.text ?? '').join(' ');
}
