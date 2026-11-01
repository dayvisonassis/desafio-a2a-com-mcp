import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  subirServidorMcp, subirAgente, a2a, enviar, tarefaDe, mensagemDe, traceparentNovo,
} from '../../apoio-teste/processos.js';

const h = (hora) => `2026-11-03T${hora}:00-03:00`;
const pedido = (sala, ini, fim, resp = 'Doc') => `reservar sala=${sala} inicio=${h(ini)} fim=${h(fim)} responsavel=${resp}`;
const WIRE_CARD = JSON.parse(readFileSync(new URL('../../exemplos/wire/07-a2a-agent-card.json', import.meta.url), 'utf8')).response.body;

let mcp;
let agente;
before(async () => {
  mcp = await subirServidorMcp();
  agente = await subirAgente({ mcpUrl: mcp.url });
});
after(async () => {
  await agente?.parar();
  await mcp?.parar();
});

let concluida;

test('o card responde 200 em JSON com a forma da v1.0 do wire 07', async () => {
  const r = await fetch(`${agente.base}/.well-known/agent-card.json`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/json/);
  const card = await r.json();
  for (const campo of ['name', 'description', 'provider', 'version', 'capabilities', 'defaultInputModes', 'defaultOutputModes', 'skills']) {
    assert.deepEqual(card[campo], WIRE_CARD[campo], campo);
  }
  assert.deepEqual(card.supportedInterfaces, [{ url: `${agente.base}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }]);
  for (const v0 of ['interfaces', 'preferredTransport', 'additionalInterfaces', 'url']) assert.equal(card[v0], undefined, v0);
  assert.ok(!card.securitySchemes || Object.keys(card.securitySchemes).length === 0);
});

test('SendMessage com sala livre conclui a Task com o artifact reserva', async () => {
  const r = await enviar(agente.rpc, pedido('sala-porao', '09:00', '10:00'), { traceparent: traceparentNovo() });
  assert.equal(r.status, 200);
  assert.ok(r.corpo.result.task, 'SendMessage devolve result.task');
  concluida = tarefaDe(r.corpo);
  assert.equal(concluida.status.state, 'TASK_STATE_COMPLETED');
  assert.ok(concluida.id);
  assert.ok(concluida.contextId);
  const [artifact] = concluida.artifacts;
  assert.equal(artifact.name, 'reserva');
  assert.ok(artifact.artifactId);
  assert.equal(artifact.parts.length, 1);
  assert.deepEqual(JSON.parse(artifact.parts[0].text), {
    reserva: 'res-0003', sala: 'sala-porao', inicio: h('09:00'), fim: h('10:00'), responsavel: 'Doc', politica: '2026-11-01',
  });
});

test('as mensagens do agente trazem messageId, taskId, contextId e ROLE_AGENT', async () => {
  const msg = concluida.status.message;
  assert.equal(msg.role, 'ROLE_AGENT');
  assert.ok(msg.messageId);
  assert.equal(msg.taskId, concluida.id);
  assert.equal(msg.contextId, concluida.contextId);
  assert.equal(msg.parts[0].kind, undefined);
  assert.ok(concluida.history.some((m) => m.role === 'ROLE_USER'));
});

test('GetTask devolve id, contextId, estado corrente e o artifact', async () => {
  const r = await a2a(agente.rpc, 'GetTask', { id: concluida.id });
  const t = tarefaDe(r.corpo);
  assert.equal(t.id, concluida.id);
  assert.equal(t.contextId, concluida.contextId);
  assert.equal(t.status.state, 'TASK_STATE_COMPLETED');
  assert.equal(t.artifacts[0].name, 'reserva');
});

test('SendMessage numa Task terminal e recusado com erro', async () => {
  const r = await enviar(agente.rpc, 'escolha=sala-mirante', { taskId: concluida.id });
  assert.ok(r.corpo.error, JSON.stringify(r.corpo));
  assert.equal(r.corpo.error.code, -32004);
  const depois = tarefaDe((await a2a(agente.rpc, 'GetTask', { id: concluida.id })).corpo);
  assert.equal(depois.status.state, 'TASK_STATE_COMPLETED');
});

test('GetTask e SendMessage com Task inexistente devolvem erro', async () => {
  assert.equal((await a2a(agente.rpc, 'GetTask', { id: 'task-nao-existe' })).corpo.error?.code, -32001);
  assert.equal((await enviar(agente.rpc, 'escolha=sala-fusca', { taskId: 'task-nao-existe' })).corpo.error?.code, -32001);
});

test('sala inexistente termina em FAILED com a mensagem da tool no status e no historico', async () => {
  const r = await enviar(agente.rpc, pedido('sala-delorean', '09:00', '10:00'));
  const t = tarefaDe(r.corpo);
  assert.equal(t.status.state, 'TASK_STATE_FAILED');
  assert.match(mensagemDe(r.corpo), /Sala inexistente: sala-delorean/);
  assert.ok(t.history.some((m) => m.role === 'ROLE_AGENT' && m.parts.some((p) => /Sala inexistente: sala-delorean/.test(p.text))));
});

test('pedido fora do formato termina em FAILED com a mensagem de formato', async () => {
  const r = await enviar(agente.rpc, 'quero uma sala');
  assert.equal(tarefaDe(r.corpo).status.state, 'TASK_STATE_FAILED');
  assert.match(mensagemDe(r.corpo), /reservar sala=<id>/);
});

test('id numerico volta numerico e id string volta string', async () => {
  assert.equal((await enviar(agente.rpc, pedido('sala-delorean', '09:00', '10:00'), { id: 7 })).corpo.id, 7);
  assert.equal((await enviar(agente.rpc, pedido('sala-delorean', '09:00', '10:00'), { id: 'a1b2c3d4e5f6' })).corpo.id, 'a1b2c3d4e5f6');
});

test('header A2A-Version 1.0 explicito funciona, e 0.3 e recusado', async () => {
  const ok = await enviar(agente.rpc, pedido('sala-delorean', '09:00', '10:00'), { headers: { 'A2A-Version': '1.0' } });
  assert.equal(tarefaDe(ok.corpo).status.state, 'TASK_STATE_FAILED');
  const velho = await enviar(agente.rpc, pedido('sala-delorean', '09:00', '10:00'), { headers: { 'A2A-Version': '0.3' } });
  assert.equal(velho.corpo.error?.code, -32009);
});

test('a Task passa por SUBMITTED e WORKING antes de terminar, e GetTask acompanha', async () => {
  const r = await enviar(agente.rpc, pedido('sala-porao', '11:00', '12:00'), { configuration: { returnImmediately: true } });
  const t = tarefaDe(r.corpo);
  assert.equal(t.status.state, 'TASK_STATE_SUBMITTED');
  let estado = t.status.state;
  for (let i = 0; i < 100 && !['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED'].includes(estado); i++) {
    await new Promise((ok) => setTimeout(ok, 50));
    estado = tarefaDe((await a2a(agente.rpc, 'GetTask', { id: t.id })).corpo).status.state;
  }
  assert.equal(estado, 'TASK_STATE_COMPLETED');
});

test('o traceparent do cliente A2A chega ao log do MCP com o mesmo trace-id', async () => {
  const tp = traceparentNovo();
  const traceId = tp.split('-')[1];
  await enviar(agente.rpc, pedido('sala-aquario', '09:00', '10:00'), { traceparent: tp });
  const doAgente = await mcp.esperarLinhaStderr((l) => l.includes('method=tools/call') && l.includes(traceId));
  assert.ok(doAgente, mcp.linhasStderr.join('\n'));
  assert.match(doAgente, /cliente=agente-central-de-salas/);
  const linhas = mcp.linhasStderr.filter((l) => l.includes(traceId));
  assert.deepEqual(linhas.map((l) => /method=(\S+)/.exec(l)[1]), ['tools/list', 'resources/read', 'tools/call']);
});

test('o agente nao importa codigo do servidor MCP nem le dados/', () => {
  const pasta = new URL('../src/', import.meta.url);
  for (const arquivo of readdirSync(pasta)) {
    const codigo = readFileSync(new URL(arquivo, pasta), 'utf8');
    assert.doesNotMatch(codigo, /servidor-mcp/, arquivo);
    assert.doesNotMatch(codigo, /dados\//, arquivo);
  }
});
