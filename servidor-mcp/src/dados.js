// Leitura de dados/. Os arquivos sao so lidos: as reservas criadas em execucao
// vivem em memoria e nunca voltam para o disco.
import { readFileSync } from 'node:fs';

const PASTA_DADOS = new URL('../../dados/', import.meta.url);

// No Windows, com core.autocrlf, a copia de trabalho tem CRLF: \S+ para antes do \r.
export function extrairVersao(texto) {
  const m = /^versao:\s*(\S+)/m.exec(texto);
  if (!m) throw new Error('politica sem linha "versao:"');
  return m[1];
}

function lerJson(nome) {
  return JSON.parse(readFileSync(new URL(nome, PASTA_DADOS), 'utf8'));
}

export function carregarDados() {
  const politica = readFileSync(new URL('politica-de-uso.md', PASTA_DADOS), 'utf8');
  return {
    salas: lerJson('salas.json'),
    reservas: lerJson('reservas.json'),
    politica,
    versaoPolitica: extrairVersao(politica),
  };
}
