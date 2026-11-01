# CLAUDE.md: desafio "A Ponte", um agente A2A com MCP por dentro

Regras deste projeto. Todo item é obrigatório para o desafio ser aceito, exceto os marcados como **Recomendação**.

## Fontes da verdade

| Fonte | Papel |
|---|---|
| `README.md` | Enunciado oficial, por enquanto. **Será substituído** pela documentação da entrega (seção 6). O original continua em `git show 263f17e:README.md` e no repositório upstream |
| `validador/validar.py` | O que o avaliador roda: 36 verificações |
| `validador/README.md` | Como rodar o validador e o que ele não cobre |
| `exemplos/wire/*.json` | Forma exata dos requests e responses que o validador envia e espera |

Se este arquivo divergir dessas fontes, elas vencem: avise o usuário e corrija este arquivo. Se as fontes divergirem entre si, pare e pergunte.

Os exemplos de wire foram capturados com o SDK Python. Detalhes que são do SDK não precisam ser imitados: a chave do `inputRequests` (`__main__:escolha_de_sala`), os `title`, `$defs` e `anyOf` dos schemas, `cacheScope`, `ttlMs`, `serverInfo` e o texto das mensagens de erro de protocolo. Onde os SDKs divergem entre si ou da letra da spec, os critérios aceitam as duas formas só nos pontos em que o enunciado diz isso: tool inexistente por `-32602` ou `isError`; `enum` ou `const` quando há uma alternativa só; prefixo como `Error executing tool <nome>: ` antes da mensagem; texto da mensagem do erro de `requestState`; texto da chave do `inputRequests`. Fora desses pontos, vale o que o enunciado e o validador exigem. Não force o SDK TypeScript a imitar o Python.

Os wires 08 a 10 também foram capturados com outras reservas já feitas (`alternativas: sala-mirante`, `res-0005`). Com os processos recém-iniciados, o mesmo pedido dá `alternativas: sala-fusca, sala-mirante`. Não copie desses wires os valores que dependem do estado (a lista de alternativas e os ids de reserva).

## Stack (decidida)

- Node.js 20 ou superior, ESM (`"type": "module"`).
- Servidor MCP com o SDK oficial v2, `@modelcontextprotocol/server`, alinhado à revisão `2026-07-28` da spec. O valor de `protocolVersion` é `2026-07-28`.
- A2A v1.0, binding JSON-RPC 2.0 sobre HTTP.
- Versões travadas: versão exata no `package.json` (sem `^` nem `~`) e `package-lock.json` versionado.
- Python 3.10 ou superior, só para rodar o validador.
- Proibido ter SDK de provedor de LLM nas dependências (openai, @anthropic-ai/sdk, langchain, ai etc.) e proibido usar LLM no caminho de execução.

## O que não pode ser alterado

- `dados/`, `validador/` e `exemplos/`: nunca editar, mover, renomear nem reformatar. O avaliador usa os do repositório original, então mexer neles só invalida a entrega.
- O servidor só **lê** `dados/`. Reservas novas ficam em memória e nunca são gravadas em `dados/reservas.json`.
- Estrutura obrigatória: `README.md` (substituído), `dados/`, `validador/`, `exemplos/wire/`, `servidor-mcp/` (código do servidor) e `agente/` (código do agente). Arquivos de apoio, como scripts de subida, podem ficar na raiz.
- Entrega: um único repositório público no GitHub, fork de https://github.com/devfullcycle/desafio-a2a-com-mcp, tudo na branch `main`. Mover os dados, reescrever o validador ou juntar os dois processos em um reprova a entrega.

## Restrições não negociáveis

1. **Dois processos separados.** O agente fala com o servidor MCP por HTTP, como um cliente MCP de verdade. É proibido importar no agente qualquer código do servidor (tools, regras, dados).
2. **O agente não tem regra de negócio de sala.** Conflito, política, validações e alternativas são decididos só pelo servidor MCP. O agente traduz protocolo e não lê `dados/`.
3. **Nada de sessão.** Nenhum dos lados infere versão, capabilities ou contexto a partir de request anterior ou de conexão aberta: cada request traz tudo no `_meta`. Não usar `Mcp-Session-Id` nem exigir `initialize` antes dos outros métodos. Manter um objeto cliente vivo entre chamadas é normal e recomendado.
4. **O `requestState` é opaco para o agente.** O agente guarda e ecoa byte a byte, e nunca decodifica, abre, interpreta, reconstrói ou modifica, mesmo que o conteúdo seja legível.
5. **Sem LLM.** O mesmo pedido produz sempre o mesmo resultado.
6. **Limitação real do SDK:** documentar no README com o trecho que comprova, em vez de contornar reescrevendo o protocolo.

## Portas e endpoints

| Processo | Porta padrão | Endpoints |
|---|---|---|
| Agente (A2A) | `7300` | `POST /a2a` (JSON-RPC), `GET /.well-known/agent-card.json` |
| Servidor MCP | `7301` | `POST /mcp` (Streamable HTTP, endpoint único) |

As portas podem vir de variável de ambiente, desde que os padrões sejam esses. **Recomendação:** tornar configurável também a URL do servidor MCP usada pelo agente, com padrão `http://localhost:7301/mcp`.

## Domínio (pronto em `dados/`)

Salas (`dados/salas.json`):

| id | nome | capacidade | recursos |
|---|---|---|---|
| sala-aquario | Aquario | 4 | tv |
| sala-porao | Porao | 6 | quadro |
| sala-garagem | Garagem | 12 | tv, quadro |
| sala-fusca | Fusca | 12 | tv |
| sala-mirante | Mirante | 20 | tv, quadro, camera |

Reservas iniciais (`dados/reservas.json`): `res-0001`, sala-garagem, 2026-11-03 das 14:00 às 15:00 (Marty), e `res-0002`, sala-fusca, 2026-11-03 das 16:00 às 17:00 (Jennifer), em `-03:00`.

Política (`dados/politica-de-uso.md`), com a primeira linha `versao: 2026-11-01`:
- reservas só entre 08:00 e 20:00, horário de São Paulo (`-03:00`), valendo para o início e para o fim;
- duração máxima de 2 horas;
- uma sala não pode ter duas reservas sobrepostas.

Decisões de produto já fechadas:
- Nenhuma regra depende da data de hoje. Reservar no passado é permitido.
- **Alternativas** são as salas livres no intervalo, com capacidade **maior ou igual** à da sala pedida, no máximo **3**, ordenadas por capacidade crescente e, no empate, por `id` em ordem alfabética.
- As reservas podem ficar em memória. As criadas durante a execução valem para as consultas seguintes do mesmo processo e não precisam sobreviver a restart. O `requestState` é a exceção: tem que continuar válido depois de um restart.

**Recomendação:** comparar instantes (depois de converter o offset), não strings. Devolver as strings originais é obrigatório (seção 1). Usar intervalo semiaberto `[inicio, fim)`, em que reservas encostadas não conflitam. Duas horas exatas e fim às 20:00 são permitidos. IDs de reserva seguem a sequência (`res-0003`, `res-0004`...). Validar nesta ordem: sala, intervalo, janela, duração.

## Mensagens e erros (texto exato, sem acento)

O validador procura o texto exato dentro do conteúdo do resultado. Um prefixo do SDK, como `Error executing tool <nome>: `, é aceito. Texto diferente não é. Ele lê o texto em `result.content[].text`, com os blocos unidos por espaço, e não no `structuredContent` nem em `error.message`.

Erros de execução da tool, com `isError: true` dentro de um resultado `complete`:

| Situação | Mensagem |
|---|---|
| Sala que não está em `dados/salas.json` | `Sala inexistente: <id informado>` |
| Início ou fim fora da janela | `Fora da janela de uso: a politica permite reservas entre 08:00 e 20:00` |
| Mais de 2 horas | `Duracao acima do limite: a politica permite no maximo 2 horas` |
| `fim` menor ou igual a `inicio` | `Intervalo invalido: fim deve ser posterior a inicio` |
| Conflito sem nenhuma alternativa válida | `Sem alternativas disponiveis no intervalo` |

Erros de protocolo, como `error` de JSON-RPC:

| Situação | Código | HTTP |
|---|---|---|
| Tool inexistente | `-32602` (ou `isError: true`; as duas formas são aceitas) | não especificado |
| `_meta` sem `io.modelcontextprotocol/protocolVersion` ou sem `io.modelcontextprotocol/clientCapabilities` | `-32602` | `400` |
| Precisa de elicitation e o cliente não declarou elicitation em **form mode** | `-32021`, com `data.requiredCapabilities` listando o que faltou (ex.: `{"elicitation":{"form":{}}}`) | `400` |
| `requestState` adulterado, inválido ou expirado | `-32602`, com a mensagem que o SDK produzir | não especificado |
| `resources/read` de URI inexistente | `-32602` (a spec proíbe devolver `contents` vazio) | não especificado |
| Header espelhado (`MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`) que não bate com o corpo | `-32020` | não especificado |

Não é erro: recusa na elicitation (`action` igual a `decline` ou `cancel`). O resultado é `complete`, com `isError` ausente ou `false`, e o `structuredContent` traz `reservado: false` e um `motivo`.

## 1. Servidor MCP (`servidor-mcp/`)

- Streamable HTTP, endpoint único `/mcp`, porta `7301`.
- **Responder com `Content-Type: application/json`, não com SSE.** O validador faz `json.loads` do corpo inteiro. Configurar o transporte do SDK para responder em JSON.
- Atender qualquer método sem handshake prévio e sem sessão: o validador chama `tools/list` direto, sem `initialize`.
- Rejeitar com `-32602` e HTTP `400` todo request sem `io.modelcontextprotocol/protocolVersion` ou sem `io.modelcontextprotocol/clientCapabilities` no `_meta`, sem inferir nada de request anterior.
- O header nunca substitui o campo do `_meta`. Sem `io.modelcontextprotocol/protocolVersion` no `_meta`, a resposta é `-32602` com HTTP `400` mesmo com o header `MCP-Protocol-Version` presente (o check 04 manda o header). A checagem do `_meta` obrigatório vem antes da checagem de espelhamento (`-32020`).
- Os ids JSON-RPC do validador são strings (12 caracteres hex), e os dos wires são números. Aceitar os dois tipos e devolver o id com o mesmo tipo e valor. Vale também para o `/a2a` do agente.
- Declarar as capabilities `tools` e `resources`.
- Três tools, todas com `inputSchema` que é um objeto JSON Schema válido (`"type": "object"`):
  - `listar_salas`: sem parâmetros (`{"type":"object","properties":{}}`), com `outputSchema` declarado. O `structuredContent` é `{"salas":[{id, nome, capacidade, recursos}, ...]}`, conforme o schema, e vem **um único** bloco de texto com o mesmo JSON serializado. O validador junta os blocos com espaço e exige `json.loads(texto) == structuredContent`.
  - `consultar_disponibilidade`: recebe `sala`, `inicio` e `fim` (obrigatórios) e devolve `{sala, livre, conflitos: [{id, inicio, fim, responsavel}]}`. Aplica as mesmas validações de sala e de política da reserva, com os mesmos erros de execução.
  - `reservar_sala`: recebe `sala`, `inicio`, `fim` e `responsavel` (obrigatórios). Cria a reserva quando o intervalo está livre e dentro da política. Em conflito, entra no MRTR (seção 2).
- As três tools devolvem `structuredContent` **e** o bloco de texto.
- Reserva concluída: o `structuredContent` traz `reserva`, `reservado: true`, `sala`, `inicio`, `fim`, `responsavel` e `politica` (versão da política). O exemplo de wire também traz `motivo: null`.
- `inicio` e `fim` voltam no `structuredContent`, e depois no artifact, exatamente como as strings do pedido original (ex.: `2026-11-03T09:00:00-03:00`). No retry, são as strings seladas, não as reenviadas. Nunca reserializar a partir de `Date`: `toISOString()` dá `2026-11-03T12:00:00.000Z` e reprova o check 18, que compara string com string. A conversão para instante serve só para comparar.
- Recusa: `reservado: false` e `motivo`. O exemplo usa `"recusado"` e deixa os demais campos `null`.
- Os `outputSchema` de referência estão em `exemplos/wire/01-tools-list.json`. O `structuredContent` precisa obedecer ao schema declarado, inclusive no caso de recusa.
- Resource `politica://uso`, devolvendo o conteúdo de `dados/politica-de-uso.md` com `mimeType: text/markdown` e a `uri` no item de `contents`. O validador lê `result.contents[0].text`: o conteúdo vem em `text` (não em `blob`) e no primeiro item.
- Log no **stderr** (não usar o logging do protocolo, que está depreciado): uma linha por request recebido com, no mínimo, o método, o id e o `traceparent` do `_meta` quando ele vier. **Recomendação:** registrar na borda HTTP, antes da validação, para que os requests rejeitados também apareçam. Nunca logar `REQUEST_STATE_SECRET`.
- Header espelhado que não bate com o corpo é recusado com `-32020`. Conferir que o SDK faz isso.

## 2. MRTR em `reservar_sala`

Não existe canal de volta. O servidor **não** inicia request para o cliente durante a execução da tool: nada de pergunta síncrona ao usuário, que no transporte stateless dá erro de "sem canal de volta". Ele **termina** a resposta pedindo informação, e o cliente volta com um request novo. No SDK TypeScript, procure por `inputRequired` e leia as docstrings. **Recomendação:** para o `requestState`, usar o utilitário pronto do próprio SDK (o enunciado dá isso como pista).

**Primeira chamada, com conflito:**
- O `result` traz `resultType: "input_required"`, `inputRequests` (mapa com **uma única** entrada) e `requestState`.
- A chave do mapa é atribuída pelo servidor (o exemplo usa `__main__:escolha_de_sala`), e o cliente devolve a mesma chave em `inputResponses`.
- O valor é `{"method": "elicitation/create", "params": {"mode": "form", "message": "A sala pedida esta ocupada nesse intervalo. Escolha uma alternativa.", "requestedSchema": {...}}}`.
- O `requestedSchema` é plano: `{"type":"object","properties":{"sala":{"type":"string","enum":[...]}},"required":["sala"]}`, com as alternativas no `enum` na ordem da regra. Com uma só alternativa, `const` também é aceito. **Recomendação:** usar sempre `enum`.
- Sem nenhuma alternativa não há elicitation: a tool devolve `isError: true` com `Sem alternativas disponiveis no intervalo`.
- Se a elicitation seria necessária e o cliente não declarou `elicitation.form` em `clientCapabilities`, a resposta é `-32021` com `data.requiredCapabilities` e HTTP `400`. Atenção à diferença: `clientCapabilities: {}` presente dá `-32021`, e `clientCapabilities` ausente dá `-32602`. Um request sem conflito, vindo de cliente sem elicitation, funciona normalmente.

**`requestState`:**
- Integridade obrigatória, por HMAC ou AEAD. Cifrar é opcional. Um JSON em base64 sem assinatura é reprovado.
- Adulteração, por exemplo trocar os últimos 6 caracteres, dá `-32602`. Nunca erro 500 e nunca processar assim mesmo.
- **Recomendação:** verificar a integridade sobre a string recebida, ou rejeitar codificação não canônica (decodificar, recodificar e comparar com o original). Em base64 e base64url, o último caractere pode carregar bits de preenchimento que o `Buffer.from` do Node descarta, e aí a troca de um caractere só passaria despercebida (o passo 11 do avaliador troca um caractere só). Testar trocando cada um dos últimos caracteres, um por vez, mesmo usando o utilitário do SDK.
- Expiração embutida entre 5 e 30 minutos. Expirado dá `-32602`.
- Carrega tudo o que é preciso para reconstruir o pedido: a tool (`reservar_sala`), os argumentos originais (`sala`, `inicio`, `fim`, `responsavel`), as alternativas oferecidas e a expiração. O servidor não guarda **nada** em memória entre o `input_required` e o retry, e um retry depois de reiniciar o processo tem que funcionar.
- A chave vem de `REQUEST_STATE_SECRET` (variável de ambiente), nunca do código, com no mínimo 32 bytes de aleatoriedade. Para gerar: `python3 -c "import secrets; print(secrets.token_hex(32))"`.
- **Recomendação:** recusar a subida se a variável faltar ou for curta, e nunca gerar uma chave aleatória na subida, o que quebraria o retry depois do restart.
- O README explica como gerar e exportar a chave e nunca traz o valor usado, porque o repositório é público. `.env` já está no `.gitignore`.
- Como o servidor não guarda nada entre o `input_required` e o retry, não dá para controlar uso único em memória: o mesmo `requestState` válido pode chegar mais de uma vez. No check 19, o estado do check 13 é apresentado intacto depois de uma cópia adulterada dele ter sido rejeitada no check 17.

**Retry:**
- O servidor lê `inputResponses` e `requestState` de dentro de `params`, valida o `requestState`, reconstrói o pedido **a partir do estado selado** e conclui com `resultType: "complete"`.
- Os `arguments` reenviados não são confiáveis. Se divergirem do que foi selado, o servidor rejeita o estado ou usa os valores selados (o validador aceita os dois caminhos). Se rejeitar, tem que ser `error` JSON-RPC (ex.: `-32602`): rejeitar com `isError: true` reprova o check 18. **Recomendação:** usar os valores selados e rejeitar um estado apresentado em outra tool.
- `accept` com `content.sala` reserva na sala escolhida, com `inicio`, `fim` e `responsavel` selados. **Recomendação:** rejeitar escolha que não esteja entre as alternativas seladas e revalidar a disponibilidade no momento do retry.
- `decline` ou `cancel` conclui com `complete`, sem `isError`, com `reservado: false` e `motivo`, e nada é reservado.

## 3. Agente como host MCP (`agente/`)

- Descobre as tools com `tools/list` antes do primeiro `tools/call` e não carrega uma lista fixa no código. O log do servidor precisa mostrar o `tools/list` antes do primeiro `tools/call` do agente.
- Lê o resource `politica://uso` e extrai a versão da primeira linha (`versao: 2026-11-01`). Nunca fixar a versão no código.
- Todo request MCP do agente leva em `params._meta`:
  - `io.modelcontextprotocol/protocolVersion: "2026-07-28"`;
  - `io.modelcontextprotocol/clientCapabilities: {"elicitation": {"form": {}}}`, exatamente nessa forma;
  - `traceparent` (ver abaixo). `io.modelcontextprotocol/clientInfo` é opcional (o exemplo usa `agente-central-de-salas`).
- Todo request MCP do agente leva os headers espelhados do corpo: `MCP-Protocol-Version`, `Mcp-Method` e, em `tools/call` e `resources/read`, `Mcp-Name` (o nome da tool ou a URI do resource). Leva também `Content-Type: application/json` e `Accept: application/json, text/event-stream`. Header que não bate com o corpo é recusado com `-32020`.
- Todo request MCP tem um `id` JSON-RPC único. **O retry nunca reaproveita o id do request inicial.**
- `traceparent`: quando o cliente A2A manda o header `traceparent`, todos os requests MCP daquela Task levam no `_meta` um `traceparent` com o **mesmo trace-id**. O span-id pode ser novo. Guardar o trace-id na Task, porque a continuação pode chegar sem o header. Nenhuma verificação do validador cobre esse caso: a exigência vem do enunciado ("todos os requests MCP daquela Task").
- O agente precisa enxergar o `input_required` **cru**. É proibido registrar no cliente MCP um callback ou handler de elicitation que responda sozinho, porque isso fecha o ciclo sem pausar a Task.
- Um `isError: true` de tool termina a Task em `TASK_STATE_FAILED`, com a mensagem exata da tool em `status.message` (é ali que o validador procura) e no histórico da Task.
- Não fazer `tools/call` de teste na subida do agente: isso muda o estado que o validador espera.
- **Recomendação:** fazer a descoberta (`tools/list`) na primeira Task, ou com nova tentativa, para não depender da ordem em que os processos sobem.

## 4. Agente como servidor A2A

**Agent Card** em `GET /.well-known/agent-card.json`: HTTP 200, forma da v1.0. O modelo fiel é `exemplos/wire/07-a2a-agent-card.json`:
- identidade: `name`, `description`, `provider`, `version`;
- `supportedInterfaces: [{"url": "http://<host>:7300/a2a", "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}]`;
- `capabilities: {"streaming": false, "pushNotifications": false, "extendedAgentCard": false}`;
- `defaultInputModes` e `defaultOutputModes` com `text/plain`;
- `skills` com uma skill de `id: "reservar-sala"`, mais `name`, `description`, `tags`, `inputModes`, `outputModes` e `examples`.

Campos da v0.x são erro: nada de `interfaces`, `preferredTransport` ou `additionalInterfaces`. Dentro de `supportedInterfaces`, o campo do transporte é `protocolBinding`. Não preencher `securitySchemes`. O card nunca expõe o `requestState`.

**Endpoint `POST /a2a`**, JSON-RPC 2.0, com os métodos `SendMessage` e `GetTask`:
- A mensagem do cliente tem a forma `{"messageId", "role": "ROLE_USER", "parts": [{"text": "..."}], "taskId"?}`.
- `SendMessage` sem `taskId` abre uma Task nova, com `id` e `contextId` próprios.
- `SendMessage` é síncrono: a resposta já traz a Task no estado resultante, em `result.task` (forma dos wires 08 e 10).
- O validador manda requests mínimos ao `/a2a`: só `Content-Type` (às vezes `traceparent`), sem `Accept` nem header de versão do A2A, com `params: {message}` sem `configuration` e sem `contextId`, e parts sem `kind`. Aceitar assim e, sem `configuration`, responder de forma bloqueante. Se usar um SDK de A2A, conferir os defaults de blocking e de versão.
- `GetTask` recebe `params: {"id": "<taskId>"}` e devolve a Task com `id`, `contextId`, `status.state` corrente, `history` e `artifacts` quando existirem. O wire 09 (SDK Python) embrulha em `result.task`; a spec v1.0 (`rpc GetTask(...) returns (Task)`) e o `@a2a-js/sdk` devolvem a Task direto em `result`. O validador aceita as duas (`validar.py:152`), e esta entrega usa a do SDK.
- A Task tem `id`, `contextId`, `status: {state, message}`, `history` e `artifacts`. As mensagens do agente usam `role: "ROLE_AGENT"` e trazem `messageId`, `taskId` e `contextId`.
- Estados: `TASK_STATE_SUBMITTED` → `TASK_STATE_WORKING` → (`TASK_STATE_INPUT_REQUIRED` ↔ `TASK_STATE_WORKING`) → `TASK_STATE_COMPLETED`, `TASK_STATE_FAILED` ou `TASK_STATE_CANCELED`. A Task passa por SUBMITTED e WORKING antes de terminar, e `GetTask` reflete o estado corrente a qualquer momento.
- Estado terminal é definitivo: COMPLETED, CANCELED e FAILED nunca voltam a WORKING. Um `SendMessage` com `taskId` de Task terminal é recusado com `error` JSON-RPC. O validador só checa a presença de `error`. O código é `-32004` (`UnsupportedOperationError`), conforme a spec v1.0 §3.1.1, e é o que o `@a2a-js/sdk` devolve. Um `taskId` inexistente também recebe erro (`TaskNotFoundError`).
- Sucesso produz um artifact `{"artifactId", "name": "reserva", "parts": [{"text": "<JSON>"}]}` com **uma** parte de texto. O JSON traz `reserva`, `sala`, `inicio`, `fim`, `responsavel` e `politica`, que é a versão lida do resource. Exemplo: `{"reserva":"res-0003","sala":"sala-fusca","inicio":"2026-11-03T14:00:00-03:00","fim":"2026-11-03T15:00:00-03:00","responsavel":"Marty","politica":"2026-11-01"}`.

**Formatos fixos de texto** (não é linguagem natural):
- Pedido: `reservar sala=<id> inicio=<iso8601> fim=<iso8601> responsavel=<nome>`
- Continuação: `escolha=<id da sala>` para aceitar, ou `escolha=recusar` para recusar
- O agente só interpreta o formato. Não valida sala, horário nem política, porque isso é do servidor.

## 5. A ponte (o que está sendo avaliado)

Um único `SendMessage` de sala ocupada tem que causar, em sequência: abertura da Task, chamada MCP, `input_required`, pausa da Task e, na continuação, retomada com id novo e reserva criada. Se faltar qualquer um desses efeitos, a entrega está incompleta.

- **Ao receber `input_required`:** a Task vai para `TASK_STATE_INPUT_REQUIRED`, e o `status.message` tem **uma** parte de texto com exatamente `alternativas: <ids separados por ", ">`, na ordem do `enum` (ou o valor do `const`). Sem prefixo, sem saudação e sem ponto final: o validador compara duas pausas iguais byte a byte e exige que o texto comece com `alternativas:`.
- **Guardar, ligado àquela Task** (ex.: `Map<taskId, pendencia>`): o `requestState` intacto, a chave do `inputRequests`, o `enum` oferecido, o nome da tool, os `arguments` originais e o trace-id. O `requestState` nunca aparece no card, no artifact, nas mensagens, no histórico nem nos erros devolvidos ao cliente A2A. O check 34 procura nas respostas A2A os 40 primeiros caracteres do `requestState` que o validador recebeu direto do MCP no check 13, e esse não é o estado que o agente guardou. A verificação pega pouca coisa: a garantia tem que vir do código.
- **Continuação** (`SendMessage` com `taskId` e `escolha=<valor>`):
  - valor que está no `enum`: retry com `inputResponses: {<mesma chave>: {"action": "accept", "content": {"sala": "<valor>"}}}`;
  - `recusar`: retry com `{"action": "decline"}`, e a Task termina em `TASK_STATE_CANCELED`;
  - qualquer outro valor (fora do `enum` ou fora do formato): a Task continua em `TASK_STATE_INPUT_REQUIRED`, repete a mesma linha `alternativas: ...`, e nada é enviado ao MCP.
- **Retry:** o mesmo `tools/call` (mesmo `name` e mesmos `arguments` originais), com **id JSON-RPC novo**, `inputResponses` com a mesma chave, o `requestState` ecoado sem modificação e todos os campos de `_meta` e headers obrigatórios.
- **Resultado do retry:** `complete` com reserva dá COMPLETED com o artifact; `complete` com `reservado: false` dá CANCELED; `isError` dá FAILED com a mensagem; erro JSON-RPC dá FAILED; um novo `input_required` pausa de novo com o novo `requestState`.
- **O estado pausado é por Task:** duas Tasks pausadas ao mesmo tempo concluem cada uma com a sua reserva, sem trocar de `requestState`. Nada de variável global de "pendência atual".

## 6. README da entrega

Substituir o `README.md` do starter pela documentação da entrega (o enunciado original continua em `git show 263f17e:README.md` e no repositório upstream), com estas seções:

1. **Como rodar:** os comandos exatos, a partir de um clone limpo, para instalar as dependências, gerar e exportar o `REQUEST_STATE_SECRET`, subir o servidor MCP, subir o agente e rodar `python3 validador/validar.py --agente http://localhost:7300 --mcp http://localhost:7301`. **Recomendação:** avisar que os passos manuais do avaliador (7 a 13) pedem os dois processos reiniciados depois do validador.
2. **Onde a ponte acontece:** um parágrafo apontando o ponto do código (arquivo e função) em que o `input_required` do MCP vira `TASK_STATE_INPUT_REQUIRED`, e o ponto em que o `requestState` volta para o servidor.
3. **Decisões técnicas:** como o `requestState` foi protegido, por quanto tempo ele vale e onde ficou o estado das Tasks.
4. **Saída do validador:** a saída completa da última execução, em bloco de código.

Se houver limitação real do SDK, documentar também, com o trecho que comprova. Nunca colocar no README o valor do segredo.

## O que o validador cobra (36 verificações, nesta ordem)

Ele roda tudo em sequência contra **os dois processos recém-iniciados**, e as reservas de uma verificação mudam as seguintes. Rodar duas vezes sem reiniciar gera falso negativo. O timeout é de 30 s em cada POST e de 15 s no GET do card. Dia usado: `2026-11-03`, em `-03:00`.

**MCP direto (1 a 20):**

| # | O que faz | Espera |
|---|---|---|
| 01 | `tools/list` | as três tools |
| 02 | mesma resposta do 01 | todo `inputSchema.type == "object"` |
| 03 | `listar_salas` | `json.loads(texto) == structuredContent` |
| 04 | sem `protocolVersion` | `-32602` e HTTP 400 |
| 05 | sem `clientCapabilities` | `-32602` e HTTP 400 |
| 06 | tool `voar_delorean` | `-32602` ou `isError` |
| 07 | `resources/read politica://uso` | contém `2026-11-01` |
| 08 | `resources/read politica://inexistente` | `-32602` |
| 09 | reservar `sala-delorean` 09-10 | `isError` com `Sala inexistente: sala-delorean` |
| 10 | consultar aquario 07-08 | `isError` de janela |
| 11 | consultar aquario 09-12 | `isError` de duração |
| 12 | consultar aquario 10→09 | `isError` de intervalo |
| 13 | reservar garagem 14-15, com `traceparent` | `input_required`, 1 entrada, `requestState` |
| 14 | mesma resposta do 13 | `mode: form`, `enum == ["sala-fusca", "sala-mirante"]` |
| 15 | garagem 14-15 de novo, com `clientCapabilities: {}` | `-32021`, `data.requiredCapabilities`, HTTP 400 |
| 16 | fusca 16-17 (conflito), retry `accept` com sala-garagem | `complete`, sem `isError`, `structuredContent.sala == "sala-garagem"` |
| 17 | retry com o `requestState` do 13 com os últimos 6 caracteres trocados | `-32602` |
| 18 | garagem 09-10 Ocupante (livre); garagem 09-10 Doc (conflito); retry com argumentos adulterados (mirante 13-14 Biff) escolhendo fusca | `error` JSON-RPC (não `isError`), ou `structuredContent` com `inicio` `2026-11-03T09:00:00-03:00` e `responsavel` Doc |
| 19 | retry `decline` com o `requestState` original do 13 | `complete`, sem `isError`, `reservado: false` |
| 20 | mirante 11-12 duas vezes | a 2ª dá `isError` com `Sem alternativas disponiveis no intervalo` |

**A2A com o agente (21 a 36):**

| # | O que faz | Espera |
|---|---|---|
| 21 | `GET` do card | HTTP 200 e JSON |
| 22 | card | em `supportedInterfaces`, `protocolBinding` começa com `JSONRPC`, há `url`, e `protocolVersion` começa com `1.0` |
| 23 | card | skill `reservar-sala` |
| 24 | reservar porao 09-10 Doc, com `traceparent` | `TASK_STATE_COMPLETED` |
| 25 | artifact | `artifacts[0].name == "reserva"`, JSON com `politica` `2026-11-01` e `sala` `sala-porao` |
| 26 | `GetTask {id}` | mesmo `id`, `contextId`, estado COMPLETED |
| 27 | reservar garagem 14-15 Marty, com `traceparent` | `TASK_STATE_INPUT_REQUIRED` |
| 28 | mesma resposta do 27 | `status.message` contém `alternativas: sala-fusca, sala-mirante` |
| 29 | `escolha=sala-aquario`, sem `traceparent` | continua INPUT_REQUIRED |
| 30 | `escolha=sala-fusca`, com `traceparent` | COMPLETED e artifact com `sala-fusca` |
| 31 | `escolha=sala-mirante` na Task já concluída | resposta com `error` |
| 32 | garagem 14:30-15:30 Biff, depois `escolha=recusar` | `TASK_STATE_CANCELED` |
| 33 | fusca 16-17 Lorraine e garagem 14-15 George pausadas; as duas com `escolha=sala-mirante` | ambas COMPLETED, com reservas e inícios diferentes |
| 34 | varredura das respostas A2A | nenhuma contém o `requestState` |
| 35 | reservar `sala-delorean` | FAILED e `status.message` contém `Sala inexistente: sala-delorean` |
| 36 | porao 09-10 Doc duas vezes (conflito) | as duas `status.message` iguais e começando com `alternativas:` |

O validador **não** cobra, mas o avaliador confere à mão: o `requestState` continuar válido depois de reiniciar o servidor MCP, e o `traceparent` aparecer no stderr do servidor MCP (o trace-id é impresso na primeira linha do validador).

## Fluxo do avaliador (conferir à mão antes do push)

1. Clonar o fork em uma pasta limpa e seguir só o README.
2. Subir o servidor MCP e o agente, cada um em um terminal, com o stderr do MCP visível.
3. `curl http://localhost:7300/.well-known/agent-card.json` e comparar com `exemplos/wire/07-a2a-agent-card.json` (interface JSON-RPC, versão de protocolo, skill `reservar-sala`).
4. Rodar o validador: todas as verificações passam.
5. No stderr do MCP: um `tools/list` antes do primeiro `tools/call`, e o `traceparent` com o trace-id impresso pelo validador.
6. No stderr do MCP: o par de `tools/call` de uma reserva que pausou, com o id do retry diferente do id inicial.
7. `curl` com o corpo de `exemplos/wire/08-a2a-send-message.json` (garagem 14-15 de 03/11/2026): a Task fica em INPUT_REQUIRED com `alternativas: sala-fusca, sala-mirante`.
8. Continuar com `escolha=sala-mirante` e, por `GetTask`, ver COMPLETED com o artifact `reserva` em `sala-mirante` e com `politica`.
9. Repetir o passo 7 e responder `escolha=recusar`: TASK_STATE_CANCELED.
10. `SendMessage` com `sala=sala-inexistente`: FAILED com `Sala inexistente: sala-inexistente` no histórico.
11. Com o corpo de `exemplos/wire/03-tools-call-conflito-input-required.json`, pegar o `requestState` direto do MCP, trocar um caractere e reenviar: `-32602`.
12. Repetir o passo 11 sem alterar o estado, mas reiniciando o servidor MCP antes do retry: a reserva é concluída.
13. Repetir o `tools/call` de conflito sem `elicitation` nas capabilities: `-32021` com HTTP 400.

Atenção: o validador ocupa sala-fusca e sala-mirante das 14 às 15. Depois de conferir os passos 5 e 6 no log, reiniciar os dois processos antes do passo 7. Sem o restart, os passos 7 e 9 dão FAILED com `Sem alternativas disponiveis no intervalo`, o passo 8 fica sem Task pausada para continuar, e os passos 11 e 12 recebem `isError` sem `requestState` para usar. O passo 13 funciona, porque o passo 12 reinicia o servidor MCP.

## Fora de escopo (não implementar)

- Autenticação e autorização em qualquer camada (sem OAuth, sem token, sem `securitySchemes` preenchido de verdade).
- Streaming: nada de `SendStreamingMessage`, SSE ou push notification.
- Refinamento de Task, `referenceTaskIds` e continuidade entre Tasks diferentes.
- Card estendido autenticado e assinatura JWS do card.
- Prompts do MCP, subscriptions e progress.
- Container, compose, deploy e gateway.
- Spans e atributos de OpenTelemetry. Só se exige propagar o `traceparent` e registrá-lo em log.
- Concorrência de escrita, transação e corrida entre reservas no mesmo milissegundo.
- Persistência das reservas em disco.
- Interface gráfica de qualquer tipo.
- ORM, banco e camada de serviços: o domínio é deliberadamente simples.

## Ordem de execução sugerida

1. Ler `exemplos/wire/` inteiro antes de escrever qualquer linha.
2. Subir o servidor MCP só com `listar_salas` e conferir no MCP Inspector o `_meta` de cada request e o `resultType` da resposta.
3. Implementar `consultar_disponibilidade` e as regras da política, com os quatro erros de execução e as mensagens exatas.
4. Implementar `reservar_sala` só no caminho feliz, sem MRTR.
5. Adicionar o MRTR: primeiro o `input_required` com a elicitation, depois o `requestState` protegido, por último a checagem de capability e as rejeições.
6. Construir o agente como cliente MCP puro, sem A2A: um script que descobre as tools, lê o resource e completa o ciclo de MRTR respondendo à elicitation na mão.
7. Colocar o A2A por fora: card, `SendMessage`, `GetTask` e a máquina de estados da Task.
8. Costurar a ponte: pausa da Task, guarda do `requestState`, retomada com id novo.
9. Rodar o validador, corrigir e repetir.
10. Do zero: matar os dois processos, clonar o próprio fork numa pasta limpa, seguir só o README e percorrer os critérios de aceite item por item antes do push final.

## Critérios de aceite (todos obrigatórios)

- **Servidor MCP:** sobe na 7301 em Streamable HTTP com as três tools; todo `inputSchema` é objeto JSON Schema válido; `listar_salas` traz `structuredContent` conforme o `outputSchema` e o mesmo JSON em texto; `_meta` incompleto dá `-32602` com HTTP 400; tool inexistente é recusada; `politica://uso` devolve a política e URI inexistente dá `-32602`; os quatro erros de validação vêm com a mensagem exata; o stderr registra método, id e `traceparent` de cada request.
- **MRTR:** conflito dá `input_required` com uma entrada em form mode e `requestState`; o `requestedSchema` é plano e traz as alternativas na ordem certa; sem capability, `-32021` com `data.requiredCapabilities` e HTTP 400; o retry conclui com `complete`; estado adulterado dá `-32602`; argumentos adulterados no retry não tomam efeito; o retry funciona depois do restart do servidor; a chave vem de `REQUEST_STATE_SECRET`, com 32 bytes ou mais e sem segredo no código; `decline` conclui sem reservar e sem `isError`.
- **Agente como host MCP:** `tools/list` aparece antes do primeiro `tools/call`; o `traceparent` leva o trace-id do validador até o log do MCP; os requests declaram elicitation em form mode.
- **Agente como servidor A2A:** card v1.0 válido com HTTP 200; interface JSON-RPC com URL e versão `1.0`, e skill `reservar-sala`; sala livre dá COMPLETED com o artifact `reserva`; o artifact traz a reserva e a `politica` lida do resource; `GetTask` devolve `id`, `contextId`, o estado e o artifact; Task terminal recusa `SendMessage`; sala inexistente dá FAILED com a mensagem exata.
- **A ponte:** sala ocupada dá INPUT_REQUIRED com a linha `alternativas: ` na ordem do `enum`; `escolha=<id>` conclui na sala escolhida; `escolha=recusar` dá CANCELED; escolha fora do `enum` mantém INPUT_REQUIRED; duas Tasks pausadas concluem cada uma com a sua reserva; o `requestState` não aparece em nenhuma resposta A2A.
- **Validação e entrega:** o validador passa nas 36 verificações com os processos recém-iniciados e sai com código 0; `dados/`, `validador/` e `exemplos/` intactos; o agente é determinístico e não há SDK de LLM nas dependências; o README tem as quatro seções e os comandos funcionam a partir de um clone limpo.

## Como trabalhar neste repositório

- Antes de dizer que algo está pronto: subir os dois processos do zero, rodar o validador, conferir o código de saída 0 e ler o stderr do servidor MCP. É o principal instrumento de depuração (tools/list ausente, `_meta` sem capability, `traceparent` esquecido, id do retry repetido).
- Nunca versionar o `REQUEST_STATE_SECRET` nem um `.env`. Para os testes, gerar uma chave e exportá-la no shell, usando **a mesma chave** em todos os restarts.
- A máquina de desenvolvimento é Windows: aqui o validador pode precisar de `python` em vez de `python3`. O README da entrega é para o avaliador e deve trazer os comandos de um clone limpo.
- Não presumir a API do SDK v2 de memória: conferir no código e nas docstrings do pacote instalado (`node_modules/@modelcontextprotocol/...`) antes de usar.
