// Agente Central de Salas: servidor A2A em /a2a (porta 7300 por padrao) e cliente
// MCP do servidor em MCP_URL (padrao http://localhost:7301/mcp).
import { createServer } from 'node:http';
import { criarClienteMcp } from './mcp-cliente.js';
import { criarPonte } from './ponte.js';
import { criarAppA2a } from './a2a.js';

function abortar(motivo) {
  console.error(`[agente] nao subiu: ${motivo}`);
  process.exit(1);
}

function lerPorta(nome, valor, padrao) {
  if (valor === undefined) return padrao;
  if (!/^\d+$/.test(valor) || Number(valor) > 65535) abortar(`${nome} invalida ("${valor}"): use um numero de 0 a 65535`);
  return Number(valor);
}

function lerUrl(nome, valor) {
  let url;
  try {
    url = new URL(valor);
  } catch {
    abortar(`${nome} invalida ("${valor}"): use uma URL http(s) completa`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) abortar(`${nome} invalida ("${valor}"): use uma URL http(s) completa`);
  return valor.replace(/\/+$/, '');
}

const porta = lerPorta('AGENTE_PORT', process.env.AGENTE_PORT, 7300);
const mcpUrl = lerUrl('MCP_URL', process.env.MCP_URL ?? 'http://localhost:7301/mcp');
const urlPublicaFixa = process.env.AGENTE_URL_PUBLICA === undefined ? undefined : lerUrl('AGENTE_URL_PUBLICA', process.env.AGENTE_URL_PUBLICA);

// Um Client MCP so, conectado na subida (fora de qualquer Task).
const cliente = criarClienteMcp({ url: mcpUrl });
cliente.conectar().then(
  () => console.error(`[agente] conectado ao servidor MCP em ${mcpUrl}`),
  () => {}, // o motivo ja foi para o log pelo cliente
);
const ponte = criarPonte({ cliente });

// Sem host: aceita IPv4 e IPv6. O app A2A e montado depois do listen, quando a
// porta real (inclusive 0, nos testes) ja e conhecida para a URL do card.
const servidor = createServer();
servidor.on('error', (e) => abortar(e.code === 'EADDRINUSE' ? `porta ${porta} em uso` : e.message));
servidor.listen(porta, () => {
  const portaReal = servidor.address().port;
  const urlPublica = urlPublicaFixa ?? `http://localhost:${portaReal}`;
  servidor.on('request', criarAppA2a({ ponte, urlPublica }));
  console.error(`[agente] agente A2A ouvindo em http://localhost:${portaReal}/a2a (card em /.well-known/agent-card.json)`);
});
