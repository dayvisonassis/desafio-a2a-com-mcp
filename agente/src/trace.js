// W3C trace context. O trace-id do traceparent recebido do cliente A2A fica com a
// Task e vai em todos os requests MCP dela; o span-id e novo a cada request.
import { randomBytes } from 'node:crypto';

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERADO_TRACE = '0'.repeat(32);
const ZERADO_SPAN = '0'.repeat(16);

export function lerTraceparent(valor) {
  const m = TRACEPARENT.exec(typeof valor === 'string' ? valor.trim() : '');
  if (!m || m[1] === ZERADO_TRACE || m[2] === ZERADO_SPAN) return null;
  return { traceId: m[1], flags: m[3] };
}

// Sem traceparent do cliente A2A, a Task ganha um trace proprio.
export function novoTrace() {
  return { traceId: randomBytes(16).toString('hex'), flags: '01' };
}

export function traceparentPara({ traceId, flags }) {
  return `00-${traceId}-${randomBytes(8).toString('hex')}-${flags}`;
}
