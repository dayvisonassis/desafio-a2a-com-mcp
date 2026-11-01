// O agente como servidor A2A v1.0 (JSON-RPC), com o SDK @a2a-js/sdk.
//
// O SDK cuida do protocolo: SendMessage bloqueante, GetTask, historico, -32004
// para Task em estado terminal e -32001 para Task inexistente. O executor so
// traduz: le o texto da mensagem, chama a ponte e publica o desfecho na Task.
import { randomUUID } from 'node:crypto';
import express from 'express';
import { TaskState, Role } from '@a2a-js/sdk';
import {
  AgentEvent, DefaultRequestHandler, InMemoryTaskStore, STATE_HEADERS_KEY, defaultServerCallContextBuilder,
} from '@a2a-js/sdk/server';
import { jsonRpcHandler, UserBuilder } from '@a2a-js/sdk/server/express';
import { criarCard } from './card.js';
import { lerTraceparent, novoTrace } from './trace.js';

const ESTADOS = {
  COMPLETED: TaskState.TASK_STATE_COMPLETED,
  FAILED: TaskState.TASK_STATE_FAILED,
  CANCELED: TaskState.TASK_STATE_CANCELED,
  INPUT_REQUIRED: TaskState.TASK_STATE_INPUT_REQUIRED,
};

// O modelo interno do SDK e estilo protobuf: enums numericos e parts com $case.
function parteDeTexto(texto) {
  return { content: { $case: 'text', value: texto }, metadata: undefined, filename: '', mediaType: '' };
}

function mensagemDoAgente(taskId, contextId, texto) {
  return {
    messageId: `msg-${randomUUID()}`, contextId, taskId, role: Role.ROLE_AGENT,
    parts: [parteDeTexto(texto)], metadata: undefined, extensions: [], referenceTaskIds: [],
  };
}

function status(state, message) {
  return { state, message, timestamp: new Date().toISOString() };
}

function textoDe(mensagem) {
  return (mensagem?.parts ?? []).map((p) => (p.content?.$case === 'text' ? p.content.value : '')).join(' ');
}

function publicarDesfecho(bus, taskId, contextId, desfecho) {
  // O artifact vai antes do status final: depois de um estado terminal ele se perde.
  if (desfecho.artifact) {
    bus.publish(AgentEvent.artifactUpdate({
      taskId,
      contextId,
      artifact: {
        artifactId: `art-${randomUUID()}`, name: desfecho.artifact.name, description: '',
        parts: [parteDeTexto(desfecho.artifact.texto)], metadata: undefined, extensions: [],
      },
      append: false,
      lastChunk: true,
      metadata: undefined,
    }));
  }
  bus.publish(AgentEvent.statusUpdate({
    taskId, contextId, metadata: undefined,
    status: status(ESTADOS[desfecho.estado], mensagemDoAgente(taskId, contextId, desfecho.texto)),
  }));
}

function criarExecutor(ponte) {
  return {
    async execute(rc, bus) {
      const { taskId, contextId } = rc;
      // O SDK exige que toda execucao comece por um evento task (ou message).
      if (rc.task) {
        bus.publish(AgentEvent.task(rc.task));
      } else {
        bus.publish(AgentEvent.task({
          id: taskId, contextId, status: status(TaskState.TASK_STATE_SUBMITTED, undefined),
          artifacts: [], history: [rc.userMessage], metadata: undefined,
        }));
      }
      bus.publish(AgentEvent.statusUpdate({ taskId, contextId, status: status(TaskState.TASK_STATE_WORKING, undefined), metadata: undefined }));

      let desfecho;
      try {
        const texto = textoDe(rc.userMessage);
        if (rc.task) {
          desfecho = await ponte.continuar(taskId, texto);
        } else {
          const headers = rc.context.state.get(STATE_HEADERS_KEY) ?? {};
          desfecho = await ponte.iniciar(taskId, texto, lerTraceparent(headers.traceparent) ?? novoTrace());
        }
      } catch (e) {
        desfecho = { estado: 'FAILED', texto: `Falha interna do agente: ${e?.message ?? e}` };
      }
      publicarDesfecho(bus, taskId, contextId, desfecho);
    },

    async cancelTask(taskId, bus) {
      bus.publish(AgentEvent.statusUpdate({ taskId, contextId: '', status: status(TaskState.TASK_STATE_CANCELED, undefined), metadata: undefined }));
    },
  };
}

export function criarAppA2a({ ponte, urlPublica }) {
  const card = criarCard(urlPublica);
  const handler = new DefaultRequestHandler(card, new InMemoryTaskStore(), criarExecutor(ponte));
  const app = express();
  app.get('/.well-known/agent-card.json', (req, res) => res.json(card));
  app.use('/a2a', jsonRpcHandler({
    requestHandler: handler,
    userBuilder: UserBuilder.noAuthentication,
    // O SDK trata a falta do header A2A-Version como 0.3 (e recusa, com o card so
    // em 1.0). O validador nao manda o header, entao a ausencia vale como 1.0.
    contextBuilder: (opcoes) => defaultServerCallContextBuilder({ ...opcoes, requestedVersion: opcoes.requestedVersion ?? '1.0' }),
  }));
  return app;
}
