import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerPedido, lerEscolha } from '../src/pedido.js';

test('le o pedido no formato fixo, como o validador manda', () => {
  assert.deepEqual(lerPedido('reservar sala=sala-porao inicio=2026-11-03T09:00:00-03:00 fim=2026-11-03T10:00:00-03:00 responsavel=Doc'), {
    sala: 'sala-porao', inicio: '2026-11-03T09:00:00-03:00', fim: '2026-11-03T10:00:00-03:00', responsavel: 'Doc',
  });
});

test('responsavel pode ter espacos e o texto pode vir com espacos nas pontas', () => {
  assert.equal(lerPedido('  reservar sala=s inicio=a fim=b responsavel=Marty McFly \n').responsavel, 'Marty McFly');
});

test('nao valida dominio: sala e datas sao repassadas como vieram', () => {
  assert.deepEqual(lerPedido('reservar sala=sala-delorean inicio=ontem fim=amanha responsavel=Doc'), {
    sala: 'sala-delorean', inicio: 'ontem', fim: 'amanha', responsavel: 'Doc',
  });
});

test('texto fora do formato devolve null', () => {
  for (const t of ['', 'oi', 'reservar sala=x', 'reservar inicio=a sala=b fim=c responsavel=d', 'RESERVAR sala=a inicio=b fim=c responsavel=d', 'escolha=sala-fusca', 'reservar sala= inicio=a fim=b responsavel=c']) {
    assert.equal(lerPedido(t), null, JSON.stringify(t));
  }
});

test('le a escolha da continuacao', () => {
  assert.equal(lerEscolha('escolha=sala-fusca'), 'sala-fusca');
  assert.equal(lerEscolha(' escolha=recusar\n'), 'recusar');
});

test('escolha fora do formato devolve null', () => {
  for (const t of ['', 'sala-fusca', 'escolha=', 'escolha=a b', 'Escolha=sala-fusca', 'reservar sala=a inicio=b fim=c responsavel=d']) {
    assert.equal(lerEscolha(t), null, JSON.stringify(t));
  }
});
