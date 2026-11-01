// O agente com o servidor MCP fora do ar, mudo ou mal configurado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { subirAgente, subirProcesso, enviar, tarefaDe, mensagemDe } from '../../apoio-teste/processos.js';

const INDEX_AGENTE = fileURLToPath(new URL('../src/index.js', import.meta.url));
const pedido = 'reservar sala=sala-porao inicio=2026-11-03T09:00:00-03:00 fim=2026-11-03T10:00:00-03:00 responsavel=Doc';

// Aceita TCP e nunca responde: o pior caso para quem espera.
async function servidorMudo() {
  const sockets = new Set();
  const s = createServer((sock) => { sockets.add(sock); sock.on('error', () => {}); });
  await new Promise((r) => s.listen(0, r));
  return {
    url: `http://localhost:${s.address().port}/mcp`,
    parar: () => new Promise((r) => { for (const k of sockets) k.destroy(); s.close(r); }),
  };
}

test('com o MCP mudo, o SendMessage termina em FAILED bem antes dos 30 s do validador, sem expor a URL', async () => {
  const mudo = await servidorMudo();
  const agente = await subirAgente({ mcpUrl: mudo.url });
  try {
    const inicio = Date.now();
    const r = await enviar(agente.rpc, pedido);
    const ms = Date.now() - inicio;
    assert.equal(tarefaDe(r.corpo).status.state, 'TASK_STATE_FAILED');
    assert.ok(ms < 15000, `demorou ${ms} ms`);
    assert.match(mensagemDe(r.corpo), /servidor MCP/i);
    assert.ok(!mensagemDe(r.corpo).includes(mudo.url), mensagemDe(r.corpo));
  } finally {
    await agente.parar();
    await mudo.parar();
  }
});

test('com o MCP fora do ar, o SendMessage termina em FAILED em ate 10 s', async () => {
  const agente = await subirAgente({ mcpUrl: 'http://localhost:1/mcp' });
  try {
    const inicio = Date.now();
    const r = await enviar(agente.rpc, pedido);
    assert.equal(tarefaDe(r.corpo).status.state, 'TASK_STATE_FAILED');
    assert.ok(Date.now() - inicio < 10000, `demorou ${Date.now() - inicio} ms`);
  } finally {
    await agente.parar();
  }
});

for (const [nome, env] of [
  ['MCP_URL invalida', { MCP_URL: 'nao e url' }],
  ['AGENTE_URL_PUBLICA vazia', { MCP_URL: 'http://localhost:7301/mcp', AGENTE_URL_PUBLICA: '' }],
  ['AGENTE_URL_PUBLICA invalida', { MCP_URL: 'http://localhost:7301/mcp', AGENTE_URL_PUBLICA: 'localhost:7300' }],
]) {
  test(`${nome} aborta a subida com mensagem clara`, async () => {
    const proc = subirProcesso(INDEX_AGENTE, { AGENTE_PORT: '0', ...env });
    try {
      await assert.rejects(proc.pronto, new RegExp(nome.split(' ')[0]));
      assert.notEqual(await proc.saida, 0);
    } finally {
      await proc.parar();
    }
  });
}

test('AGENTE_URL_PUBLICA com barra no fim nao duplica a barra no card', async () => {
  const agente = await subirAgente({ mcpUrl: 'http://localhost:1/mcp', env: { AGENTE_URL_PUBLICA: 'http://exemplo.local:7300/' } });
  try {
    const card = await (await fetch(`${agente.base}/.well-known/agent-card.json`)).json();
    assert.equal(card.supportedInterfaces[0].url, 'http://exemplo.local:7300/a2a');
  } finally {
    await agente.parar();
  }
});
