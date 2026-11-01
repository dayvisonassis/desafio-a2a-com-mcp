// Factory do McpServer. O SDK chama a factory a cada request (modo stateless),
// entao nada de estado nasce aqui: dados, reservas e codec vem de fora.
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

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

export function criarFactory({ dados }) {
  return function buildServer() {
    const server = new McpServer(
      { name: 'central-de-salas', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {} } },
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
    }, async () => erro('consultar_disponibilidade ainda nao implementada'));

    server.registerTool('reservar_sala', {
      description: 'Reserva uma sala. Se o intervalo estiver ocupado, pergunta qual alternativa usar.',
      inputSchema: ReservarIn,
      outputSchema: ReservaOut,
    }, async () => erro('reservar_sala ainda nao implementada'));

    server.registerResource('politica', 'politica://uso', {
      title: 'Politica de uso das salas',
      description: 'Regras de uso; a primeira linha declara a versao.',
      mimeType: 'text/markdown',
    }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: dados.politica }] }));

    return server;
  };
}
