import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { criarCodec, TTL_SEGUNDOS } from '../src/estado.js';

const chave = randomBytes(32);
const payload = { t: 'reservar_sala', a: { sala: 'sala-garagem', inicio: '2026-11-03T14:00:00-03:00', fim: '2026-11-03T15:00:00-03:00', responsavel: 'Marty' }, alt: ['sala-fusca', 'sala-mirante'] };
// O verify confere a tool pelo header Mcp-Name, que o SDK garante igual a params.name.
const ctxDaTool = (nome) => ({ http: { req: { headers: new Headers({ 'mcp-name': nome }) } } });
const ctx = ctxDaTool('reservar_sala');

test('o TTL fica entre 5 e 30 minutos', () => {
  assert.ok(TTL_SEGUNDOS >= 5 * 60 && TTL_SEGUNDOS <= 30 * 60, String(TTL_SEGUNDOS));
});

test('mint e verify devolvem o payload selado', async () => {
  const codec = criarCodec(chave);
  const estado = await codec.mint(payload);
  assert.equal(typeof estado, 'string');
  assert.deepEqual(await codec.verify(estado, ctx), payload);
});

test('o estado continua valido em outra instancia do codec com a mesma chave (restart)', async () => {
  const estado = await criarCodec(chave).mint(payload);
  assert.deepEqual(await criarCodec(Buffer.from(chave)).verify(estado, ctx), payload);
});

test('chave diferente rejeita o estado', async () => {
  const estado = await criarCodec(chave).mint(payload);
  await assert.rejects(criarCodec(randomBytes(32)).verify(estado, ctx));
});

test('a troca de qualquer caractere do estado e rejeitada, um por vez', async () => {
  const codec = criarCodec(chave);
  const estado = await codec.mint(payload);
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.+/= \n\t';
  const aceitos = [];
  for (let i = 0; i < estado.length; i++) {
    for (const troca of alfabeto) {
      if (troca === estado[i]) continue;
      const adulterado = estado.slice(0, i) + troca + estado.slice(i + 1);
      try {
        await codec.verify(adulterado, ctx);
        aceitos.push(`${i}:${estado[i]}->${troca}`);
      } catch {
        // rejeitado: esperado
      }
    }
  }
  assert.deepEqual(aceitos, []);
});

test('inserir espaco, quebra de linha ou = em qualquer posicao e rejeitado', async () => {
  const codec = criarCodec(chave);
  const estado = await codec.mint(payload);
  const aceitos = [];
  for (let i = 0; i <= estado.length; i++) {
    for (const extra of [' ', '\n', '=']) {
      try {
        await codec.verify(estado.slice(0, i) + extra + estado.slice(i), ctx);
        aceitos.push(`${i}:${JSON.stringify(extra)}`);
      } catch {
        // rejeitado: esperado
      }
    }
  }
  assert.deepEqual(aceitos, []);
});

test('o estado so vale na tool que o selou', async () => {
  const codec = criarCodec(chave);
  const estado = await codec.mint(payload);
  await assert.rejects(codec.verify(estado, ctxDaTool('listar_salas')));
  await assert.rejects(codec.verify(estado, {}));
  assert.deepEqual(await codec.verify(estado, ctxDaTool('reservar_sala')), payload);
});

test('estado sem tool selada e recusado mesmo sem o header Mcp-Name', async () => {
  const codec = criarCodec(chave);
  const semTool = await codec.mint({ a: payload.a, alt: payload.alt });
  await assert.rejects(codec.verify(semTool, {}));
  await assert.rejects(codec.verify(semTool, ctxDaTool('reservar_sala')));
});

test('a troca dos ultimos 6 caracteres (como o validador faz) e rejeitada', async () => {
  const codec = criarCodec(chave);
  const estado = await codec.mint(payload);
  const adulterado = estado.slice(0, -6) + (estado.endsWith('AAAAAA') ? 'BBBBBB' : 'AAAAAA');
  await assert.rejects(codec.verify(adulterado, ctx));
});

test('tokens malformados sao rejeitados', async () => {
  const codec = criarCodec(chave);
  const estado = await codec.mint(payload);
  for (const ruim of ['', 'semponto', estado.replace(/^v1\./, 'v2.'), `${estado}!`, `${estado}=`, ` ${estado}`, `${estado} `, estado.split('.').slice(0, 2).join('.'), 12345]) {
    await assert.rejects(codec.verify(ruim, ctx), undefined, String(ruim).slice(0, 20));
  }
});

test('estado expirado e rejeitado', async () => {
  const codec = criarCodec(chave, { ttlSeconds: 1 });
  const estado = await codec.mint(payload);
  await new Promise((r) => setTimeout(r, 2100));
  await assert.rejects(codec.verify(estado, ctx));
});
