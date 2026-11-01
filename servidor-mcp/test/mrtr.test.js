import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { subirServidorMcp, mcp, texto, traceparentNovo } from '../../apoio-teste/processos.js';

const h = (hora, dia = '2026-11-03') => `${dia}T${hora}:00-03:00`;
const MENSAGEM = 'A sala pedida esta ocupada nesse intervalo. Escolha uma alternativa.';

let srv;
before(async () => { srv = await subirServidorMcp(); });
after(async () => { await srv?.parar(); });

const reservar = (url, sala, inicio, fim, responsavel = 'Validador', opcoes = {}) =>
  mcp(url, 'tools/call', { name: 'reservar_sala', arguments: { sala, inicio, fim, responsavel } }, { nome: 'reservar_sala', ...opcoes });

// Espelha retomar() de validador/validar.py.
const retomar = (url, args, inputResponses, requestState) =>
  mcp(url, 'tools/call', { name: 'reservar_sala', arguments: args, inputResponses, requestState }, { nome: 'reservar_sala' });

function pedidoDe(resultado) {
  const chaves = Object.keys(resultado.inputRequests ?? {});
  assert.equal(chaves.length, 1, JSON.stringify(resultado));
  return { chave: chaves[0], pedido: resultado.inputRequests[chaves[0]], estado: resultado.requestState };
}

let conflito; // garagem 14-15, usado em varios testes (nada e gravado no conflito)

test('conflito devolve input_required com uma elicitation em form mode e requestState', async () => {
  const r = await reservar(srv.url, 'sala-garagem', h('14:00'), h('15:00'), 'Marty', { traceparent: traceparentNovo() });
  assert.equal(r.status, 200);
  const res = r.corpo.result;
  assert.equal(res.resultType, 'input_required');
  conflito = pedidoDe(res);
  assert.equal(typeof conflito.estado, 'string');
  assert.ok(conflito.estado.length > 0);
  assert.equal(conflito.pedido.method, 'elicitation/create');
  assert.equal(conflito.pedido.params.mode, 'form');
  assert.equal(conflito.pedido.params.message, MENSAGEM);
  assert.deepEqual(conflito.pedido.params.requestedSchema, {
    type: 'object',
    properties: { sala: { type: 'string', title: 'Sala', description: 'Sala alternativa escolhida', enum: ['sala-fusca', 'sala-mirante'] } },
    required: ['sala'],
  });
});

test('o mesmo conflito sem a capability de elicitation devolve -32021 com HTTP 400 e nao grava nada', async () => {
  const r = await reservar(srv.url, 'sala-garagem', h('14:00'), h('15:00'), 'Marty', { capabilities: {} });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.error.code, -32021);
  assert.ok(r.corpo.error.data.requiredCapabilities, JSON.stringify(r.corpo.error));
  for (const sala of ['sala-fusca', 'sala-mirante']) {
    const c = await mcp(srv.url, 'tools/call', { name: 'consultar_disponibilidade', arguments: { sala, inicio: h('14:00'), fim: h('15:00') } }, { nome: 'consultar_disponibilidade' });
    assert.equal(c.corpo.result.structuredContent.livre, true, sala);
  }
});

test('o requestState de reservar_sala apresentado em outra tool e rejeitado com -32602', async () => {
  for (const [nome, args] of [['listar_salas', {}], ['consultar_disponibilidade', { sala: 'sala-garagem', inicio: h('14:00'), fim: h('15:00') }]]) {
    const r = await mcp(srv.url, 'tools/call', { name: nome, arguments: args, inputResponses: { [conflito.chave]: { action: 'decline' } }, requestState: conflito.estado }, { nome });
    assert.equal(r.corpo.error?.code, -32602, `${nome}: ${JSON.stringify(r.corpo)}`);
  }
});

test('sem a capability, uma sala livre reserva normalmente', async () => {
  const r = await reservar(srv.url, 'sala-aquario', h('13:00'), h('14:00'), 'Doc', { capabilities: {} });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.result.structuredContent.reservado, true);
});

test('retry com accept conclui a reserva na sala escolhida', async () => {
  const args = { sala: 'sala-fusca', inicio: h('16:00'), fim: h('17:00'), responsavel: 'Validador' };
  const { chave, pedido, estado } = pedidoDe((await reservar(srv.url, args.sala, args.inicio, args.fim)).corpo.result);
  assert.deepEqual(pedido.params.requestedSchema.properties.sala.enum, ['sala-garagem', 'sala-mirante']);
  const r = await retomar(srv.url, args, { [chave]: { action: 'accept', content: { sala: 'sala-garagem' } } }, estado);
  const res = r.corpo.result;
  assert.equal(res.resultType, 'complete');
  assert.ok(!res.isError);
  assert.deepEqual(res.structuredContent, {
    reserva: res.structuredContent.reserva,
    reservado: true,
    sala: 'sala-garagem',
    inicio: h('16:00'),
    fim: h('17:00'),
    responsavel: 'Validador',
    politica: '2026-11-01',
    motivo: null,
  });
  assert.match(res.structuredContent.reserva, /^res-\d{4}$/);
});

test('requestState com os ultimos 6 caracteres trocados e rejeitado com -32602', async () => {
  const adulterado = conflito.estado.slice(0, -6) + (conflito.estado.endsWith('AAAAAA') ? 'BBBBBB' : 'AAAAAA');
  const r = await retomar(srv.url, { sala: 'sala-garagem', inicio: h('14:00'), fim: h('15:00'), responsavel: 'Validador' },
    { [conflito.chave]: { action: 'accept', content: { sala: 'sala-fusca' } } }, adulterado);
  assert.notEqual(r.status, 500);
  assert.equal(r.corpo.error?.code, -32602, JSON.stringify(r.corpo));
  assert.equal(r.corpo.result, undefined);
});

test('requestState malformado e rejeitado com -32602', async () => {
  for (const ruim of ['sem-ponto', conflito.estado.replace(/^v1\./, 'v2.'), `${conflito.estado}!`, 12345]) {
    const r = await retomar(srv.url, { sala: 'sala-garagem', inicio: h('14:00'), fim: h('15:00'), responsavel: 'Validador' },
      { [conflito.chave]: { action: 'accept', content: { sala: 'sala-fusca' } } }, ruim);
    assert.equal(r.corpo.error?.code, -32602, `${String(ruim).slice(0, 12)}: ${JSON.stringify(r.corpo)}`);
  }
});

test('o mesmo requestState valido funciona depois de uma copia adulterada ser rejeitada (decline)', async () => {
  const r = await retomar(srv.url, { sala: 'sala-garagem', inicio: h('14:00'), fim: h('15:00'), responsavel: 'Validador' },
    { [conflito.chave]: { action: 'decline' } }, conflito.estado);
  const res = r.corpo.result;
  assert.equal(res.resultType, 'complete');
  assert.ok(!res.isError);
  assert.equal(res.structuredContent.reservado, false);
  assert.equal(res.structuredContent.motivo, 'recusado');
  assert.equal(res.structuredContent.reserva, null);
});

test('argumentos adulterados no retry nao tomam efeito: valem os valores selados', async () => {
  await reservar(srv.url, 'sala-garagem', h('09:00'), h('10:00'), 'Ocupante');
  const { chave, estado } = pedidoDe((await reservar(srv.url, 'sala-garagem', h('09:00'), h('10:00'), 'Doc')).corpo.result);
  const r = await retomar(srv.url, { sala: 'sala-mirante', inicio: h('13:00'), fim: h('14:00'), responsavel: 'Biff' },
    { [chave]: { action: 'accept', content: { sala: 'sala-fusca' } } }, estado);
  const dados = r.corpo.result.structuredContent;
  assert.equal(dados.sala, 'sala-fusca');
  assert.equal(dados.inicio, h('09:00'));
  assert.equal(dados.fim, h('10:00'));
  assert.equal(dados.responsavel, 'Doc');
});

test('conflito sem alternativa possivel devolve isError sem elicitation', async () => {
  await reservar(srv.url, 'sala-mirante', h('11:00'), h('12:00'));
  const res = (await reservar(srv.url, 'sala-mirante', h('11:00'), h('12:00'))).corpo.result;
  assert.equal(res.isError, true);
  assert.equal(res.inputRequests, undefined);
  assert.equal(texto(res), 'Sem alternativas disponiveis no intervalo');
});

let outroDia; // garagem 04/11 10-11, alternativas [fusca, mirante]

test('accept com sala fora das alternativas seladas devolve isError e nao reserva', async () => {
  const dia = '2026-11-04';
  await reservar(srv.url, 'sala-garagem', h('10:00', dia), h('11:00', dia), 'Ocupante');
  outroDia = {
    args: { sala: 'sala-garagem', inicio: h('10:00', dia), fim: h('11:00', dia), responsavel: 'Doc' },
    ...pedidoDe((await reservar(srv.url, 'sala-garagem', h('10:00', dia), h('11:00', dia), 'Doc')).corpo.result),
  };
  const res = (await retomar(srv.url, outroDia.args, { [outroDia.chave]: { action: 'accept', content: { sala: 'sala-aquario' } } }, outroDia.estado)).corpo.result;
  assert.equal(res.isError, true);
  const livre = (await mcp(srv.url, 'tools/call', { name: 'consultar_disponibilidade', arguments: { sala: 'sala-aquario', inicio: h('10:00', dia), fim: h('11:00', dia) } }, { nome: 'consultar_disponibilidade' })).corpo.result;
  assert.equal(livre.structuredContent.livre, true);
});

test('cancel conclui sem reservar e sem isError', async () => {
  const res = (await retomar(srv.url, outroDia.args, { [outroDia.chave]: { action: 'cancel' } }, outroDia.estado)).corpo.result;
  assert.equal(res.resultType, 'complete');
  assert.ok(!res.isError);
  assert.equal(res.structuredContent.reservado, false);
  assert.equal(res.structuredContent.motivo, 'cancelado');
});

test('retry sem resposta para a chave pede a escolha de novo', async () => {
  const res = (await retomar(srv.url, outroDia.args, {}, outroDia.estado)).corpo.result;
  assert.equal(res.resultType, 'input_required');
  assert.deepEqual(pedidoDe(res).pedido.params.requestedSchema.properties.sala.enum, ['sala-fusca', 'sala-mirante']);
});

test('se a sala escolhida foi ocupada antes do retry, pede de novo com as alternativas recalculadas (enum mesmo com uma so)', async () => {
  await reservar(srv.url, 'sala-fusca', outroDia.args.inicio, outroDia.args.fim, 'Apressado');
  const res = (await retomar(srv.url, outroDia.args, { [outroDia.chave]: { action: 'accept', content: { sala: 'sala-fusca' } } }, outroDia.estado)).corpo.result;
  assert.equal(res.resultType, 'input_required');
  const novo = pedidoDe(res);
  assert.deepEqual(novo.pedido.params.requestedSchema.properties.sala.enum, ['sala-mirante']);
  assert.equal(novo.pedido.params.requestedSchema.properties.sala.const, undefined);
  assert.notEqual(novo.estado, outroDia.estado);
});

test('o retry funciona depois de reiniciar o servidor MCP com a mesma chave', async () => {
  const primeiro = await subirServidorMcp();
  const args = { sala: 'sala-garagem', inicio: h('14:00'), fim: h('15:00'), responsavel: 'Marty' };
  let pendente;
  try {
    pendente = pedidoDe((await reservar(primeiro.url, args.sala, args.inicio, args.fim, args.responsavel)).corpo.result);
  } finally {
    await primeiro.parar();
  }
  const segundo = await subirServidorMcp();
  try {
    const res = (await retomar(segundo.url, args, { [pendente.chave]: { action: 'accept', content: { sala: 'sala-mirante' } } }, pendente.estado)).corpo.result;
    assert.equal(res.resultType, 'complete');
    assert.equal(res.structuredContent.sala, 'sala-mirante');
    assert.equal(res.structuredContent.responsavel, 'Marty');
  } finally {
    await segundo.parar();
  }
});
