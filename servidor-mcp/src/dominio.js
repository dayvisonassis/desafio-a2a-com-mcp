// Regras de sala: validacao da politica, conflito e alternativas. A agenda vive
// em memoria; quem cria uma agenda (index.js) cria uma so por processo.

export const MENSAGENS = {
  salaInexistente: (id) => `Sala inexistente: ${id}`,
  formato: 'Formato de data invalido: use ISO 8601 com offset, ex.: 2026-11-03T14:00:00-03:00',
  intervalo: 'Intervalo invalido: fim deve ser posterior a inicio',
  janela: 'Fora da janela de uso: a politica permite reservas entre 08:00 e 20:00',
  duracao: 'Duracao acima do limite: a politica permite no maximo 2 horas',
  semAlternativas: 'Sem alternativas disponiveis no intervalo',
};

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const OFFSET_SAO_PAULO = -3 * HORA;
const ABERTURA = 8 * HORA;
const FECHAMENTO = 20 * HORA;
const DURACAO_MAXIMA = 2 * HORA;
const MAXIMO_ALTERNATIVAS = 3;
const ISO_COM_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// O Date.parse rola datas inexistentes (31/11 vira 01/12) e aceita T24:00, entao a
// data de calendario e a hora sao conferidas a parte.
function instante(texto) {
  if (typeof texto !== 'string' || !ISO_COM_OFFSET.test(texto)) return NaN;
  const ms = Date.parse(texto);
  if (Number.isNaN(ms)) return NaN;
  const dia = texto.slice(0, 10);
  if (new Date(`${dia}T00:00:00Z`).toISOString().slice(0, 10) !== dia) return NaN;
  if (Number(texto.slice(11, 13)) > 23) return NaN;
  return ms;
}

// Dia e hora no relogio de Sao Paulo, qualquer que seja o offset recebido.
function relogioSaoPaulo(ms) {
  const local = ms + OFFSET_SAO_PAULO;
  return { dia: Math.floor(local / DIA), horario: ((local % DIA) + DIA) % DIA };
}

function dentroDaJanela(inicioMs, fimMs) {
  const ini = relogioSaoPaulo(inicioMs);
  const fim = relogioSaoPaulo(fimMs);
  return ini.dia === fim.dia && ini.horario >= ABERTURA && fim.horario <= FECHAMENTO;
}

// conflitos, alternativas e criar esperam sala e horarios ja aprovados por validar.
export function criarAgenda({ salas, reservas }) {
  const porId = new Map(salas.map((s) => [s.id, s]));
  const agenda = reservas.map((r) => ({ ...r }));
  let proximo = 1 + Math.max(0, ...agenda.map((r) => Number(/^res-(\d+)$/.exec(r.id)?.[1] ?? 0)));

  function conflitos(sala, inicio, fim) {
    const ini = instante(inicio);
    const fi = instante(fim);
    return agenda
      .filter((r) => r.sala === sala && instante(r.inicio) < fi && ini < instante(r.fim))
      .map(({ id, inicio: i, fim: f, responsavel }) => ({ id, inicio: i, fim: f, responsavel }));
  }

  return {
    validar(sala, inicio, fim) {
      if (!porId.has(sala)) return MENSAGENS.salaInexistente(sala);
      const ini = instante(inicio);
      const fi = instante(fim);
      if (Number.isNaN(ini) || Number.isNaN(fi)) return MENSAGENS.formato;
      if (fi <= ini) return MENSAGENS.intervalo;
      if (!dentroDaJanela(ini, fi)) return MENSAGENS.janela;
      if (fi - ini > DURACAO_MAXIMA) return MENSAGENS.duracao;
      return null;
    },

    conflitos,

    alternativas(sala, inicio, fim) {
      const capacidade = porId.get(sala).capacidade;
      return salas
        .filter((s) => s.id !== sala && s.capacidade >= capacidade && conflitos(s.id, inicio, fim).length === 0)
        .sort((a, b) => a.capacidade - b.capacidade || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, MAXIMO_ALTERNATIVAS)
        .map((s) => s.id);
    },

    // Guarda inicio e fim exatamente como chegaram: o retorno ecoa as strings originais.
    criar({ sala, inicio, fim, responsavel }) {
      const reserva = { id: `res-${String(proximo++).padStart(4, '0')}`, sala, inicio, fim, responsavel };
      agenda.push(reserva);
      return { ...reserva };
    },
  };
}
