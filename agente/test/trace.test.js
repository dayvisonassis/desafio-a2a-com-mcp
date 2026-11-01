import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerTraceparent, novoTrace, traceparentPara } from '../src/trace.js';

const FORMATO = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

test('le trace-id e flags de um traceparent W3C valido', () => {
  assert.deepEqual(lerTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'), {
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736', flags: '01',
  });
});

test('traceparent ausente ou invalido devolve null', () => {
  for (const v of [undefined, '', 'lixo', '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7', '00-00000000000000000000000000000000-00f067aa0ba902b7-01', '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01', 'ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01', '00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01']) {
    assert.equal(lerTraceparent(v), null, String(v));
  }
});

test('traceparentPara mantem o trace-id e gera um span-id novo a cada request', () => {
  const trace = { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', flags: '01' };
  const a = traceparentPara(trace);
  const b = traceparentPara(trace);
  assert.match(a, FORMATO);
  assert.ok(a.startsWith('00-4bf92f3577b34da6a3ce929d0e0e4736-'));
  assert.ok(a.endsWith('-01'));
  assert.notEqual(a, b);
});

test('novoTrace gera um trace-id valido quando o cliente A2A nao manda header', () => {
  const t = novoTrace();
  assert.match(traceparentPara(t), FORMATO);
  assert.notEqual(novoTrace().traceId, t.traceId);
});
