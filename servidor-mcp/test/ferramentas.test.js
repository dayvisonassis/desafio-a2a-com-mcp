import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { subirServidorMcp, mcp, texto } from '../../apoio-teste/processos.js';

const h = (hora) => `2026-11-03T${hora}:00-03:00`;
let srv;
before(async () => { srv = await subirServidorMcp(); });
after(async () => { await srv.parar(); });

const chamar = (nome, args) => mcp(srv.url, 'tools/call', { name: nome, arguments: args }, { nome }).then((r) => r.corpo.result);
const consultar = (sala, inicio, fim) => chamar('consultar_disponibilidade', { sala, inicio, fim });
const reservar = (sala, inicio, fim, responsavel = 'Doc') => chamar('reservar_sala', { sala, inicio, fim, responsavel });

function assertErro(res, mensagem) {
  assert.equal(res.isError, true, JSON.stringify(res));
  assert.equal(res.resultType, 'complete');
  assert.equal(texto(res), mensagem);
}

test('reservar sala inexistente devolve isError com a mensagem exata', async () => {
  assertErro(await reservar('sala-delorean', h('09:00'), h('10:00')), 'Sala inexistente: sala-delorean');
});

test('consultar fora da janela, acima de 2h e com intervalo invertido devolvem as mensagens exatas', async () => {
  assertErro(await consultar('sala-aquario', h('07:00'), h('08:00')), 'Fora da janela de uso: a politica permite reservas entre 08:00 e 20:00');
  assertErro(await consultar('sala-aquario', h('09:00'), h('12:00')), 'Duracao acima do limite: a politica permite no maximo 2 horas');
  assertErro(await consultar('sala-aquario', h('10:00'), h('09:00')), 'Intervalo invalido: fim deve ser posterior a inicio');
});

test('reservar aplica as mesmas validacoes de politica', async () => {
  assertErro(await reservar('sala-aquario', h('07:00'), h('08:00')), 'Fora da janela de uso: a politica permite reservas entre 08:00 e 20:00');
  assertErro(await reservar('sala-aquario', h('09:00'), h('12:00')), 'Duracao acima do limite: a politica permite no maximo 2 horas');
  assertErro(await reservar('sala-aquario', h('10:00'), h('09:00')), 'Intervalo invalido: fim deve ser posterior a inicio');
});

test('consultar aplica a mesma validacao de sala', async () => {
  assertErro(await consultar('sala-delorean', h('09:00'), h('10:00')), 'Sala inexistente: sala-delorean');
});

test('data fora do ISO 8601 com offset devolve isError de formato nas duas tools', async () => {
  for (const res of [await consultar('sala-aquario', '2026-11-03T09:00:00', h('10:00')), await reservar('sala-aquario', '2026-11-31T09:00:00-03:00', '2026-11-31T10:00:00-03:00')]) {
    assert.equal(res.isError, true);
    assert.match(texto(res), /ISO 8601/);
  }
});

test('consultar intervalo livre devolve livre=true sem conflitos, em structuredContent e texto', async () => {
  const res = await consultar('sala-aquario', h('09:00'), h('10:00'));
  assert.ok(!res.isError);
  assert.deepEqual(res.structuredContent, { sala: 'sala-aquario', livre: true, conflitos: [] });
  assert.equal(res.content.length, 1);
  assert.deepEqual(JSON.parse(res.content[0].text), res.structuredContent);
});

test('consultar intervalo ocupado devolve as reservas em conflito', async () => {
  const res = await consultar('sala-garagem', h('14:30'), h('15:30'));
  assert.deepEqual(res.structuredContent, {
    sala: 'sala-garagem',
    livre: false,
    conflitos: [{ id: 'res-0001', inicio: h('14:00'), fim: h('15:00'), responsavel: 'Marty' }],
  });
});

test('reservar intervalo livre cria a reserva, que aparece na consulta seguinte do mesmo processo', async () => {
  const res = await reservar('sala-aquario', h('09:00'), h('10:00'), 'Doc');
  assert.equal(res.resultType, 'complete');
  assert.ok(!res.isError);
  assert.deepEqual(res.structuredContent, {
    reserva: 'res-0003',
    reservado: true,
    sala: 'sala-aquario',
    inicio: h('09:00'),
    fim: h('10:00'),
    responsavel: 'Doc',
    politica: '2026-11-01',
    motivo: null,
  });
  assert.equal(res.content.length, 1);
  assert.deepEqual(JSON.parse(res.content[0].text), res.structuredContent);

  const consulta = await consultar('sala-aquario', h('09:30'), h('10:30'));
  assert.equal(consulta.structuredContent.livre, false);
  assert.deepEqual(consulta.structuredContent.conflitos.map((c) => c.id), ['res-0003']);
});

test('reservar devolve inicio e fim como as strings recebidas, sem reserializar', async () => {
  const res = await reservar('sala-porao', '2026-11-03T13:00:00Z', '2026-11-03T14:00:00Z');
  assert.equal(res.structuredContent.inicio, '2026-11-03T13:00:00Z');
  assert.equal(res.structuredContent.fim, '2026-11-03T14:00:00Z');
});
