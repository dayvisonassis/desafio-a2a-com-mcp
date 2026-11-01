// Cliente MCP manual, sem A2A: descobre as tools, le a politica, pede uma sala
// ocupada e completa o ciclo de MRTR com a escolha passada na linha de comando.
//
//   node agente/scripts/cliente-manual.js              (so mostra as alternativas)
//   node agente/scripts/cliente-manual.js sala-fusca   (aceita sala-fusca)
//   node agente/scripts/cliente-manual.js recusar      (recusa)
//
// Usa MCP_URL (padrao http://localhost:7301/mcp).
import { randomBytes } from 'node:crypto';
import { criarClienteMcp } from '../src/mcp-cliente.js';

const url = process.env.MCP_URL ?? 'http://localhost:7301/mcp';
const escolha = process.argv[2];
const traceparent = `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;
const pedido = { sala: 'sala-garagem', inicio: '2026-11-03T14:00:00-03:00', fim: '2026-11-03T15:00:00-03:00', responsavel: 'Marty' };

const cliente = criarClienteMcp({ url, tentativas: 3 });
try {
  await cliente.conectar();
  const tools = await cliente.listarTools(traceparent);
  console.log('tools:', tools.map((t) => t.name).join(', '));
  console.log('politica:', (await cliente.lerPolitica(traceparent)).versao);

  const r = await cliente.chamarTool('reservar_sala', pedido, traceparent);
  if (r.tipo !== 'input_required') {
    console.log(JSON.stringify(r, null, 2));
  } else {
    const [chave, pergunta] = Object.entries(r.inputRequests)[0];
    const sala = pergunta.params.requestedSchema.properties.sala;
    console.log(`input_required: ${pergunta.params.message}`);
    console.log(`alternativas: ${(sala.enum ?? [sala.const]).join(', ')}`);
    if (escolha) {
      const resposta = escolha === 'recusar' ? { action: 'decline' } : { action: 'accept', content: { sala: escolha } };
      const final = await cliente.chamarTool('reservar_sala', pedido, traceparent, { inputResponses: { [chave]: resposta }, requestState: r.requestState });
      console.log(JSON.stringify(final.tipo === 'complete' ? final.result.structuredContent ?? final.result : final, null, 2));
    }
  }
} finally {
  await cliente.fechar();
}
