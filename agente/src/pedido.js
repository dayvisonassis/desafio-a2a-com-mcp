// Os dois textos fixos que o agente entende. So formato: sala, datas e politica
// sao repassadas como vieram, porque quem decide dominio e o servidor MCP.

export const FORMATO_PEDIDO = 'reservar sala=<id> inicio=<iso8601> fim=<iso8601> responsavel=<nome>';
export const FORMATO_ESCOLHA = 'escolha=<id da sala> ou escolha=recusar';

const PEDIDO = /^reservar\s+sala=(\S+)\s+inicio=(\S+)\s+fim=(\S+)\s+responsavel=(\S.*)$/;
const ESCOLHA = /^escolha=(\S+)$/;

export function lerPedido(texto) {
  const m = PEDIDO.exec((texto ?? '').trim());
  if (!m) return null;
  const [, sala, inicio, fim, responsavel] = m;
  return { sala, inicio, fim, responsavel: responsavel.trim() };
}

export function lerEscolha(texto) {
  return ESCOLHA.exec((texto ?? '').trim())?.[1] ?? null;
}
