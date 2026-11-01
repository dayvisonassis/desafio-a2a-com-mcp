// Sobe o servidor MCP e o agente do zero, roda validador/validar.py contra eles,
// confere no stderr do MCP o que o avaliador procura (passos 5 e 6 do fluxo),
// guarda as saidas em *.log e sai com codigo 0 so se tudo passar.
//
//   node scripts/validar.mjs
//
// Usa REQUEST_STATE_SECRET do ambiente se existir; senao gera uma chave so para
// esta execucao. As portas 7300 e 7301 precisam estar livres: o validador so vale
// com os dois processos recem-iniciados.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const caminho = (relativo) => fileURLToPath(new URL(`../${relativo}`, import.meta.url));

const PORTA_AGENTE = 7300;
const PORTA_MCP = 7301;
const CLIENTE_AGENTE = 'cliente=agente-central-de-salas';

function portaLivre(porta) {
  return new Promise((resolve) => {
    const teste = createServer();
    teste.once('error', () => resolve(false));
    teste.listen(porta, () => teste.close(() => resolve(true)));
  });
}

function subir(nome, arquivoLog, script, env) {
  const filho = spawn(process.execPath, [script], { cwd: raiz, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr = [];
  const pronto = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${nome} nao subiu em 15 s`)), 15000);
    const ler = (pedaco) => {
      stderr.push(pedaco.toString('utf8'));
      if (/ouvindo em http:\/\/localhost:\d+/.test(stderr.join(''))) {
        clearTimeout(timer);
        resolve();
      }
    };
    filho.stdout.on('data', (d) => process.stdout.write(d));
    filho.stderr.on('data', ler);
    filho.on('exit', (codigo) => {
      clearTimeout(timer);
      reject(new Error(`${nome} saiu com codigo ${codigo}:\n${stderr.join('')}`));
    });
  });
  pronto.catch(() => {});
  return { nome, arquivoLog, filho, stderr, pronto };
}

function acharPython() {
  const candidatos = [['python3'], ['python'], ['py', '-3']];
  for (const [cmd, ...args] of candidatos) {
    const r = spawnSync(cmd, [...args, '--version'], { encoding: 'utf8' });
    const versao = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    const m = /Python (\d+)\.(\d+)/.exec(versao);
    if (r.status === 0 && m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 10))) return [cmd, ...args];
  }
  throw new Error('nao achei Python 3.10+ (tentei python3, python e py -3)');
}

function campo(linha, nome) {
  return new RegExp(`(?:^| )${nome}=(\\S+)`).exec(linha)?.[1];
}

// O que o avaliador confere no stderr do servidor MCP. So valem as linhas do
// agente: o validador tambem fala direto com o MCP (com o mesmo traceparent) e
// faria estas conferencias passarem sozinhas.
function conferirLog(linhasMcp, traceId) {
  const doAgente = linhasMcp.filter((l) => l.includes(CLIENTE_AGENTE));
  const daTrace = doAgente.filter((l) => campo(l, 'traceparent')?.split('-')[1] === traceId);
  const metodo = (l) => campo(l, 'method');
  const primeiro = (m) => doAgente.findIndex((l) => metodo(l) === m);

  const chamadas = daTrace.filter((l) => metodo(l) === 'tools/call');
  const par = chamadas.findIndex((l, i) => i > 0 && campo(l, 'retry') === 'sim' && campo(chamadas[i - 1], 'retry') === 'nao');

  return [
    ['o agente faz tools/list antes do primeiro tools/call', primeiro('tools/list') !== -1 && primeiro('tools/list') < primeiro('tools/call')],
    [`tools/list do agente com o trace-id ${traceId}`, daTrace.some((l) => metodo(l) === 'tools/list')],
    [`resources/read do agente com o trace-id ${traceId}`, daTrace.some((l) => metodo(l) === 'resources/read')],
    [`tools/call do agente com o trace-id ${traceId}`, chamadas.length > 0],
    ['um tools/call pausado e o seu retry com ids diferentes e o mesmo trace-id', par > 0 && campo(chamadas[par], 'id') !== campo(chamadas[par - 1], 'id')],
  ];
}

async function main() {
  for (const porta of [PORTA_AGENTE, PORTA_MCP]) {
    if (!(await portaLivre(porta))) {
      console.error(`a porta ${porta} esta ocupada: encerre o processo que a usa (o validador precisa de processos recem-iniciados)`);
      return 2;
    }
  }

  const python = acharPython();
  const segredo = process.env.REQUEST_STATE_SECRET || randomBytes(32).toString('hex');
  const processos = [];
  const saidaValidador = [];
  let validador;

  const encerrar = () => {
    validador?.kill();
    for (const p of processos) p.filho.kill();
  };
  const gravarLogs = () => {
    writeFileSync(caminho('validador-saida.log'), saidaValidador.join(''));
    for (const p of processos) writeFileSync(caminho(p.arquivoLog), p.stderr.join(''));
  };
  for (const [sinal, codigo] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.once(sinal, () => {
      encerrar();
      gravarLogs();
      process.exit(codigo);
    });
  }

  try {
    const mcp = subir('servidor MCP', 'mcp-stderr.log', caminho('servidor-mcp/src/index.js'), { MCP_PORT: String(PORTA_MCP), REQUEST_STATE_SECRET: segredo });
    processos.push(mcp);
    await mcp.pronto;

    const agente = subir('agente', 'agente-stderr.log', caminho('agente/src/index.js'), { AGENTE_PORT: String(PORTA_AGENTE), MCP_URL: `http://localhost:${PORTA_MCP}/mcp` });
    processos.push(agente);
    await agente.pronto;

    const [cmd, ...args] = python;
    validador = spawn(cmd, [...args, caminho('validador/validar.py'), '--agente', `http://localhost:${PORTA_AGENTE}`, '--mcp', `http://localhost:${PORTA_MCP}`], {
      cwd: raiz,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    validador.stdout.on('data', (d) => { process.stdout.write(d); saidaValidador.push(d.toString('utf8')); });
    validador.stderr.on('data', (d) => { process.stderr.write(d); saidaValidador.push(d.toString('utf8')); });
    const codigo = await new Promise((resolve, reject) => {
      validador.on('error', reject);
      validador.on('exit', resolve);
    });

    // Da tempo de a ultima linha do stderr do MCP chegar antes de conferir.
    await new Promise((r) => setTimeout(r, 300));
    const traceId = /trace-id desta execucao: ([0-9a-f]{32})/.exec(saidaValidador.join(''))?.[1];
    const linhasMcp = mcp.stderr.join('').split(/\r?\n/);
    const conferencias = conferirLog(linhasMcp, traceId);
    console.log('\nconferencias no stderr do servidor MCP (passos 5 e 6 do fluxo do avaliador):');
    for (const [descricao, ok] of conferencias) console.log(`${ok ? 'PASS' : 'FAIL'} ${descricao}`);
    const logOk = conferencias.every(([, ok]) => ok);
    return codigo === 0 && logOk ? 0 : 1;
  } finally {
    encerrar();
    gravarLogs();
    if (processos.length) console.error(`\nlogs: validador-saida.log, ${processos.map((p) => p.arquivoLog).join(', ')}`);
  }
}

process.exitCode = await main().catch((e) => {
  console.error(e.message);
  return 1;
});
