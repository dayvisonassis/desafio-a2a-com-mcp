// A ponte entre as duas camadas: recebe o texto que chegou pelo A2A, fala MCP com
// o servidor e devolve um desfecho para a Task. Nao conhece o SDK de A2A, e nao
// decide nada de sala: conflito, politica e alternativas vem do servidor MCP.
//
// desfecho = { estado: 'COMPLETED' | 'FAILED' | 'CANCELED' | 'INPUT_REQUIRED', texto, artifact? }
import { lerPedido, FORMATO_PEDIDO } from './pedido.js';
import { traceparentPara } from './trace.js';

const TOOL_RESERVA = 'reservar_sala';

function textoDoResultado(result) {
  return (result?.content ?? []).filter((p) => p.type === 'text').map((p) => p.text).join(' ');
}

function falha(texto) {
  return { estado: 'FAILED', texto };
}

export function criarPonte({ cliente }) {
  // Traduz o resultado de um tools/call em desfecho de Task.
  function desfechoDe(r, contexto) {
    if (r.tipo === 'erro') return falha(r.message);
    if (r.tipo === 'input_required') return falha('pausa ainda nao implementada');

    const { result } = r;
    if (result.isError) return falha(textoDoResultado(result));
    const reserva = result.structuredContent;
    if (reserva?.reservado === true) {
      const conteudo = {
        reserva: reserva.reserva,
        sala: reserva.sala,
        inicio: reserva.inicio,
        fim: reserva.fim,
        responsavel: reserva.responsavel,
        politica: contexto.politica,
      };
      return {
        estado: 'COMPLETED',
        texto: `Reserva ${reserva.reserva} confirmada na ${reserva.sala}.`,
        artifact: { name: 'reserva', texto: JSON.stringify(conteudo) },
      };
    }
    if (reserva?.reservado === false) return { estado: 'CANCELED', texto: `Nenhuma sala reservada (${reserva.motivo ?? 'sem motivo'}).` };
    return falha('Resposta inesperada do servidor MCP');
  }

  async function iniciar(taskId, texto, trace) {
    const pedido = lerPedido(texto);
    if (!pedido) return falha(`Pedido fora do formato: use ${FORMATO_PEDIDO}`);
    try {
      // Descoberta em runtime, antes do primeiro tools/call da Task.
      const tools = await cliente.listarTools(traceparentPara(trace));
      if (!tools.some((t) => t.name === TOOL_RESERVA)) return falha(`O servidor MCP nao oferece a tool ${TOOL_RESERVA}`);
      const { versao } = await cliente.lerPolitica(traceparentPara(trace));
      const r = await cliente.chamarTool(TOOL_RESERVA, pedido, traceparentPara(trace));
      return desfechoDe(r, { politica: versao });
    } catch (e) {
      // O cliente MCP ja descreve a falha sem o corpo da resposta HTTP.
      return falha(e?.message ?? 'Falha ao falar com o servidor MCP');
    }
  }

  return { iniciar };
}
