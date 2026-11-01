// A ponte entre as duas camadas: recebe o texto que chegou pelo A2A, fala MCP com
// o servidor e devolve um desfecho para a Task. Nao conhece o SDK de A2A, e nao
// decide nada de sala: conflito, politica e alternativas vem do servidor MCP.
//
// desfecho = { estado: 'COMPLETED' | 'FAILED' | 'CANCELED' | 'INPUT_REQUIRED', texto, artifact? }
//
// Onde as duas formas de estado se encontram: quando o tools/call volta com
// input_required, a Task pausa (INPUT_REQUIRED) e o requestState fica guardado
// aqui, por Task, fora do objeto Task (que e serializado para o cliente A2A).
// Na continuacao, o mesmo tools/call sai de novo, com id novo, levando
// inputResponses e o requestState ecoado sem modificacao.
import { lerPedido, lerEscolha, FORMATO_PEDIDO } from './pedido.js';
import { traceparentPara } from './trace.js';

const TOOL_RESERVA = 'reservar_sala';

function textoDoResultado(result) {
  return (result?.content ?? []).filter((p) => p.type === 'text').map((p) => p.text).join(' ');
}

function falha(texto) {
  return { estado: 'FAILED', texto };
}

function linhaDeAlternativas(opcoes) {
  return `alternativas: ${opcoes.join(', ')}`;
}

// Le a unica pergunta do input_required: uma elicitation em form com um campo
// so, restrito por enum (ou const, com uma opcao). E dado de protocolo, nao regra.
function lerPergunta(inputRequests) {
  const entradas = Object.entries(inputRequests ?? {});
  if (entradas.length !== 1) return null;
  const [chave, pedido] = entradas[0];
  if (pedido?.method !== 'elicitation/create') return null;
  const campos = Object.entries(pedido.params?.requestedSchema?.properties ?? {});
  if (campos.length !== 1) return null;
  const [campo, schema] = campos[0];
  const opcoes = Array.isArray(schema?.enum) ? schema.enum : schema?.const !== undefined ? [schema.const] : null;
  if (!opcoes?.length || !opcoes.every((o) => typeof o === 'string')) return null;
  return { chave, campo, opcoes };
}

export function criarPonte({ cliente }) {
  // taskId -> { requestState, chave, campo, opcoes, tool, args, trace, politica }
  const pendencias = new Map();

  // Traduz o resultado de um tools/call em desfecho de Task.
  function desfechoDe(r, taskId, contexto) {
    if (r.tipo === 'input_required') {
      const pergunta = lerPergunta(r.inputRequests);
      if (!pergunta || typeof r.requestState !== 'string') {
        pendencias.delete(taskId);
        return falha('O servidor MCP pediu uma entrada que o agente nao sabe repassar');
      }
      pendencias.set(taskId, { ...pergunta, requestState: r.requestState, ...contexto });
      return { estado: 'INPUT_REQUIRED', texto: linhaDeAlternativas(pergunta.opcoes) };
    }

    pendencias.delete(taskId);
    if (r.tipo === 'erro') return falha(r.message);
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
      return desfechoDe(r, taskId, { tool: TOOL_RESERVA, args: pedido, trace, politica: versao });
    } catch (e) {
      // O cliente MCP ja descreve a falha sem o corpo da resposta HTTP.
      return falha(e?.message ?? 'Falha ao falar com o servidor MCP');
    }
  }

  // Continuacao de uma Task pausada: "escolha=<id>" aceita, "escolha=recusar"
  // recusa; qualquer outra coisa mantem a pausa sem falar com o MCP.
  async function continuar(taskId, texto) {
    const pendencia = pendencias.get(taskId);
    if (!pendencia) return falha('Esta Task nao esta esperando uma escolha');
    const pausa = { estado: 'INPUT_REQUIRED', texto: linhaDeAlternativas(pendencia.opcoes) };

    const escolha = lerEscolha(texto);
    let resposta;
    if (escolha === 'recusar') resposta = { action: 'decline' };
    else if (escolha !== null && pendencia.opcoes.includes(escolha)) resposta = { action: 'accept', content: { [pendencia.campo]: escolha } };
    else return pausa;

    // A pendencia sai do Map antes do retry: uma segunda continuacao simultanea
    // nao reenvia o mesmo requestState. Um novo input_required a recoloca.
    pendencias.delete(taskId);
    // Retry: o mesmo tools/call (mesmos arguments), id novo, a chave que o servidor
    // atribuiu e o requestState exatamente como veio.
    const r = await cliente.chamarTool(pendencia.tool, pendencia.args, traceparentPara(pendencia.trace), {
      inputResponses: { [pendencia.chave]: resposta },
      requestState: pendencia.requestState,
    });
    const { tool, args, trace, politica } = pendencia;
    return desfechoDe(r, taskId, { tool, args, trace, politica });
  }

  function descartar(taskId) {
    pendencias.delete(taskId);
  }

  return { iniciar, continuar, descartar };
}
