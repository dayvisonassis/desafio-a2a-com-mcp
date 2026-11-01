// Proxy HTTP gravador para os testes do agente: fica entre o agente e o servidor
// MCP real, repassa cada request sem mexer e guarda o que foi e o que voltou.
// O alvo pode ser trocado em execucao (para testar restart do servidor MCP).
import { createServer } from 'node:http';

export async function subirGravador(alvoInicial) {
  let alvo = alvoInicial;
  const trocas = [];

  const servidor = createServer(async (req, res) => {
    const pedacos = [];
    for await (const p of req) pedacos.push(p);
    const bruto = Buffer.concat(pedacos).toString('utf8');
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['host', 'content-length', 'connection'].includes(k)));
    let corpo;
    try { corpo = JSON.parse(bruto); } catch { corpo = undefined; }
    const registro = { metodoHttp: req.method, headers, corpo, bruto };
    trocas.push(registro);
    try {
      const r = await fetch(alvo, { method: req.method, headers, body: req.method === 'POST' ? bruto : undefined });
      const texto = await r.text();
      registro.status = r.status;
      registro.resposta = (() => { try { return JSON.parse(texto); } catch { return texto; } })();
      res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') ?? 'application/json' });
      res.end(texto);
    } catch (e) {
      registro.status = 502;
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: String(e?.message ?? e) }));
    }
  });
  await new Promise((resolve) => servidor.listen(0, resolve));
  const porta = servidor.address().port;

  return {
    url: `http://localhost:${porta}/mcp`,
    trocas,
    // Os requests JSON-RPC (com method), filtrados pelo metodo se ele for dado.
    requests(metodo) {
      return trocas.filter((t) => t.corpo?.method && (!metodo || t.corpo.method === metodo));
    },
    apontarPara(novoAlvo) { alvo = novoAlvo; },
    async parar() { await new Promise((resolve) => servidor.close(resolve)); },
  };
}
