import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerSegredo } from '../src/estado.js';

test('aceita hex de 64 caracteres e devolve 32 bytes', () => {
  const chave = lerSegredo('a1'.repeat(32));
  assert.equal(chave.length, 32);
});

test('recusa chave ausente', () => {
  assert.throws(() => lerSegredo(undefined), /REQUEST_STATE_SECRET/);
  assert.throws(() => lerSegredo(''), /REQUEST_STATE_SECRET/);
});

test('recusa chave com menos de 32 bytes', () => {
  assert.throws(() => lerSegredo('a1'.repeat(31)), /32 bytes/);
});

test('recusa chave que nao e hex', () => {
  assert.throws(() => lerSegredo('z'.repeat(64)), /hex/);
});

test('a mensagem de erro nunca contem o valor recebido', () => {
  const valor = 'segredo-que-nao-pode-vazar';
  try {
    lerSegredo(valor);
    assert.fail('deveria recusar');
  } catch (e) {
    assert.ok(!e.message.includes(valor));
  }
});
