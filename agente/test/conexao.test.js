import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { subirServidorMcp, traceparentNovo } from '../../apoio-teste/processos.js';
import { subirGravador } from '../../apoio-teste/gravador.js';
import { criarClienteMcp, extrairVersao } from '../src/mcp-cliente.js';

test('extrai a versao da politica com LF e com CRLF', () => {
  assert.equal(extrairVersao('versao: 2026-11-01\n\n- regra'), '2026-11-01');
  assert.equal(extrairVersao('versao: 2026-11-01\r\n\r\n- regra'), '2026-11-01');
  assert.throws(() => extrairVersao('sem versao'));
});

test('a versao vem so da primeira linha', () => {
  assert.throws(() => extrairVersao('# Titulo\nversao: 9999'));
  assert.throws(() => extrairVersao('versao:\nregra'));
});

async function servidorFalso(responder) {
  const s = createServer(responder);
  await new Promise((r) => s.listen(0, r));
  return { url: `http://localhost:${s.address().port}/mcp`, parar: () => new Promise((r) => { s.closeAllConnections?.(); s.close(r); }) };
}

async function clienteConectado(opcoes = {}) {
  const mcp = await subirServidorMcp();
  const gravador = await subirGravador(mcp.url);
  const cliente = criarClienteMcp({ url: gravador.url, ...opcoes });
  await cliente.conectar();
  return { mcp, gravador, cliente, async parar() { await cliente.fechar(); await gravador.parar(); await mcp.parar(); } };
}

const args = { sala: 'sala-porao', inicio: '2026-11-03T09:00:00-03:00', fim: '2026-11-03T10:00:00-03:00', responsavel: 'Doc' };

test('falha de transporte volta como erro curto, sem o corpo da resposta HTTP', async () => {
  const ctx = await clienteConectado();
  const falso = await servidorFalso((req, res) => { res.writeHead(500, { 'Content-Type': 'text/html' }); res.end('<html>SEGREDO-DO-CORPO</html>'); });
  try {
    ctx.gravador.apontarPara(falso.url);
    const r = await ctx.cliente.chamarTool('reservar_sala', args, traceparentNovo());
    assert.equal(r.tipo, 'erro');
    assert.equal(r.transporte, true);
    assert.ok(!r.message.includes('SEGREDO-DO-CORPO'), r.message);
    await assert.rejects(ctx.cliente.listarTools(traceparentNovo()), (e) => !e.message.includes('SEGREDO-DO-CORPO'));
  } finally {
    await falso.parar();
    await ctx.parar();
  }
});

test('request sem resposta termina no timeout configurado, como erro', async () => {
  const ctx = await clienteConectado({ timeoutMs: 400 });
  const pendurado = await servidorFalso(() => {});
  try {
    ctx.gravador.apontarPara(pendurado.url);
    const inicio = Date.now();
    const r = await ctx.cliente.chamarTool('reservar_sala', args, traceparentNovo());
    assert.equal(r.tipo, 'erro');
    assert.ok(Date.now() - inicio < 5000, `demorou ${Date.now() - inicio} ms`);
  } finally {
    await pendurado.parar();
    await ctx.parar();
  }
});

test('depois de fechar, o cliente recusa novas chamadas', async () => {
  const ctx = await clienteConectado();
  await ctx.cliente.fechar();
  try {
    await assert.rejects(ctx.cliente.listarTools(traceparentNovo()), /fechado/);
  } finally {
    await ctx.parar();
  }
});

test('o mesmo cliente se recupera de um restart do MCP na mesma porta, sem proxy', async () => {
  let mcp = await subirServidorMcp();
  const porta = mcp.porta;
  const cliente = criarClienteMcp({ url: mcp.url });
  try {
    await cliente.conectar();
    assert.equal((await cliente.listarTools(traceparentNovo())).length, 3);
    await mcp.parar();
    const fora = await cliente.chamarTool('reservar_sala', args, traceparentNovo());
    assert.equal(fora.tipo, 'erro');
    mcp = await subirServidorMcp({ env: { MCP_PORT: String(porta) } });
    assert.equal((await cliente.listarTools(traceparentNovo())).length, 3);
    const r = await cliente.chamarTool('reservar_sala', args, traceparentNovo());
    assert.equal(r.tipo, 'complete');
  } finally {
    await cliente.fechar();
    await mcp.parar();
  }
});

test('conectar espera o servidor MCP que sobe depois do agente', async () => {
  const gravador = await subirGravador('http://localhost:1/mcp');
  const cliente = criarClienteMcp({ url: gravador.url, tentativas: 40, intervaloMs: 100 });
  const conexao = cliente.conectar();
  await new Promise((r) => setTimeout(r, 400));
  const mcp = await subirServidorMcp();
  try {
    gravador.apontarPara(mcp.url);
    await conexao;
    const tools = await cliente.listarTools(traceparentNovo());
    assert.equal(tools.length, 3);
  } finally {
    await cliente.fechar();
    await gravador.parar();
    await mcp.parar();
  }
});

test('conectar desiste depois das tentativas, com o detalhe so no log', async () => {
  const log = [];
  const cliente = criarClienteMcp({ url: 'http://localhost:1/mcp', tentativas: 2, intervaloMs: 10, log: (l) => log.push(l) });
  await assert.rejects(cliente.conectar(), (e) => /servidor MCP esta indisponivel/.test(e.message) && !e.message.includes('localhost:1'));
  assert.match(log.join('\n'), /http:\/\/localhost:1\/mcp/);
});

test('uma chamada espera a conexao no maximo esperaConexaoMs', async () => {
  const cliente = criarClienteMcp({ url: 'http://localhost:1/mcp', tentativas: 1000, intervaloMs: 50, esperaConexaoMs: 300, log: () => {} });
  const inicio = Date.now();
  await assert.rejects(cliente.listarTools(traceparentNovo()), /servidor MCP esta indisponivel/);
  assert.ok(Date.now() - inicio < 2000, `demorou ${Date.now() - inicio} ms`);
  await cliente.fechar();
});
