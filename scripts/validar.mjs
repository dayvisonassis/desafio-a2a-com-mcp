// Sobe o servidor MCP e o agente do zero, roda validador/validar.py contra eles,
// guarda as saidas em *.log e sai com o codigo do validador.
//
//   node scripts/validar.mjs
//
// Usa REQUEST_STATE_SECRET do ambiente se existir; senao gera uma chave so para
// esta execucao. As portas 7300 e 7301 precisam estar livres: o validador so vale
// com os dois processos recem-iniciados.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const caminho = (relativo) => fileURLToPath(new URL(`../${relativo}`, import.meta.url));

const PORTA_AGENTE = 7300;
const PORTA_MCP = 7301;

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
  const encerrar = () => { for (const p of processos) p.filho.kill(); };
  for (const sinal of ['SIGINT', 'SIGTERM']) process.once(sinal, () => { encerrar(); process.exit(130); });
  try {
    const mcp = subir('servidor MCP', 'mcp-stderr.log', caminho('servidor-mcp/src/index.js'), { MCP_PORT: String(PORTA_MCP), REQUEST_STATE_SECRET: segredo });
    processos.push(mcp);
    await mcp.pronto;

    const scriptAgente = caminho('agente/src/index.js');
    if (existsSync(scriptAgente)) {
      const agente = subir('agente', 'agente-stderr.log', scriptAgente, { AGENTE_PORT: String(PORTA_AGENTE), MCP_URL: `http://localhost:${PORTA_MCP}/mcp` });
      processos.push(agente);
      await agente.pronto;
    } else {
      console.error('(agente/src/index.js ainda nao existe: as verificacoes 21 a 36 vao falhar)');
    }

    const [cmd, ...args] = python;
    const validador = spawn(cmd, [...args, caminho('validador/validar.py'), '--agente', `http://localhost:${PORTA_AGENTE}`, '--mcp', `http://localhost:${PORTA_MCP}`], {
      cwd: raiz,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    const saidaValidador = [];
    validador.stdout.on('data', (d) => { process.stdout.write(d); saidaValidador.push(d.toString('utf8')); });
    validador.stderr.on('data', (d) => { process.stderr.write(d); saidaValidador.push(d.toString('utf8')); });
    const codigo = await new Promise((resolve, reject) => {
      validador.on('error', reject);
      validador.on('exit', resolve);
    });
    writeFileSync(caminho('validador-saida.log'), saidaValidador.join(''));
    return codigo ?? 1;
  } finally {
    encerrar();
    for (const p of processos) writeFileSync(caminho(p.arquivoLog), p.stderr.join(''));
    if (processos.length) console.error(`\nlogs: validador-saida.log, ${processos.map((p) => p.arquivoLog).join(', ')}`);
  }
}

process.exitCode = await main().catch((e) => {
  console.error(e.message);
  return 1;
});
