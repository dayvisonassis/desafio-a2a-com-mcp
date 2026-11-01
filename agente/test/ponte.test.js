import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { subirServidorMcp } from '../../apoio-teste/processos.js';
import { subirGravador } from '../../apoio-teste/gravador.js';
import { criarClienteMcp } from '../src/mcp-cliente.js';
import { criarPonte } from '../src/ponte.js';
import { novoTrace } from '../src/trace.js';

const h = (hora) => `2026-11-03T${hora}:00-03:00`;
const pedido = (sala, ini, fim, resp = 'Doc') => `reservar sala=${sala} inicio=${h(ini)} fim=${h(fim)} responsavel=${resp}`;

let mcp;
let gravador;
let cliente;
let ponte;
let seq = 0;
const novaTask = () => `task-teste-${++seq}`;

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

test('sala livre: COMPLETED com o artifact reserva e a politica lida do resource', async () => {
  const d = await ponte.iniciar(novaTask(), pedido('sala-porao', '09:00', '10:00'), novoTrace());
  assert.equal(d.estado, 'COMPLETED');
  assert.equal(d.artifact.name, 'reserva');
  assert.deepEqual(JSON.parse(d.artifact.texto), {
    reserva: 'res-0003', sala: 'sala-porao', inicio: h('09:00'), fim: h('10:00'), responsavel: 'Doc', politica: '2026-11-01',
  });
  assert.equal(d.texto, 'Reserva res-0003 confirmada na sala-porao.');
});

test('a Task faz tools/list, resources/read e tools/call, todos com o mesmo trace-id e span-ids novos', async () => {
  const trace = novoTrace();
  const antes = gravador.trocas.length;
  await ponte.iniciar(novaTask(), pedido('sala-aquario', '09:00', '10:00'), trace);
  const desta = gravador.trocas.slice(antes).filter((t) => t.corpo?.method);
  assert.deepEqual(desta.map((t) => t.corpo.method), ['tools/list', 'resources/read', 'tools/call']);
  const tps = desta.map((t) => t.corpo.params._meta.traceparent);
  for (const tp of tps) assert.equal(tp.split('-')[1], trace.traceId);
  assert.equal(new Set(tps.map((tp) => tp.split('-')[2])).size, 3);
  assert.deepEqual(desta[2].corpo.params.arguments, { sala: 'sala-aquario', inicio: h('09:00'), fim: h('10:00'), responsavel: 'Doc' });
});

test('isError da tool termina em FAILED com a mensagem exata da tool', async () => {
  const d = await ponte.iniciar(novaTask(), pedido('sala-delorean', '09:00', '10:00'), novoTrace());
  assert.equal(d.estado, 'FAILED');
  assert.match(d.texto, /Sala inexistente: sala-delorean/);
  assert.equal(d.artifact, undefined);
});

test('erro de politica da tool tambem termina em FAILED com a mensagem', async () => {
  const d = await ponte.iniciar(novaTask(), pedido('sala-aquario', '07:00', '08:00'), novoTrace());
  assert.equal(d.estado, 'FAILED');
  assert.match(d.texto, /Fora da janela de uso: a politica permite reservas entre 08:00 e 20:00/);
});

test('pedido fora do formato termina em FAILED sem falar com o MCP', async () => {
  const antes = gravador.trocas.length;
  const d = await ponte.iniciar(novaTask(), 'quero a sala grande amanha', novoTrace());
  assert.equal(d.estado, 'FAILED');
  assert.match(d.texto, /reservar sala=<id> inicio=<iso8601> fim=<iso8601> responsavel=<nome>/);
  assert.equal(gravador.trocas.length, antes);
});

test('o mesmo pedido em duas Tasks produz o mesmo desfecho (determinismo)', async () => {
  const a = await ponte.iniciar(novaTask(), pedido('sala-delorean', '09:00', '10:00'), novoTrace());
  const b = await ponte.iniciar(novaTask(), pedido('sala-delorean', '09:00', '10:00'), novoTrace());
  assert.deepEqual(a, b);
});

test('MCP fora do ar termina em FAILED com mensagem, sem lancar', async () => {
  const morto = criarPonte({ cliente: criarClienteMcp({ url: 'http://localhost:1/mcp', tentativas: 1, intervaloMs: 1 }) });
  const d = await morto.iniciar(novaTask(), pedido('sala-porao', '11:00', '12:00'), novoTrace());
  assert.equal(d.estado, 'FAILED');
  assert.match(d.texto, /servidor MCP/);
});
