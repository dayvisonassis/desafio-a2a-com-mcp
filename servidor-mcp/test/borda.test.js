import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  subirServidorMcp, subirProcesso, INDEX_MCP, mcp, montarMcp, postar, tcpCru, traceparentNovo, SEGREDO_TESTE,
} from '../../apoio-teste/processos.js';

let srv;
before(async () => { srv = await subirServidorMcp(); });
after(async () => { await srv?.parar(); });

async function aindaResponde() {
  const r = await mcp(srv.url, 'tools/list');
  assert.equal(r.status, 200);
  assert.ok(r.corpo.result.tools.length >= 3);
}

test('tools/list traz as tres tools, todas com inputSchema de objeto', async () => {
  const r = await mcp(srv.url, 'tools/list');
  assert.equal(r.status, 200);
  assert.match(r.tipo, /application\/json/);
  const tools = r.corpo.result.tools;
  assert.deepEqual(tools.map((t) => t.name).sort(), ['consultar_disponibilidade', 'listar_salas', 'reservar_sala']);
  for (const t of tools) assert.equal(t.inputSchema.type, 'object', t.name);
  for (const t of tools) assert.equal(t.outputSchema?.type, 'object', t.name);
});

test('as propriedades de entrada sao strings puras, sem enum nem formato', async () => {
  const r = await mcp(srv.url, 'tools/list');
  const reservar = r.corpo.result.tools.find((t) => t.name === 'reservar_sala');
  assert.deepEqual([...reservar.inputSchema.required].sort(), ['fim', 'inicio', 'responsavel', 'sala']);
  for (const campo of ['sala', 'inicio', 'fim', 'responsavel']) {
    const p = reservar.inputSchema.properties[campo];
    assert.equal(p.type, 'string', campo);
    assert.equal(p.enum, undefined, campo);
    assert.equal(p.format, undefined, campo);
    assert.equal(p.pattern, undefined, campo);
  }
});

test('listar_salas devolve structuredContent e um unico bloco de texto com o mesmo JSON', async () => {
  const r = await mcp(srv.url, 'tools/call', { name: 'listar_salas', arguments: {} }, { nome: 'listar_salas' });
  const res = r.corpo.result;
  assert.equal(res.resultType, 'complete');
  assert.equal(res.content.length, 1);
  assert.deepEqual(JSON.parse(res.content[0].text), res.structuredContent);
  const salas = JSON.parse(readFileSync(new URL('../../dados/salas.json', import.meta.url), 'utf8'));
  assert.deepEqual(res.structuredContent, { salas });
});

for (const omitir of ['protocolVersion', 'clientCapabilities']) {
  test(`_meta sem ${omitir} devolve -32602 com HTTP 400 (com o header de versao)`, async () => {
    const r = await mcp(srv.url, 'tools/call', { name: 'listar_salas', arguments: {} }, { nome: 'listar_salas', omitir, id: 'abc123' });
    assert.equal(r.status, 400);
    assert.match(r.tipo, /application\/json/);
    assert.equal(r.corpo.error.code, -32602);
    assert.equal(r.corpo.id, 'abc123');
  });

  test(`_meta sem ${omitir} devolve -32602 com HTTP 400 tambem sem o header de versao e com id numerico`, async () => {
    const r = await mcp(srv.url, 'tools/list', {}, { omitir, id: 42, semHeaderVersao: true });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.error.code, -32602);
    assert.equal(r.corpo.id, 42);
  });
}

test('request sem _meta nenhum devolve -32602 com HTTP 400', async () => {
  const r = await postar(srv.url, { jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} }, {
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
  });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.error.code, -32602);
  assert.equal(r.corpo.id, 7);
});

test('clientCapabilities vazio passa pela borda (nao e campo ausente)', async () => {
  const r = await mcp(srv.url, 'tools/list', {}, { capabilities: {} });
  assert.equal(r.status, 200);
  assert.ok(r.corpo.result.tools.length >= 3);
});

test('id numerico e devolvido como numero', async () => {
  const r = await mcp(srv.url, 'tools/list', {}, { id: 1 });
  assert.equal(r.corpo.id, 1);
});

test('tool inexistente e recusada com -32602', async () => {
  const r = await mcp(srv.url, 'tools/call', { name: 'voar_delorean', arguments: {} }, { nome: 'voar_delorean' });
  assert.equal(r.corpo.error?.code, -32602);
});

test('resources/read de politica://uso devolve o arquivo em text/markdown', async () => {
  const r = await mcp(srv.url, 'resources/read', { uri: 'politica://uso' }, { nome: 'politica://uso' });
  const item = r.corpo.result.contents[0];
  assert.equal(item.uri, 'politica://uso');
  assert.equal(item.mimeType, 'text/markdown');
  assert.equal(item.text, readFileSync(new URL('../../dados/politica-de-uso.md', import.meta.url), 'utf8'));
  assert.match(item.text, /versao: 2026-11-01/);
});

test('resources/read de URI inexistente devolve -32602', async () => {
  const r = await mcp(srv.url, 'resources/read', { uri: 'politica://inexistente' }, { nome: 'politica://inexistente' });
  assert.equal(r.corpo.error?.code, -32602);
  assert.equal(r.corpo.result, undefined);
});

test('corpo que nao e JSON devolve -32700 com HTTP 400 em application/json', async () => {
  const r = await postar(srv.url, '{nao e json', { 'Content-Type': 'application/json' });
  assert.equal(r.status, 400);
  assert.match(r.tipo, /application\/json/);
  assert.equal(r.corpo.error.code, -32700);
});

test('header Mcp-Method que nao bate com o corpo devolve -32020', async () => {
  const { corpo, headers } = montarMcp('tools/list');
  const r = await postar(srv.url, corpo, { ...headers, 'Mcp-Method': 'resources/list' });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.error.code, -32020);
});

test('caminho diferente de /mcp devolve 404', async () => {
  const r = await postar(srv.url.replace('/mcp', '/outro'), {}, { 'Content-Type': 'application/json' });
  assert.equal(r.status, 404);
});

test('o stderr registra metodo, id, nome, cliente, traceparent e retry de cada request', async () => {
  const tp = traceparentNovo();
  const { corpo, headers } = montarMcp('resources/read', { uri: 'politica://uso' }, { nome: 'politica://uso', traceparent: tp, id: 'log-1' });
  corpo.params._meta['io.modelcontextprotocol/clientInfo'] = { name: 'teste-log', version: '1.0.0' };
  await postar(srv.url, corpo, headers);
  const linha = await srv.esperarLinhaStderr((l) => l.includes('id=log-1'));
  assert.ok(linha, srv.linhasStderr.join('\n'));
  assert.match(linha, /method=resources\/read/);
  assert.match(linha, /name=politica:\/\/uso/);
  assert.match(linha, /cliente=teste-log/);
  assert.ok(linha.includes(`traceparent=${tp}`));
  assert.match(linha, /retry=nao/);
});

test('request rejeitado pela borda tambem aparece no log, sem traceparent', async () => {
  await mcp(srv.url, 'tools/list', {}, { omitir: 'protocolVersion', id: 'log-rejeitado' });
  const linha = await srv.esperarLinhaStderr((l) => l.includes('id=log-rejeitado'));
  assert.ok(linha);
  assert.match(linha, /traceparent=-/);
  assert.match(linha, /cliente=-/);
});

test('valor com quebra de linha ou espaco nao quebra a linha de log', async () => {
  const { corpo, headers } = montarMcp('tools/list', {}, { id: 'log-escape' });
  corpo.params._meta.traceparent = 'a\nb c';
  await postar(srv.url, corpo, headers);
  const linha = await srv.esperarLinhaStderr((l) => l.includes('id=log-escape'));
  assert.ok(linha);
  assert.ok(!srv.linhasStderr.some((l) => /^b c/.test(l)), 'o traceparent virou outra linha');
  assert.match(linha, /traceparent=\S+ retry=nao$/);
});

test('GET em /mcp tambem gera linha de log com o metodo HTTP', async () => {
  const abortar = new AbortController();
  const pedido = fetch(srv.url, { method: 'GET', headers: { Accept: 'text/event-stream' }, signal: abortar.signal })
    .then((r) => r.body?.cancel())
    .catch(() => {});
  assert.ok(await srv.esperarLinhaStderr((l) => /method=GET/.test(l)));
  abortar.abort();
  await pedido;
});

test('id que nao e string nem numero volta como null no erro do guard', async () => {
  const { corpo, headers } = montarMcp('tools/list', {}, { omitir: 'protocolVersion' });
  corpo.id = { toString: 1 };
  const r = await postar(srv.url, corpo, headers);
  assert.equal(r.status, 400);
  assert.equal(r.corpo.id, null);
  await aindaResponde();
});

test('cliente que aborta no meio do corpo nao derruba o servidor', async () => {
  const cabecalho = `POST /mcp HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 5000\r\n\r\n{"jsonrpc":"2.0"`;
  await tcpCru(srv.porta, cabecalho, { fecharDepoisDeEnviar: true });
  await new Promise((r) => setTimeout(r, 200));
  await aindaResponde();
});

test('valor de _meta com toString nao chamavel nao derruba o servidor', async () => {
  const { corpo, headers } = montarMcp('tools/list');
  corpo.id = { toString: 1 };
  corpo.params._meta.traceparent = { toString: 1 };
  await postar(srv.url, corpo, headers);
  await aindaResponde();
});

test('request-target absoluto invalido nao derruba o servidor', async () => {
  await tcpCru(srv.porta, 'POST http://[x/mcp HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\n\r\n{}');
  await aindaResponde();
});

for (const [rotulo, porta] of [['invalida', 'abc'], ['vazia', '']]) {
  test(`MCP_PORT ${rotulo} aborta a subida com mensagem clara`, async () => {
    const proc = subirProcesso(INDEX_MCP, { MCP_PORT: porta, REQUEST_STATE_SECRET: SEGREDO_TESTE });
    try {
      await assert.rejects(proc.pronto, /MCP_PORT/);
      assert.notEqual(await proc.saida, 0);
    } finally {
      await proc.parar();
    }
  });
}

test('porta ocupada aborta a subida com mensagem clara', async () => {
  const proc = subirProcesso(INDEX_MCP, { MCP_PORT: String(srv.porta), REQUEST_STATE_SECRET: SEGREDO_TESTE });
  try {
    await assert.rejects(proc.pronto, /em uso/);
    assert.notEqual(await proc.saida, 0);
  } finally {
    await proc.parar();
  }
});

test('o servidor nao sobe sem REQUEST_STATE_SECRET', async () => {
  const proc = subirProcesso(INDEX_MCP, { MCP_PORT: '0', REQUEST_STATE_SECRET: '' });
  await assert.rejects(proc.pronto, /REQUEST_STATE_SECRET/);
  assert.notEqual(await proc.saida, 0);
});

test('o servidor nao sobe com chave curta e nao mostra o valor da chave', async () => {
  const curta = 'ab'.repeat(16);
  const proc = subirProcesso(INDEX_MCP, { MCP_PORT: '0', REQUEST_STATE_SECRET: curta });
  await assert.rejects(proc.pronto, /REQUEST_STATE_SECRET/);
  assert.notEqual(await proc.saida, 0);
  assert.ok(!proc.linhas.join('\n').includes(curta));
});
