import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extrairVersao, carregarDados } from '../src/dados.js';

test('extrai a versao da primeira linha com LF', () => {
  assert.equal(extrairVersao('versao: 2026-11-01\n\n- regra'), '2026-11-01');
});

test('extrai a versao sem o \\r quando o arquivo tem CRLF', () => {
  assert.equal(extrairVersao('versao: 2026-11-01\r\n\r\n- regra'), '2026-11-01');
});

test('falha se nao houver linha de versao', () => {
  assert.throws(() => extrairVersao('sem versao'), /versao/);
});

test('carrega salas, reservas e politica de dados/ independente do cwd', () => {
  const dados = carregarDados();
  assert.equal(dados.salas.length, 5);
  assert.deepEqual(dados.reservas.map((r) => r.id), ['res-0001', 'res-0002']);
  assert.equal(dados.versaoPolitica, '2026-11-01');
  assert.match(dados.politica, /^versao: 2026-11-01/);
});
