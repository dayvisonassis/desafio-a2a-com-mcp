// requestState do MRTR: selado com o codec HMAC-SHA256 do proprio SDK. A chave vem
// so do ambiente, nunca do codigo; o estado viaja inteiro no token, entao um
// retry depois de reiniciar o processo funciona com a mesma chave.
import { createRequestStateCodec } from '@modelcontextprotocol/server';

const COMO_GERAR = 'gere com: python3 -c "import secrets; print(secrets.token_hex(32))"';

// 20 minutos: dentro da faixa de 5 a 30 do enunciado, com folga para um humano.
export const TTL_SEGUNDOS = 20 * 60;

export function lerSegredo(valor) {
  if (!valor) throw new Error(`REQUEST_STATE_SECRET ausente; ${COMO_GERAR}`);
  if (!/^[0-9a-fA-F]+$/.test(valor) || valor.length % 2 !== 0) {
    throw new Error(`REQUEST_STATE_SECRET precisa ser hex; ${COMO_GERAR}`);
  }
  const chave = Buffer.from(valor, 'hex');
  if (chave.length < 32) {
    throw new Error(`REQUEST_STATE_SECRET precisa ter pelo menos 32 bytes (64 caracteres hex); ${COMO_GERAR}`);
  }
  return chave;
}

// O token e "v1.<payload>.<mac>" em base64url. O codec verifica o MAC sobre a
// string do payload, mas decodifica o MAC com atob, que tolera espaco e quebra de
// linha, aceita "+", "/" e "=" e ignora os bits de sobra do ultimo caractere:
// varias grafias do mesmo MAC passariam. Exigir base64url canonico em cada
// segmento fecha essa folga.
function exigirCanonico(estado) {
  if (typeof estado !== 'string') throw new Error('malformed');
  const partes = estado.split('.');
  if (partes.length !== 3 || partes[0] !== 'v1') throw new Error('malformed');
  for (const segmento of partes.slice(1)) {
    if (!/^[A-Za-z0-9_-]+$/.test(segmento) || Buffer.from(segmento, 'base64url').toString('base64url') !== segmento) {
      throw new Error('malformed');
    }
  }
}

export function criarCodec(chave, { ttlSeconds = TTL_SEGUNDOS } = {}) {
  const codec = createRequestStateCodec({ key: chave, ttlSeconds });
  return {
    mint: (payload) => codec.mint(payload),
    // Qualquer throw aqui vira -32602 "Invalid or expired requestState" no SDK
    // (dentro do handler viraria isError). O payload sela a tool em "t"; ela e
    // conferida pelo header Mcp-Name, que o SDK ja garante igual a params.name.
    async verify(estado, ctx) {
      exigirCanonico(estado);
      const payload = await codec.verify(estado, ctx);
      const tool = ctx?.http?.req?.headers?.get?.('mcp-name');
      if (typeof tool !== 'string' || payload?.t !== tool) throw new Error('tool');
      return payload;
    },
  };
}
