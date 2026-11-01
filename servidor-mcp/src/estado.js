// Chave de integridade do requestState. Vem so do ambiente, nunca do codigo.

const COMO_GERAR = 'gere com: python3 -c "import secrets; print(secrets.token_hex(32))"';

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
