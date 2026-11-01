// Factory do McpServer. O SDK chama a factory a cada request (modo stateless),
// entao nada de estado nasce aqui: dados, reservas e codec vem de fora.
import { McpServer, inputRequired, inputResponse } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { MENSAGENS } from './dominio.js';

// Chave do inputRequests: atribuida pelo servidor; o cliente devolve a mesma.
const CHAVE_ESCOLHA = 'escolha_de_sala';
const MENSAGEM_ESCOLHA = 'A sala pedida esta ocupada nesse intervalo. Escolha uma alternativa.';

const SalaOut = z.object({
  id: z.string(),
  nome: z.string(),
  capacidade: z.number().int(),
  recursos: z.array(z.string()),
});

const ConflitoOut = z.object({
  id: z.string(),
  inicio: z.string(),
  fim: z.string(),
  responsavel: z.string(),
});

// Entradas so como z.string(): sala, horario e politica sao validados no dominio,
// para que a mensagem de erro seja a do enunciado e nao a da validacao do SDK.
const Intervalo = {
  sala: z.string().describe('Id da sala, como em listar_salas'),
  inicio: z.string().describe('Inicio em ISO 8601 com offset, ex.: 2026-11-03T14:00:00-03:00'),
  fim: z.string().describe('Fim em ISO 8601 com offset'),
};

const ListarIn = z.object({});
const ListarOut = z.object({ salas: z.array(SalaOut) });
const ConsultarIn = z.object(Intervalo);
const ConsultarOut = z.object({ sala: z.string(), livre: z.boolean(), conflitos: z.array(ConflitoOut) });
const ReservarIn = z.object({ ...Intervalo, responsavel: z.string().describe('Nome de quem reserva') });

const ReservaOut = z.object({
  reserva: z.string().nullable(),
  reservado: z.boolean(),
  sala: z.string().nullable(),
  inicio: z.string().nullable(),
  fim: z.string().nullable(),
  responsavel: z.string().nullable(),
  politica: z.string().nullable(),
  motivo: z.string().nullable(),
});

function completo(estruturado) {
  return { content: [{ type: 'text', text: JSON.stringify(estruturado) }], structuredContent: estruturado };
}

function erro(mensagem) {
  return { isError: true, content: [{ type: 'text', text: mensagem }] };
}

function reservaCriada(reserva, versaoPolitica) {
  const { id, sala, inicio, fim, responsavel } = reserva;
  return completo({ reserva: id, reservado: true, sala, inicio, fim, responsavel, politica: versaoPolitica, motivo: null });
}

function semReserva(motivo) {
  return completo({ reserva: null, reservado: false, sala: null, inicio: null, fim: null, responsavel: null, politica: null, motivo });
}

// Schema literal (nao zod) para manter enum mesmo com uma alternativa so.
function schemaDaEscolha(alternativas) {
  return {
    type: 'object',
    properties: { sala: { type: 'string', title: 'Sala', description: 'Sala alternativa escolhida', enum: alternativas } },
    required: ['sala'],
  };
}

export function criarFactory({ dados, agenda, codec }) {
  async function consultar({ sala, inicio, fim }) {
    const invalido = agenda.validar(sala, inicio, fim);
    if (invalido) return erro(invalido);
    const conflitos = agenda.conflitos(sala, inicio, fim);
    return completo({ sala, livre: conflitos.length === 0, conflitos });
  }

  // MRTR: o servidor nao pergunta no meio da tool. Ele termina a resposta com
  // input_required e sela no requestState tudo que precisa para o retry. Nada
  // e gravado aqui, entao o -32021 que o SDK aplica depois nao deixa efeito.
  async function pedirEscolha(pedido) {
    const alternativas = agenda.alternativas(pedido.sala, pedido.inicio, pedido.fim);
    if (alternativas.length === 0) return erro(MENSAGENS.semAlternativas);
    return inputRequired({
      inputRequests: {
        [CHAVE_ESCOLHA]: inputRequired.elicit({ message: MENSAGEM_ESCOLHA, requestedSchema: schemaDaEscolha(alternativas) }),
      },
      requestState: await codec.mint({ t: 'reservar_sala', a: pedido, alt: alternativas }),
    });
  }

  // Retry: o pedido vem do estado selado; os arguments reenviados pelo cliente
  // nao sao confiaveis e sao ignorados.
  async function retomar(selado, respostas) {
    const pedido = selado.a;
    const resposta = inputResponse(respostas, CHAVE_ESCOLHA);
    if (resposta.kind !== 'elicit') return pedirEscolha(pedido);
    if (resposta.action === 'decline') return semReserva('recusado');
    if (resposta.action === 'cancel') return semReserva('cancelado');

    const escolhida = resposta.content?.sala;
    if (!selado.alt.includes(escolhida)) return erro('Escolha invalida: a sala escolhida nao esta entre as alternativas oferecidas');
    // A agenda pode ter mudado entre as rodadas: se a escolhida foi ocupada, pergunta de novo.
    if (agenda.conflitos(escolhida, pedido.inicio, pedido.fim).length > 0) return pedirEscolha(pedido);
    return reservaCriada(agenda.criar({ ...pedido, sala: escolhida }), dados.versaoPolitica);
  }

  async function reservar({ sala, inicio, fim, responsavel }, ctx) {
    const selado = ctx.mcpReq.requestState();
    if (selado !== undefined) return retomar(selado, ctx.mcpReq.inputResponses);

    const invalido = agenda.validar(sala, inicio, fim);
    if (invalido) return erro(invalido);
    if (agenda.conflitos(sala, inicio, fim).length > 0) return pedirEscolha({ sala, inicio, fim, responsavel });
    return reservaCriada(agenda.criar({ sala, inicio, fim, responsavel }), dados.versaoPolitica);
  }

  return function buildServer() {
    const server = new McpServer(
      { name: 'central-de-salas', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {} }, requestState: { verify: codec.verify } },
    );

    server.registerTool('listar_salas', {
      description: 'Lista todas as salas com capacidade e recursos.',
      inputSchema: ListarIn,
      outputSchema: ListarOut,
    }, async () => completo({ salas: dados.salas }));

    server.registerTool('consultar_disponibilidade', {
      description: 'Diz se uma sala esta livre no intervalo, e quais reservas conflitam.',
      inputSchema: ConsultarIn,
      outputSchema: ConsultarOut,
    }, consultar);

    server.registerTool('reservar_sala', {
      description: 'Reserva uma sala. Se o intervalo estiver ocupado, pergunta qual alternativa usar.',
      inputSchema: ReservarIn,
      outputSchema: ReservaOut,
    }, reservar);

    server.registerResource('politica', 'politica://uso', {
      title: 'Politica de uso das salas',
      description: 'Regras de uso; a primeira linha declara a versao.',
      mimeType: 'text/markdown',
    }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: dados.politica }] }));

    return server;
  };
}
