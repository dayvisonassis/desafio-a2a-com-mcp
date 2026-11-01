import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { subirServidorMcp, mcp as chamarMcp } from '../../apoio-teste/processos.js';
import { subirGravador } from '../../apoio-teste/gravador.js';
import { criarClienteMcp } from '../src/mcp-cliente.js';
import { criarPonte } from '../src/ponte.js';
import { novoTrace } from '../src/trace.js';

const h = (hora, dia = '2026-11-03') => `${dia}T${hora}:00-03:00`;
const pedido = (sala, ini, fim, resp = 'Doc', dia) => `reservar sala=${sala} inicio=${h(ini, dia)} fim=${h(fim, dia)} responsavel=${resp}`;

let mcp;
let gravador;
let cliente;
let ponte;
let seq = 0;
const novaTask = () => `task-pausa-${++seq}`;

before(async () => {
  mcp = await subirServidorMcp();
  gravador = await subirGravador(mcp.url);
  cliente = criarClienteMcp({ url: gravador.url });
  await cliente.conectar();
  ponte = criarPonte({ cliente });
});
after(async () => {
  await cliente?.fechar();
  await gravador?.parar();
  await mcp?.parar();
});

const reservarDireto = (sala, ini, fim, dia) => chamarMcp(mcp.url, 'tools/call',
  { name: 'reservar_sala', arguments: { sala, inicio: h(ini, dia), fim: h(fim, dia), responsavel: 'Direto' } }, { nome: 'reservar_sala' });

test('input_required vira INPUT_REQUIRED com exatamente a linha de alternativas', async () => {
  const d = await ponte.iniciar(novaTask(), pedido('sala-garagem', '14:00', '15:00', 'Marty'), novoTrace());
  assert.deepEqual(d, { estado: 'INPUT_REQUIRED', texto: 'alternativas: sala-fusca, sala-mirante' });
});

test('escolha fora do enum ou fora do formato mantem a pausa, repete a linha e nao fala com o MCP', async () => {
  const task = novaTask();
  await ponte.iniciar(task, pedido('sala-garagem', '14:00', '15:00', 'Marty'), novoTrace());
  const antes = gravador.trocas.length;
  for (const texto of ['escolha=sala-aquario', 'oi', 'escolha=', 'escolha=sala-garagem']) {
    assert.deepEqual(await ponte.continuar(task, texto), { estado: 'INPUT_REQUIRED', texto: 'alternativas: sala-fusca, sala-mirante' }, texto);
  }
  assert.equal(gravador.trocas.length, antes);
});

test('a escolha valida refaz o tools/call com id novo, a mesma chave, o requestState intacto e o trace guardado', async () => {
  const task = novaTask();
  const trace = novoTrace();
  await ponte.iniciar(task, pedido('sala-garagem', '14:00', '15:00', 'Marty'), trace);
  const inicial = gravador.requests('tools/call').at(-1);
  const d = await ponte.continuar(task, 'escolha=sala-fusca');
  assert.equal(d.estado, 'COMPLETED');
  assert.equal(JSON.parse(d.artifact.texto).sala, 'sala-fusca');
  assert.equal(JSON.parse(d.artifact.texto).politica, '2026-11-01');

  const retry = gravador.requests('tools/call').at(-1);
  const chave = Object.keys(inicial.resposta.result.inputRequests)[0];
  assert.notEqual(retry.corpo.id, inicial.corpo.id);
  assert.equal(retry.corpo.params.requestState, inicial.resposta.result.requestState);
  assert.deepEqual(retry.corpo.params.inputResponses, { [chave]: { action: 'accept', content: { sala: 'sala-fusca' } } });
  assert.deepEqual(retry.corpo.params.arguments, inicial.corpo.params.arguments);
  assert.equal(retry.corpo.params.name, 'reservar_sala');
  assert.equal(retry.corpo.params._meta.traceparent.split('-')[1], trace.traceId);
  assert.notEqual(retry.corpo.params._meta.traceparent, inicial.corpo.params._meta.traceparent);
});

test('escolha=recusar manda decline e termina em CANCELED', async () => {
  const task = novaTask();
  await ponte.iniciar(task, pedido('sala-garagem', '14:30', '15:30', 'Biff'), novoTrace());
  const d = await ponte.continuar(task, 'escolha=recusar');
  assert.equal(d.estado, 'CANCELED');
  const retry = gravador.requests('tools/call').at(-1);
  assert.deepEqual(Object.values(retry.corpo.params.inputResponses), [{ action: 'decline' }]);
});

test('duas Tasks pausadas ao mesmo tempo concluem cada uma com o seu requestState', async () => {
  const a = novaTask();
  const b = novaTask();
  const dia = '2026-11-04';
  await reservarDireto('sala-fusca', '16:00', '17:00', dia);
  await reservarDireto('sala-garagem', '14:00', '15:00', dia);
  assert.equal((await ponte.iniciar(a, pedido('sala-fusca', '16:00', '17:00', 'Lorraine', dia), novoTrace())).estado, 'INPUT_REQUIRED');
  const estadoA = gravador.requests('tools/call').at(-1).resposta.result.requestState;
  assert.equal((await ponte.iniciar(b, pedido('sala-garagem', '14:00', '15:00', 'George', dia), novoTrace())).estado, 'INPUT_REQUIRED');
  const estadoB = gravador.requests('tools/call').at(-1).resposta.result.requestState;

  const da = await ponte.continuar(a, 'escolha=sala-mirante');
  assert.equal(gravador.requests('tools/call').at(-1).corpo.params.requestState, estadoA);
  const db = await ponte.continuar(b, 'escolha=sala-mirante');
  assert.equal(gravador.requests('tools/call').at(-1).corpo.params.requestState, estadoB);

  const ra = JSON.parse(da.artifact.texto);
  const rb = JSON.parse(db.artifact.texto);
  assert.equal(ra.responsavel, 'Lorraine');
  assert.equal(rb.responsavel, 'George');
  assert.notEqual(ra.reserva, rb.reserva);
  assert.notEqual(ra.inicio, rb.inicio);
});

test('se o retry volta com novo input_required, a Task pausa de novo com as alternativas novas', async () => {
  const task = novaTask();
  const dia = '2026-11-05';
  await reservarDireto('sala-garagem', '14:00', '15:00', dia);
  assert.equal((await ponte.iniciar(task, pedido('sala-garagem', '14:00', '15:00', 'Marty', dia), novoTrace())).texto, 'alternativas: sala-fusca, sala-mirante');
  await reservarDireto('sala-fusca', '14:00', '15:00', dia);
  assert.deepEqual(await ponte.continuar(task, 'escolha=sala-fusca'), { estado: 'INPUT_REQUIRED', texto: 'alternativas: sala-mirante' });
  const d = await ponte.continuar(task, 'escolha=sala-mirante');
  assert.equal(d.estado, 'COMPLETED');
  assert.equal(JSON.parse(d.artifact.texto).sala, 'sala-mirante');
});

test('erro JSON-RPC no retry termina em FAILED', async () => {
  const task = novaTask();
  const dia = '2026-11-06';
  await reservarDireto('sala-garagem', '14:00', '15:00', dia);
  await ponte.iniciar(task, pedido('sala-garagem', '14:00', '15:00', 'Marty', dia), novoTrace());
  const outro = await subirServidorMcp({ segredo: 'ab'.repeat(32) });
  try {
    gravador.apontarPara(outro.url);
    const d = await ponte.continuar(task, 'escolha=sala-fusca');
    assert.equal(d.estado, 'FAILED');
    assert.match(d.texto, /requestState/i);
  } finally {
    gravador.apontarPara(mcp.url);
    await outro.parar();
  }
});

test('continuar uma Task sem pendencia termina em FAILED', async () => {
  const d = await ponte.continuar('task-que-nunca-pausou', 'escolha=sala-fusca');
  assert.equal(d.estado, 'FAILED');
});

test('nenhum desfecho carrega o requestState', async () => {
  const task = novaTask();
  const pausa = await ponte.iniciar(task, pedido('sala-porao', '15:00', '16:00', 'Doc', '2026-11-07'), novoTrace());
  const fim = await ponte.continuar(task, 'escolha=recusar');
  const estados = gravador.trocas.map((t) => t.resposta?.result?.requestState).filter(Boolean);
  for (const d of [pausa, fim]) {
    for (const s of estados) assert.ok(!JSON.stringify(d).includes(s.slice(0, 40)));
  }
});

test('o mesmo pedido em duas Tasks produz a mesma pausa (determinismo)', async () => {
  const p = pedido('sala-garagem', '14:00', '15:00', 'Doc', '2026-11-08');
  await reservarDireto('sala-garagem', '14:00', '15:00', '2026-11-08');
  const a = await ponte.iniciar(novaTask(), p, novoTrace());
  const b = await ponte.iniciar(novaTask(), p, novoTrace());
  assert.deepEqual(a, b);
  assert.ok(a.texto.startsWith('alternativas:'));
});

test('duas continuacoes simultaneas da mesma Task mandam um retry so', async () => {
  const task = novaTask();
  const dia = '2026-11-10';
  await reservarDireto('sala-garagem', '14:00', '15:00', dia);
  await ponte.iniciar(task, pedido('sala-garagem', '14:00', '15:00', 'Marty', dia), novoTrace());
  const antes = gravador.requests('tools/call').length;
  const [a, b] = await Promise.all([ponte.continuar(task, 'escolha=sala-fusca'), ponte.continuar(task, 'escolha=sala-fusca')]);
  assert.equal(gravador.requests('tools/call').length, antes + 1);
  assert.deepEqual([a.estado, b.estado].sort(), ['COMPLETED', 'FAILED']);
});

// Dublê do cliente MCP so para formas que o nosso servidor nao emite.
function clienteFalso(inputRequests, aposRetry) {
  return {
    listarTools: async () => [{ name: 'reservar_sala' }],
    lerPolitica: async () => ({ versao: 'x' }),
    chamarTool: async (nome, args, tp, retry) => (retry?.requestState && aposRetry
      ? aposRetry
      : { tipo: 'input_required', inputRequests, requestState: 'ESTADO' }),
  };
}

const perguntaSimples = { k: { method: 'elicitation/create', params: { mode: 'form', requestedSchema: { type: 'object', properties: { sala: { type: 'string', enum: ['sala-fusca'] } } } } } };

test('retry que volta com isError termina em FAILED com a mensagem e encerra a pendencia', async () => {
  const p = criarPonte({ cliente: clienteFalso(perguntaSimples, { tipo: 'complete', result: { isError: true, content: [{ type: 'text', text: 'Escolha invalida: x' }] } }) });
  await p.iniciar('t-err', pedido('sala-garagem', '14:00', '15:00'), novoTrace());
  assert.deepEqual(await p.continuar('t-err', 'escolha=sala-fusca'), { estado: 'FAILED', texto: 'Escolha invalida: x' });
  assert.equal((await p.continuar('t-err', 'escolha=sala-fusca')).estado, 'FAILED');
});

test('enum vazio termina em FAILED', async () => {
  const p = criarPonte({ cliente: clienteFalso({ k: { method: 'elicitation/create', params: { requestedSchema: { properties: { sala: { type: 'string', enum: [] } } } } } }) });
  assert.equal((await p.iniciar('t', pedido('sala-garagem', '14:00', '15:00'), novoTrace())).estado, 'FAILED');
});

test('aceita a elicitation com const quando ha uma alternativa so', async () => {
  const p = criarPonte({ cliente: clienteFalso({ k: { method: 'elicitation/create', params: { mode: 'form', requestedSchema: { type: 'object', properties: { sala: { type: 'string', const: 'sala-mirante' } } } } } }) });
  assert.deepEqual(await p.iniciar('t', pedido('sala-garagem', '14:00', '15:00'), novoTrace()), { estado: 'INPUT_REQUIRED', texto: 'alternativas: sala-mirante' });
});

test('input_required que nao e uma elicitation de escolha termina em FAILED', async () => {
  const p = criarPonte({ cliente: clienteFalso({ k: { method: 'sampling/createMessage', params: {} } }) });
  assert.equal((await p.iniciar('t', pedido('sala-garagem', '14:00', '15:00'), novoTrace())).estado, 'FAILED');
});
