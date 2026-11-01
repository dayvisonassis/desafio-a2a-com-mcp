// A ponte vista de fora, pelo A2A, na mesma sequencia das verificacoes 27 a 36.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  subirServidorMcp, subirAgente, a2a, enviar, tarefaDe, mensagemDe, traceparentNovo,
} from '../../apoio-teste/processos.js';
import { subirGravador } from '../../apoio-teste/gravador.js';

const h = (hora) => `2026-11-03T${hora}:00-03:00`;
const pedido = (sala, ini, fim, resp) => `reservar sala=${sala} inicio=${h(ini)} fim=${h(fim)} responsavel=${resp}`;

let mcp;
let gravador;
let agente;
const respostasA2a = [];
const registrar = (r) => { respostasA2a.push(r.texto); return r; };

before(async () => {
  mcp = await subirServidorMcp();
  gravador = await subirGravador(mcp.url);
  agente = await subirAgente({ mcpUrl: gravador.url });
});
after(async () => {
  await agente?.parar();
  await gravador?.parar();
  await mcp?.parar();
});

let pausada;
const tp = traceparentNovo();

test('27/28: sala ocupada pausa a Task com a linha de alternativas exata', async () => {
  const r = registrar(await enviar(agente.rpc, pedido('sala-garagem', '14:00', '15:00', 'Marty'), { traceparent: tp }));
  pausada = tarefaDe(r.corpo);
  assert.equal(pausada.status.state, 'TASK_STATE_INPUT_REQUIRED');
  assert.equal(mensagemDe(r.corpo), 'alternativas: sala-fusca, sala-mirante');
  assert.equal(pausada.status.message.parts.length, 1);
  assert.deepEqual(pausada.artifacts ?? [], []);
});

test('GetTask reflete a pausa com a mesma linha', async () => {
  const r = registrar(await a2a(agente.rpc, 'GetTask', { id: pausada.id }));
  assert.equal(tarefaDe(r.corpo).status.state, 'TASK_STATE_INPUT_REQUIRED');
  assert.equal(mensagemDe(r.corpo), 'alternativas: sala-fusca, sala-mirante');
});

test('29: escolha fora do enum mantem a Task pausada e repete a lista', async () => {
  const r = registrar(await enviar(agente.rpc, 'escolha=sala-aquario', { taskId: pausada.id }));
  assert.equal(tarefaDe(r.corpo).status.state, 'TASK_STATE_INPUT_REQUIRED');
  assert.equal(mensagemDe(r.corpo), 'alternativas: sala-fusca, sala-mirante');
});

test('30: a continuacao conclui na sala escolhida, com retry de id novo e o trace-id guardado na Task', async () => {
  // Outro traceparent no header: o retry tem que manter o trace-id da criacao da Task.
  const r = registrar(await enviar(agente.rpc, 'escolha=sala-fusca', { taskId: pausada.id, traceparent: traceparentNovo() }));
  const t = tarefaDe(r.corpo);
  assert.equal(t.status.state, 'TASK_STATE_COMPLETED');
  assert.equal(t.id, pausada.id);
  const reserva = JSON.parse(t.artifacts[0].parts[0].text);
  assert.equal(reserva.sala, 'sala-fusca');
  assert.equal(reserva.politica, '2026-11-01');

  const traceId = tp.split('-')[1];
  const chamadas = gravador.requests('tools/call').filter((x) => x.corpo.params._meta.traceparent.includes(traceId));
  assert.equal(chamadas.length, 2);
  assert.notEqual(chamadas[0].corpo.id, chamadas[1].corpo.id);
  assert.equal(chamadas[1].corpo.params.requestState, chamadas[0].resposta.result.requestState);
  const textos = t.history.map((m) => m.parts.map((p) => p.text).join(' '));
  assert.ok(textos.includes('alternativas: sala-fusca, sala-mirante'));
  assert.ok(textos.includes('escolha=sala-fusca'));
});

test('31: SendMessage na Task concluida e recusado', async () => {
  const r = registrar(await enviar(agente.rpc, 'escolha=sala-mirante', { taskId: pausada.id }));
  assert.equal(r.corpo.error?.code, -32004);
});

test('32: escolha=recusar termina em CANCELED', async () => {
  const p = registrar(await enviar(agente.rpc, pedido('sala-garagem', '14:30', '15:30', 'Biff')));
  assert.equal(tarefaDe(p.corpo).status.state, 'TASK_STATE_INPUT_REQUIRED');
  const r = registrar(await enviar(agente.rpc, 'escolha=recusar', { taskId: tarefaDe(p.corpo).id }));
  assert.equal(tarefaDe(r.corpo).status.state, 'TASK_STATE_CANCELED');
});

test('33: duas Tasks pausadas ao mesmo tempo concluem cada uma com a sua reserva', async () => {
  const a = tarefaDe(registrar(await enviar(agente.rpc, pedido('sala-fusca', '16:00', '17:00', 'Lorraine'))).corpo);
  const b = tarefaDe(registrar(await enviar(agente.rpc, pedido('sala-garagem', '14:00', '15:00', 'George'))).corpo);
  assert.equal(a.status.state, 'TASK_STATE_INPUT_REQUIRED');
  assert.equal(b.status.state, 'TASK_STATE_INPUT_REQUIRED');
  const ra = tarefaDe(registrar(await enviar(agente.rpc, 'escolha=sala-mirante', { taskId: a.id })).corpo);
  const rb = tarefaDe(registrar(await enviar(agente.rpc, 'escolha=sala-mirante', { taskId: b.id })).corpo);
  assert.equal(ra.status.state, 'TASK_STATE_COMPLETED');
  assert.equal(rb.status.state, 'TASK_STATE_COMPLETED');
  const xa = JSON.parse(ra.artifacts[0].parts[0].text);
  const xb = JSON.parse(rb.artifacts[0].parts[0].text);
  assert.notEqual(xa.reserva, xb.reserva);
  assert.notEqual(xa.inicio, xb.inicio);
  assert.equal(xa.responsavel, 'Lorraine');
  assert.equal(xb.responsavel, 'George');
});

test('36: o mesmo pedido duas vezes produz a mesma pausa', async () => {
  // Neste ponto da sequencia, fusca 16-17 (Jennifer) ainda tem sala-garagem livre.
  const p = pedido('sala-fusca', '16:00', '17:00', 'Doc');
  const m1 = mensagemDe(registrar(await enviar(agente.rpc, p)).corpo);
  const m2 = mensagemDe(registrar(await enviar(agente.rpc, p)).corpo);
  assert.equal(m1, m2);
  assert.ok(m1.startsWith('alternativas:'));
});

const h9 = (hora) => `2026-11-09T${hora}:00-03:00`;

async function esperarEstado(id, alvo) {
  let estado;
  for (let i = 0; i < 100; i++) {
    estado = tarefaDe(registrar(await a2a(agente.rpc, 'GetTask', { id })).corpo).status.state;
    if (estado === alvo) return estado;
    await new Promise((r) => setTimeout(r, 30));
  }
  return estado;
}

test('continuacao enquanto a Task esta em WORKING e recusada, e a execucao em curso conclui normalmente', async () => {
  gravador.atrasar('tools/call', 1500);
  try {
    const r = registrar(await enviar(agente.rpc, `reservar sala=sala-porao inicio=${h9('09:00')} fim=${h9('10:00')} responsavel=Doc`, { configuration: { returnImmediately: true } }));
    const t = tarefaDe(r.corpo);
    assert.equal(t.status.state, 'TASK_STATE_SUBMITTED');
    assert.equal(await esperarEstado(t.id, 'TASK_STATE_WORKING'), 'TASK_STATE_WORKING');
    const intrusa = registrar(await enviar(agente.rpc, 'escolha=sala-fusca', { taskId: t.id }));
    assert.equal(intrusa.corpo.error?.code, -32004, JSON.stringify(intrusa.corpo));
    assert.equal(await esperarEstado(t.id, 'TASK_STATE_COMPLETED'), 'TASK_STATE_COMPLETED');
    const final = tarefaDe(registrar(await a2a(agente.rpc, 'GetTask', { id: t.id })).corpo);
    assert.equal(JSON.parse(final.artifacts[0].parts[0].text).sala, 'sala-porao');
  } finally {
    gravador.atrasar('tools/call', 0);
  }
});

test('CancelTask com a Task em WORKING e recusado (-32002) e a execucao em curso conclui', async () => {
  gravador.atrasar('tools/call', 1500);
  try {
    const t = tarefaDe(registrar(await enviar(agente.rpc, `reservar sala=sala-aquario inicio=${h9('09:00')} fim=${h9('10:00')} responsavel=Doc`, { configuration: { returnImmediately: true } })).corpo);
    assert.equal(await esperarEstado(t.id, 'TASK_STATE_WORKING'), 'TASK_STATE_WORKING');
    const c = registrar(await a2a(agente.rpc, 'CancelTask', { id: t.id }));
    assert.equal(c.corpo.error?.code, -32002, JSON.stringify(c.corpo));
    assert.equal(await esperarEstado(t.id, 'TASK_STATE_COMPLETED'), 'TASK_STATE_COMPLETED');
  } finally {
    gravador.atrasar('tools/call', 0);
  }
});

test('CancelTask numa Task pausada termina em CANCELED e a escolha depois e recusada', async () => {
  const p = tarefaDe(registrar(await enviar(agente.rpc, `reservar sala=sala-porao inicio=${h9('09:00')} fim=${h9('10:00')} responsavel=Biff`)).corpo);
  assert.equal(p.status.state, 'TASK_STATE_INPUT_REQUIRED');
  const c = registrar(await a2a(agente.rpc, 'CancelTask', { id: p.id }));
  assert.equal(tarefaDe(c.corpo).status.state, 'TASK_STATE_CANCELED', JSON.stringify(c.corpo));
  const depois = registrar(await enviar(agente.rpc, 'escolha=sala-fusca', { taskId: p.id }));
  assert.equal(depois.corpo.error?.code, -32004);
});

test('34: nenhuma resposta A2A carrega algum requestState emitido pelo MCP', async () => {
  const estados = gravador.trocas.map((t) => t.resposta?.result?.requestState).filter(Boolean);
  assert.ok(estados.length >= 5);
  for (const corpo of respostasA2a) {
    for (const s of estados) {
      assert.ok(!corpo.includes(s), 'requestState inteiro vazou');
      assert.ok(!corpo.includes(s.slice(0, 40)), 'prefixo do requestState vazou');
      assert.ok(!corpo.includes(s.split('.')[2]), 'MAC do requestState vazou');
    }
  }
});
