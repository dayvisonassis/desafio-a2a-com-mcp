import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAgenda, MENSAGENS } from '../src/dominio.js';
import { carregarDados } from '../src/dados.js';

const DIA = '2026-11-03';
const h = (hora) => `${DIA}T${hora}:00-03:00`;
const novaAgenda = () => criarAgenda(carregarDados());

test('mensagens exatas do enunciado', () => {
  assert.equal(MENSAGENS.salaInexistente('sala-delorean'), 'Sala inexistente: sala-delorean');
  assert.equal(MENSAGENS.janela, 'Fora da janela de uso: a politica permite reservas entre 08:00 e 20:00');
  assert.equal(MENSAGENS.duracao, 'Duracao acima do limite: a politica permite no maximo 2 horas');
  assert.equal(MENSAGENS.intervalo, 'Intervalo invalido: fim deve ser posterior a inicio');
  assert.equal(MENSAGENS.semAlternativas, 'Sem alternativas disponiveis no intervalo');
});

test('as quatro validacoes, com as entradas do validador', () => {
  const a = novaAgenda();
  assert.equal(a.validar('sala-delorean', h('09:00'), h('10:00')), 'Sala inexistente: sala-delorean');
  assert.equal(a.validar('sala-aquario', h('07:00'), h('08:00')), MENSAGENS.janela);
  assert.equal(a.validar('sala-aquario', h('09:00'), h('12:00')), MENSAGENS.duracao);
  assert.equal(a.validar('sala-aquario', h('10:00'), h('09:00')), MENSAGENS.intervalo);
  assert.equal(a.validar('sala-aquario', h('09:00'), h('10:00')), null);
});

test('sala inexistente vem antes de qualquer erro de horario', () => {
  assert.equal(novaAgenda().validar('sala-x', h('10:00'), h('09:00')), 'Sala inexistente: sala-x');
});

test('intervalo vazio e invalido', () => {
  assert.equal(novaAgenda().validar('sala-aquario', h('09:00'), h('09:00')), MENSAGENS.intervalo);
});

test('data sem offset ou fora do ISO 8601 e recusada com mensagem de formato', () => {
  const a = novaAgenda();
  assert.match(a.validar('sala-aquario', '2026-11-03T09:00:00', h('10:00')), /ISO 8601/);
  assert.match(a.validar('sala-aquario', h('09:00'), 'amanha'), /ISO 8601/);
});

test('datas que nao existem no calendario sao recusadas com mensagem de formato', () => {
  const a = novaAgenda();
  for (const dia of ['2026-11-31', '2026-02-30', '2026-02-29', '2026-13-01', '2026-11-00']) {
    assert.match(a.validar('sala-aquario', `${dia}T09:00:00-03:00`, `${dia}T10:00:00-03:00`), /ISO 8601/, dia);
  }
  assert.match(a.validar('sala-aquario', '2026-11-03T24:00:00-03:00', '2026-11-04T01:00:00-03:00'), /ISO 8601/);
});

test('29 de fevereiro de ano bissexto e aceito', () => {
  assert.equal(novaAgenda().validar('sala-aquario', '2028-02-29T09:00:00-03:00', '2028-02-29T10:00:00-03:00'), null);
});

test('conflito e detectado entre offsets diferentes', () => {
  const a = novaAgenda();
  a.criar({ sala: 'sala-aquario', inicio: '2026-11-03T12:00:00Z', fim: '2026-11-03T13:00:00Z', responsavel: 'Doc' });
  assert.deepEqual(a.conflitos('sala-aquario', h('09:30'), h('09:45')).map((c) => c.id), ['res-0003']);
  assert.deepEqual(a.conflitos('sala-aquario', h('10:00'), h('11:00')), []);
});

test('bordas da janela: 08:00 e 20:00 sao permitidos', () => {
  const a = novaAgenda();
  assert.equal(a.validar('sala-aquario', h('08:00'), h('09:00')), null);
  assert.equal(a.validar('sala-aquario', h('19:00'), h('20:00')), null);
  assert.equal(a.validar('sala-aquario', h('07:59'), h('09:00')), MENSAGENS.janela);
  assert.equal(a.validar('sala-aquario', h('19:00'), h('20:01')), MENSAGENS.janela);
});

test('a janela e no horario de Sao Paulo mesmo com outro offset', () => {
  const a = novaAgenda();
  assert.equal(a.validar('sala-aquario', '2026-11-03T11:00:00Z', '2026-11-03T12:00:00Z'), null);
  assert.equal(a.validar('sala-aquario', '2026-11-03T10:59:00Z', '2026-11-03T12:00:00Z'), MENSAGENS.janela);
});

test('duracao de 2 horas exatas e permitida', () => {
  const a = novaAgenda();
  assert.equal(a.validar('sala-aquario', h('09:00'), h('11:00')), null);
  assert.equal(a.validar('sala-aquario', h('09:00'), h('11:01')), MENSAGENS.duracao);
});

test('conflitos usam intervalo semiaberto e devolvem a reserva em conflito', () => {
  const a = novaAgenda();
  assert.deepEqual(a.conflitos('sala-garagem', h('15:00'), h('16:00')), []);
  assert.deepEqual(a.conflitos('sala-garagem', h('13:00'), h('14:00')), []);
  assert.deepEqual(a.conflitos('sala-garagem', h('14:30'), h('15:30')), [
    { id: 'res-0001', inicio: h('14:00'), fim: h('15:00'), responsavel: 'Marty' },
  ]);
});

test('alternativas: capacidade maior ou igual, ordem por capacidade e id, no maximo 3', () => {
  const a = novaAgenda();
  assert.deepEqual(a.alternativas('sala-garagem', h('14:00'), h('15:00')), ['sala-fusca', 'sala-mirante']);
  assert.deepEqual(a.alternativas('sala-porao', h('09:00'), h('10:00')), ['sala-fusca', 'sala-garagem', 'sala-mirante']);
  assert.deepEqual(a.alternativas('sala-aquario', h('09:00'), h('10:00')), ['sala-porao', 'sala-fusca', 'sala-garagem']);
});

test('criar preserva as strings recebidas e numera em sequencia', () => {
  const a = novaAgenda();
  const r1 = a.criar({ sala: 'sala-aquario', inicio: h('09:00'), fim: h('10:00'), responsavel: 'Doc' });
  const r2 = a.criar({ sala: 'sala-aquario', inicio: '2026-11-03T13:00:00Z', fim: '2026-11-03T14:00:00Z', responsavel: 'Doc' });
  assert.deepEqual(r1, { id: 'res-0003', sala: 'sala-aquario', inicio: h('09:00'), fim: h('10:00'), responsavel: 'Doc' });
  assert.equal(r2.id, 'res-0004');
  assert.equal(r2.inicio, '2026-11-03T13:00:00Z');
  assert.deepEqual(a.conflitos('sala-aquario', h('09:30'), h('09:45')).map((c) => c.id), ['res-0003']);
});

test('agendas diferentes nao compartilham reservas (o store nao e global ao modulo)', () => {
  const a = novaAgenda();
  a.criar({ sala: 'sala-aquario', inicio: h('09:00'), fim: h('10:00'), responsavel: 'Doc' });
  assert.deepEqual(novaAgenda().conflitos('sala-aquario', h('09:00'), h('10:00')), []);
});

test('a sequencia inteira do validador produz as alternativas esperadas em cada passo', () => {
  const a = novaAgenda();
  const reservarComEscolha = (sala, ini, fim, resp, escolha) => {
    const alt = a.alternativas(sala, h(ini), h(fim));
    assert.ok(alt.includes(escolha), `${escolha} fora de ${alt}`);
    return a.criar({ sala: escolha, inicio: h(ini), fim: h(fim), responsavel: resp });
  };

  // 13/14/15: conflito sem gravar nada
  assert.deepEqual(a.alternativas('sala-garagem', h('14:00'), h('15:00')), ['sala-fusca', 'sala-mirante']);
  // 16
  assert.deepEqual(a.alternativas('sala-fusca', h('16:00'), h('17:00')), ['sala-garagem', 'sala-mirante']);
  assert.equal(reservarComEscolha('sala-fusca', '16:00', '17:00', 'Validador', 'sala-garagem').id, 'res-0003');
  // 18
  assert.deepEqual(a.conflitos('sala-garagem', h('09:00'), h('10:00')), []);
  assert.equal(a.criar({ sala: 'sala-garagem', inicio: h('09:00'), fim: h('10:00'), responsavel: 'Ocupante' }).id, 'res-0004');
  assert.deepEqual(a.alternativas('sala-garagem', h('09:00'), h('10:00')), ['sala-fusca', 'sala-mirante']);
  assert.equal(reservarComEscolha('sala-garagem', '09:00', '10:00', 'Doc', 'sala-fusca').id, 'res-0005');
  // 20
  assert.equal(a.criar({ sala: 'sala-mirante', inicio: h('11:00'), fim: h('12:00'), responsavel: 'Validador' }).id, 'res-0006');
  assert.deepEqual(a.alternativas('sala-mirante', h('11:00'), h('12:00')), []);
  // 24
  assert.deepEqual(a.conflitos('sala-porao', h('09:00'), h('10:00')), []);
  assert.equal(a.criar({ sala: 'sala-porao', inicio: h('09:00'), fim: h('10:00'), responsavel: 'Doc' }).id, 'res-0007');
  // 27-30
  assert.deepEqual(a.alternativas('sala-garagem', h('14:00'), h('15:00')), ['sala-fusca', 'sala-mirante']);
  assert.equal(reservarComEscolha('sala-garagem', '14:00', '15:00', 'Marty', 'sala-fusca').id, 'res-0008');
  // 32
  assert.deepEqual(a.alternativas('sala-garagem', h('14:30'), h('15:30')), ['sala-mirante']);
  // 33
  assert.deepEqual(a.alternativas('sala-fusca', h('16:00'), h('17:00')), ['sala-mirante']);
  assert.deepEqual(a.alternativas('sala-garagem', h('14:00'), h('15:00')), ['sala-mirante']);
  assert.equal(reservarComEscolha('sala-fusca', '16:00', '17:00', 'Lorraine', 'sala-mirante').id, 'res-0009');
  assert.equal(reservarComEscolha('sala-garagem', '14:00', '15:00', 'George', 'sala-mirante').id, 'res-0010');
  // 36
  assert.deepEqual(a.alternativas('sala-porao', h('09:00'), h('10:00')), ['sala-mirante']);
});
