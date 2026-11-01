// Servidor MCP da Central de Salas: Streamable HTTP em /mcp, porta 7301 por padrao.
import { createServer } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { carregarDados } from './dados.js';
import { criarAgenda } from './dominio.js';
import { lerSegredo } from './estado.js';
import { criarFactory } from './servidor.js';
import { criarBorda } from './http.js';

function abortar(motivo) {
  console.error(`[mcp] nao subiu: ${motivo}`);
  process.exit(1);
}

function lerPorta(valor) {
  if (valor === undefined) return 7301;
  if (!/^\d+$/.test(valor) || Number(valor) > 65535) abortar(`MCP_PORT invalida ("${valor}"): use um numero de 0 a 65535`);
  return Number(valor);
}

let chave;
try {
  chave = lerSegredo(process.env.REQUEST_STATE_SECRET);
} catch (e) {
  abortar(e.message);
}
const porta = lerPorta(process.env.MCP_PORT);

// Uma agenda por processo: a factory do SDK roda a cada request e so a recebe.
const dados = carregarDados();
const agenda = criarAgenda(dados);
const handler = createMcpHandler(criarFactory({ dados, agenda, chave }), {
  legacy: 'reject',
  responseMode: 'json',
  onerror: (e) => console.error(`[mcp] erro do SDK: ${e.message}`),
});

// Sem host: aceita IPv4 e IPv6 (no Windows, localhost pode resolver para ::1).
const servidor = createServer(criarBorda(toNodeHandler(handler)));
servidor.on('error', (e) => abortar(e.code === 'EADDRINUSE' ? `porta ${porta} em uso` : e.message));
servidor.listen(porta, () => {
  console.error(`[mcp] servidor MCP ouvindo em http://localhost:${servidor.address().port}/mcp`);
});
