// Agent Card na forma da v1.0 (modelo: exemplos/wire/07-a2a-agent-card.json).
// A URL da interface JSON-RPC sai de AGENTE_URL_PUBLICA ou da porta em uso.

export function criarCard(urlPublica) {
  return {
    name: 'Central de Salas',
    description: 'Reserva salas de reuniao da Hill Valley Tech.',
    provider: { organization: 'Hill Valley Tech', url: 'https://hillvalley.example' },
    version: '1.0.0',
    supportedInterfaces: [{ url: `${urlPublica.replace(/\/+$/, '')}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: 'reservar-sala',
        name: 'Reservar sala',
        description: 'Reserva uma sala em um intervalo. Se houver conflito, pergunta qual alternativa usar.',
        tags: ['salas', 'agenda'],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
        examples: ['reservar sala=sala-garagem inicio=2026-11-03T14:00:00-03:00 fim=2026-11-03T15:00:00-03:00 responsavel=Marty'],
      },
    ],
  };
}
