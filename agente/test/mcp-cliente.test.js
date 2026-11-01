import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { subirServidorMcp, traceparentNovo } from '../../apoio-teste/processos.js';
import { subirGravador } from '../../apoio-teste/gravador.js';
import { criarClienteMcp } from '../src/mcp-cliente.js';

const h = (hora) => `2026-11-03T${hora}:00-03:00`;
const ESPERADO_META = {
  protocolVersion: '2026-07-28',
  clientCapabilities: { elicitation: { form: {} } },
};

let mcp;
let gravador;
let cliente;
before(async () => {
  mcp = await subirServidorMcp();
  gravador = await subirGravador(mcp.url);
  cliente = criarClienteMcp({ url: gravador.url });
  await cliente.conectar();
});
after(async () => {
  await cliente?.fechar();
  await gravador?.parar();
  await mcp?.parar();
});

function conferirEnvelope(troca, metodo, traceparent, nome) {
  const meta = troca.corpo.params._meta;
  assert.equal(troca.corpo.method, metodo);
  assert.equal(meta['io.modelcontextprotocol/protocolVersion'], ESPERADO_META.protocolVersion);
  assert.deepEqual(meta['io.modelcontextprotocol/clientCapabilities'], ESPERADO_META.clientCapabilities);
  assert.equal(meta['io.modelcontextprotocol/clientInfo'].name, 'agente-central-de-salas');
  assert.equal(meta.traceparent, traceparent);
  assert.equal(troca.headers['mcp-protocol-version'], '2026-07-28');
  assert.equal(troca.headers['mcp-method'], metodo);
  if (nome) assert.equal(troca.headers['mcp-name'], nome);
  assert.match(troca.headers.accept, /application\/json/);
  assert.match(troca.headers.accept, /text\/event-stream/);
}

test('a sonda server/discover do connect tambem leva o _meta e os headers obrigatorios', async () => {
  const sonda = gravador.requests('server/discover')[0];
  assert.ok(sonda, 'sem sonda server/discover');
  const meta = sonda.corpo.params._meta;
  assert.equal(meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
  assert.deepEqual(meta['io.modelcontextprotocol/clientCapabilities'], { elicitation: { form: {} } });
  assert.equal(sonda.headers['mcp-protocol-version'], '2026-07-28');
  assert.equal(sonda.headers['mcp-method'], 'server/discover');
  assert.ok(sonda.bruto.includes('"io.modelcontextprotocol/clientCapabilities":{"elicitation":{"form":{}}}'));
});

test('listarTools descobre as tools com _meta, headers e traceparent', async () => {
  const tp = traceparentNovo();
  const tools = await cliente.listarTools(tp);
  assert.deepEqual(tools.map((t) => t.name).sort(), ['consultar_disponibilidade', 'listar_salas', 'reservar_sala']);
  conferirEnvelope(gravador.requests('tools/list').at(-1), 'tools/list', tp);
});

test('listarTools vai ao servidor toda vez (sem cache)', async () => {
  const antes = gravador.requests('tools/list').length;
  await cliente.listarTools(traceparentNovo());
  await cliente.listarTools(traceparentNovo());
  assert.equal(gravador.requests('tools/list').length, antes + 2);
});

test('lerPolitica le o resource e extrai a versao da primeira linha', async () => {
  const tp = traceparentNovo();
  const politica = await cliente.lerPolitica(tp);
  assert.equal(politica.versao, '2026-11-01');
  conferirEnvelope(gravador.requests('resources/read').at(-1), 'resources/read', tp, 'politica://uso');
});

let pausa;
const argsConflito = { sala: 'sala-garagem', inicio: h('14:00'), fim: h('15:00'), responsavel: 'Marty' };

test('chamarTool devolve o input_required cru, sem responder a elicitation sozinho', async () => {
  const tp = traceparentNovo();
  const antes = gravador.requests('tools/call').length;
  pausa = await cliente.chamarTool('reservar_sala', argsConflito, tp);
  assert.equal(pausa.tipo, 'input_required');
  const chaves = Object.keys(pausa.inputRequests);
  assert.equal(chaves.length, 1);
  assert.deepEqual(pausa.inputRequests[chaves[0]].params.requestedSchema.properties.sala.enum, ['sala-fusca', 'sala-mirante']);
  assert.equal(typeof pausa.requestState, 'string');
  assert.equal(gravador.requests('tools/call').length, antes + 1, 'o cliente nao pode refazer o request sozinho');
  conferirEnvelope(gravador.requests('tools/call').at(-1), 'tools/call', tp, 'reservar_sala');
  const metodos = gravador.requests().map((t) => t.corpo.method);
  assert.ok(metodos.indexOf('tools/list') < metodos.indexOf('tools/call'), metodos.join(','));
  pausa.tp = tp;
});

test('o retry vai com id novo, a mesma chave e o requestState ecoado byte a byte', async () => {
  const chave = Object.keys(pausa.inputRequests)[0];
  const inicial = gravador.requests('tools/call').at(-1);
  const r = await cliente.chamarTool('reservar_sala', argsConflito, pausa.tp, {
    inputResponses: { [chave]: { action: 'accept', content: { sala: 'sala-fusca' } } },
    requestState: pausa.requestState,
  });
  assert.equal(r.tipo, 'complete');
  assert.equal(r.result.structuredContent.sala, 'sala-fusca');

  const retry = gravador.requests('tools/call').at(-1);
  assert.notEqual(retry.corpo.id, inicial.corpo.id);
  assert.equal(retry.corpo.params.requestState, inicial.resposta.result.requestState, 'diferente do que o servidor mandou');
  assert.equal(retry.corpo.params.requestState, pausa.requestState);
  assert.ok(retry.bruto.includes(JSON.stringify(pausa.requestState)), 'requestState alterado no fio');
  assert.deepEqual(Object.keys(retry.corpo.params.inputResponses), [chave]);
  assert.deepEqual(retry.corpo.params.arguments, argsConflito);
  conferirEnvelope(retry, 'tools/call', pausa.tp, 'reservar_sala');
});

test('isError da tool volta como complete com isError, sem lancar', async () => {
  const r = await cliente.chamarTool('reservar_sala', { sala: 'sala-delorean', inicio: h('09:00'), fim: h('10:00'), responsavel: 'Doc' }, traceparentNovo());
  assert.equal(r.tipo, 'complete');
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /Sala inexistente: sala-delorean/);
});

test('erro JSON-RPC volta como tipo erro com code e message', async () => {
  const chave = Object.keys(pausa.inputRequests)[0];
  const r = await cliente.chamarTool('reservar_sala', argsConflito, traceparentNovo(), {
    inputResponses: { [chave]: { action: 'accept', content: { sala: 'sala-mirante' } } },
    requestState: `${pausa.requestState.slice(0, -6)}AAAAAA`,
  });
  assert.equal(r.tipo, 'erro');
  assert.equal(r.code, -32602);
  assert.equal(typeof r.message, 'string');
});

test('o mesmo cliente continua funcionando depois de reiniciar o servidor MCP', async () => {
  await mcp.parar();
  mcp = await subirServidorMcp();
  gravador.apontarPara(mcp.url);
  const tools = await cliente.listarTools(traceparentNovo());
  assert.equal(tools.length, 3);
});
