# A Ponte: um agente A2A com MCP por dentro

Entrega do desafio do módulo Desenvolvimento de Agentes com IA. São dois processos Node.js:

- **`servidor-mcp/`**: servidor MCP em Streamable HTTP (`POST /mcp`, porta 7301, revisão `2026-07-28`). Expõe as tools `listar_salas`, `consultar_disponibilidade` e `reservar_sala` (com MRTR) e o resource `politica://uso`. Usa o SDK oficial `@modelcontextprotocol/server` 2.4.0.
- **`agente/`**: agente que é **host MCP por dentro**, com o SDK oficial `@modelcontextprotocol/client` 2.4.0, e **servidor A2A v1.0 por fora**, com JSON-RPC em `POST /a2a`, card em `/.well-known/agent-card.json` e porta 7300, usando o `@a2a-js/sdk` 1.3.0.

Os dois falam só por HTTP. O agente não importa código do servidor, não lê `dados/` e não usa LLM: ele interpreta os textos fixos do enunciado e traduz protocolo.

## Como rodar

Requisitos: Node.js 20 ou superior e Python 3.10 ou superior (só para o validador). As dependências estão travadas em versão exata no `package-lock.json`, e o `.npmrc` tem `engine-strict=true`: com um Node mais antigo, o `npm ci` já recusa com uma mensagem clara.

```bash
git clone https://github.com/dayvisonassis/desafio-a2a-com-mcp.git
cd desafio-a2a-com-mcp
npm ci
```

### Chave do `requestState`

O servidor MCP só sobe com `REQUEST_STATE_SECRET`: 32 bytes aleatórios, em hex (64 caracteres). Gere a sua chave. O valor usado nesta entrega não está no repositório.

```bash
# bash (Linux, macOS, Git Bash; no Git Bash, se python3 não existir, use python ou py -3)
export REQUEST_STATE_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
```

```powershell
# PowerShell
$env:REQUEST_STATE_SECRET = python -c "import secrets; print(secrets.token_hex(32))"
```

Exporte a chave **no terminal do servidor MCP** e mantenha o mesmo valor nos restarts. É ela que permite concluir, depois de reiniciar o processo, um retry iniciado antes do restart. O agente não precisa da chave.

Para reiniciar o servidor MCP, use Ctrl+C e rode de novo só `node servidor-mcp/src/index.js` **no mesmo terminal**. Não repita o `export`: ele gera outra chave, e um `requestState` emitido antes passa a ser recusado com `-32602`.

### Subir os dois processos

```bash
# terminal 1: servidor MCP (com REQUEST_STATE_SECRET exportada)
node servidor-mcp/src/index.js

# terminal 2: agente
node agente/src/index.js

# terminal 3: validador
python3 validador/validar.py --agente http://localhost:7300 --mcp http://localhost:7301
```

```powershell
# o mesmo no PowerShell (no Windows, python3 costuma ser só o atalho da Microsoft Store)
node servidor-mcp/src/index.js        # terminal 1, com $env:REQUEST_STATE_SECRET definida
node agente/src/index.js              # terminal 2
python validador/validar.py --agente http://localhost:7300 --mcp http://localhost:7301   # terminal 3 (ou py -3)
```

O servidor MCP registra no stderr uma linha por request: `method`, `id`, `name`, `cliente`, `traceparent` e `retry`.
- A primeira linha do stderr é um aviso do SDK sobre `responseMode: 'json'`. É esperado: as respostas saem sempre em JSON, e nenhuma tool emite notificação.
- Os requests do agente aparecem com `cliente=agente-central-de-salas`. Os corpos de `exemplos/wire/03` e `06`, usados nos passos 11 e 13, trazem o mesmo `clientInfo` e por isso também aparecem assim.
- Para os passos 5 e 6 do avaliador, procure o trace-id que o validador imprime na primeira linha. Um trecho típico, em que `<trace-id>` é o valor impresso pelo validador e foram omitidas as linhas dos ids 3 e 4 (o `tools/list` e o `resources/read` da Task que pausa):

```text
[mcp] ... method=tools/list id=0 name=- cliente=agente-central-de-salas traceparent=00-<trace-id>-2124e5d18e27756c-01 retry=nao
[mcp] ... method=resources/read id=1 name=politica://uso cliente=agente-central-de-salas traceparent=00-<trace-id>-2b8ed7e6c52c0e64-01 retry=nao
[mcp] ... method=tools/call id=2 name=reservar_sala cliente=agente-central-de-salas traceparent=00-<trace-id>-b696fbced9a2a089-01 retry=nao
[mcp] ... method=tools/call id=5 name=reservar_sala cliente=agente-central-de-salas traceparent=00-<trace-id>-970b7f37c5054324-01 retry=nao
[mcp] ... method=tools/call id=6 name=reservar_sala cliente=agente-central-de-salas traceparent=00-<trace-id>-a932bfce95754a62-01 retry=sim
```

Os ids 5 e 6 são a reserva que pausou: o tools/call inicial e o retry, com ids diferentes e o mesmo trace-id.

Para repetir o validador, reinicie os dois processos antes. Ele cria reservas, e as reservas ficam em memória.

### Tudo de uma vez

Esta é uma alternativa aos três terminais. Encerre antes os processos da seção anterior.

```bash
node scripts/validar.mjs
```

O script faz quatro coisas:
1. Sobe os dois processos do zero nas portas 7300 e 7301 (e aborta se estiverem ocupadas). Usa a `REQUEST_STATE_SECRET` do ambiente ou, se ela não existir, gera uma chave só para essa execução.
2. Roda o validador.
3. Confere no stderr do MCP os passos 5 e 6 do fluxo do avaliador: o `tools/list` antes do primeiro `tools/call` do agente, o trace-id do validador e o par `tools/call` mais retry com ids diferentes.
4. Grava `validador-saida.log`, `mcp-stderr.log` e `agente-stderr.log`.

Ele termina com código 0 somente se tudo passar.

Os testes automatizados (`node:test`, sem dependência extra) rodam com `npm test`.

Há também um cliente MCP manual, sem A2A, que descobre as tools, lê a política e completa o MRTR na mão contra o servidor em `MCP_URL`. É uma ferramenta de apoio, fora do caminho do avaliador: `node agente/scripts/cliente-manual.js sala-fusca` (ou `recusar`, ou sem argumento para só ver as alternativas).

### Variáveis de ambiente

| Variável | Processo | Padrão |
|---|---|---|
| `REQUEST_STATE_SECRET` | servidor MCP | obrigatória: hex com 32 bytes ou mais |
| `MCP_PORT` | servidor MCP | `7301` |
| `AGENTE_PORT` | agente | `7300` |
| `MCP_URL` | agente | `http://localhost:7301/mcp` |
| `AGENTE_URL_PUBLICA` | agente | `http://localhost:<porta>`: a base, **sem** `/a2a`, usada na URL do card |

### Passos manuais do fluxo do avaliador (7 a 13)

O validador ocupa a sala-fusca e a sala-mirante das 14h às 15h. Antes dos passos manuais, **reinicie os dois processos**. Sem isso, a garagem das 14h às 15h fica sem alternativa.

Os comandos abaixo são para **bash**: Linux, macOS, Git Bash ou WSL. No Windows PowerShell 5.1, `curl` é um alias de `Invoke-WebRequest` e não aceita essas opções. Eles usam o `node` para tirar o corpo dos arquivos de `exemplos/wire/` e para ler campos das respostas, sem precisar de `jq`.

```bash
A2A=http://localhost:7300/a2a
corpo() { node -e "process.stdout.write(JSON.stringify(require('./exemplos/wire/$1').request.body))"; }
idDaTask() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).result.task.id))"; }

# 3. card: igual a exemplos/wire/07-a2a-agent-card.json, exceto o host da url (localhost)
curl -s -w '\n' http://localhost:7300/.well-known/agent-card.json

# 7. sala-garagem 14h-15h: TASK_STATE_INPUT_REQUIRED com "alternativas: sala-fusca, sala-mirante"
RESP=$(corpo 08-a2a-send-message.json | curl -s $A2A -H 'Content-Type: application/json' --data-binary @-)
echo "$RESP"
TASK=$(echo "$RESP" | idDaTask)

# 8. continuação e GetTask: COMPLETED com o artifact reserva em sala-mirante e o campo politica
curl -s -w '\n' $A2A -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"SendMessage","params":{"message":{"messageId":"msg-2","role":"ROLE_USER","parts":[{"text":"escolha=sala-mirante"}],"taskId":"'$TASK'"}}}'
curl -s -w '\n' $A2A -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":3,"method":"GetTask","params":{"id":"'$TASK'"}}'

# 9. repete o passo 7 (nova Task) e recusa: TASK_STATE_CANCELED
#    (o passo 8 ocupou a sala-mirante, então esta pausa lista só "alternativas: sala-fusca")
RESP=$(corpo 08-a2a-send-message.json | curl -s $A2A -H 'Content-Type: application/json' --data-binary @-)
echo "$RESP"
TASK=$(echo "$RESP" | idDaTask)
curl -s -w '\n' $A2A -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":4,"method":"SendMessage","params":{"message":{"messageId":"msg-4","role":"ROLE_USER","parts":[{"text":"escolha=recusar"}],"taskId":"'$TASK'"}}}'

# 10. sala inexistente: TASK_STATE_FAILED com "Sala inexistente: sala-inexistente"
curl -s -w '\n' $A2A -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":5,"method":"SendMessage","params":{"message":{"messageId":"msg-5","role":"ROLE_USER","parts":[{"text":"reservar sala=sala-inexistente inicio=2026-11-03T14:00:00-03:00 fim=2026-11-03T15:00:00-03:00 responsavel=Marty"}]}}}'
```

Direto no servidor MCP, o transporte exige os headers espelhados do corpo (`MCP-Protocol-Version`, `Mcp-Method` e `Mcp-Name`). Sem eles, ou com valores diferentes do corpo, a resposta é `-32020`.

```bash
MCP=http://localhost:7301/mcp
H=(-H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: tools/call' -H 'Mcp-Name: reservar_sala')

# 11. conflito: a resposta traz a chave de inputRequests (escolha_de_sala) e o requestState
RESP=$(corpo 03-tools-call-conflito-input-required.json | curl -s "${H[@]}" $MCP --data-binary @-)
echo "$RESP"
ESTADO=$(echo "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).result.requestState))")

# retry com UM caractere trocado no requestState: -32602 "Invalid or expired requestState"
ADULTERADO="${ESTADO:0:20}$([ "${ESTADO:20:1}" = A ] && echo B || echo A)${ESTADO:21}"
curl -s -w '\n' "${H[@]}" $MCP -d '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"reservar_sala","arguments":{"sala":"sala-garagem","inicio":"2026-11-03T14:00:00-03:00","fim":"2026-11-03T15:00:00-03:00","responsavel":"Marty"},"inputResponses":{"escolha_de_sala":{"action":"accept","content":{"sala":"sala-fusca"}}},"requestState":"'$ADULTERADO'","_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{"elicitation":{"form":{}}}}}}'
```

**Agora reinicie o servidor MCP** no terminal 1: Ctrl+C e `node servidor-mcp/src/index.js` de novo, sem repetir o `export`, para manter a mesma chave. O restart é justamente o que o passo 12 testa. Depois rode o bloco abaixo **neste mesmo terminal**, onde `ESTADO`, `H`, `MCP` e `corpo` continuam definidos.

```bash
# 12. retry com o "$ESTADO" intacto, num processo novo do servidor MCP: reserva concluída
curl -s -w '\n' "${H[@]}" $MCP -d '{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"reservar_sala","arguments":{"sala":"sala-garagem","inicio":"2026-11-03T14:00:00-03:00","fim":"2026-11-03T15:00:00-03:00","responsavel":"Marty"},"inputResponses":{"escolha_de_sala":{"action":"accept","content":{"sala":"sala-fusca"}}},"requestState":"'$ESTADO'","_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{"elicitation":{"form":{}}}}}}'

# 13. o mesmo conflito sem a capability de elicitation: -32021 com HTTP 400
corpo 06-erro-32021-sem-elicitation.json | curl -s -w '\nHTTP %{http_code}\n' "${H[@]}" $MCP --data-binary @-
```

## Onde a ponte acontece

A ponte está em [`agente/src/ponte.js`](agente/src/ponte.js), na função `desfechoDe`. Quando o `tools/call` de `reservar_sala` volta com `resultType: "input_required"`, a função faz três coisas:
- lê a única elicitation do `inputRequests` (`lerPergunta`);
- guarda o `requestState`, a chave atribuída pelo servidor, as opções, os argumentos originais e o trace da Task num `Map` por `taskId`, fora do objeto Task, que é o que se serializa para o cliente A2A;
- devolve o desfecho `INPUT_REQUIRED` com o texto `alternativas: ...`.

Em seguida, em [`agente/src/a2a.js`](agente/src/a2a.js), o `execute` do executor (`criarExecutor`) passa esse desfecho para `publicarDesfecho`, que o publica como `TASK_STATE_INPUT_REQUIRED`, e o `SendMessage` bloqueante termina ali.

O `input_required` chega cru por três motivos, todos em [`agente/src/mcp-cliente.js`](agente/src/mcp-cliente.js):
- o `Client` é criado com `inputRequired: { autoFulfill: false }` (em `novoClient`);
- o `chamarTool` manda o `tools/call` com `allowInputRequired: true`;
- nenhum handler de elicitation é registrado.

O `requestState` volta para o servidor na função `continuar` do mesmo `ponte.js`. A continuação `escolha=<id>` ou `escolha=recusar` vira `inputResponses` com a mesma chave, e o agente repete o `tools/call` original: mesmo `name`, mesmos `arguments`, o `requestState` ecoado sem modificação e um id JSON-RPC novo, que o `Client` do SDK gera sozinho.

No servidor, o retry é atendido por `retomar`, em [`servidor-mcp/src/servidor.js`](servidor-mcp/src/servidor.js). O pedido é reconstruído do estado selado.

## Decisões técnicas

### Proteção do `requestState`
- **Codec:** o servidor usa o utilitário do próprio SDK, `createRequestStateCodec`, com HMAC-SHA256. A chave vem de `REQUEST_STATE_SECRET`, com no mínimo 32 bytes, e o servidor não sobe sem ela. O token tem a forma `v1.<payload>.<mac>` e é **assinado, não cifrado**.
- **Conteúdo:** o payload carrega tudo o que o retry precisa: a tool (`reservar_sala`), os argumentos originais, as alternativas oferecidas e a expiração. O servidor não guarda nada entre o `input_required` e o retry, e por isso o retry funciona depois de reiniciar o processo.
- **Retry:** os `arguments` reenviados pelo cliente são ignorados, e valem os valores selados. Uma escolha fora das alternativas seladas dá `isError`. Se a sala escolhida for ocupada entre as rodadas, o servidor pergunta de novo, com as alternativas recalculadas.
- **Codificação canônica:** o `verify` do SDK decodifica o MAC com `atob`, sem conferir se a entrada é base64url canônico:

  ```js
  // node_modules/@modelcontextprotocol/server/dist/index.mjs, linhas 1471-1473
  function base64UrlToBytes(s) {
  	const b64 = s.replaceAll("-", "+").replaceAll("_", "/");
  	const bin = atob(b64);
  ```

  O `atob` tolera espaço e quebra de linha, aceita `+`, `/` e `=` e ignora os bits de sobra do último caractere, então variantes adulteradas do mesmo MAC passavam. Medi isso: o codec puro aceitou 3 variantes do último caractere de um token. O wrapper em [`servidor-mcp/src/estado.js`](servidor-mcp/src/estado.js) exige base64url canônico em cada segmento antes de chamar o `verify`. Os testes trocam cada caractere do token e inserem espaço, `\n` e `=` em cada posição, e todas as variantes são rejeitadas.
- **Ligação à tool:** o mesmo `verify` confere que a tool selada é a do header `Mcp-Name`, que o SDK garante igual a `params.name`. Um estado de `reservar_sala` apresentado em outra tool é recusado. Qualquer falha nesse `verify` vira `-32602` "Invalid or expired requestState". Se a checagem ficasse dentro do handler da tool, a falha viraria `isError`.
- **Validade:** **20 minutos** (`TTL_SEGUNDOS` em `estado.js`), dentro da faixa de 5 a 30, com folga para um avaliador humano.
- **Limite:** como o servidor não guarda nada, não há controle de uso único. Um estado válido pode ser reapresentado até expirar.

### Estado das Tasks
- **Tasks:** ficam no `InMemoryTaskStore` do `@a2a-js/sdk`, no processo do agente.
- **Pendências do MRTR:** o `requestState` e a chave ficam num `Map` em `ponte.js`, separado das Tasks, para nunca aparecer em resposta A2A. A pendência é apagada quando a Task termina ou é cancelada.
- **Continuação:** só uma Task em `TASK_STATE_INPUT_REQUIRED` aceita continuação. Task terminal recebe `-32004` do próprio SDK, e uma Task em SUBMITTED ou WORKING também recebe `-32004`, pelo `HandlerDaPonte` em `a2a.js`.
- **Reservas:** ficam em memória no servidor MCP, numa agenda por processo, e não sobrevivem a um restart.

### Outras decisões, com a evidência do SDK
- **`_meta` sem os campos obrigatórios:** quando falta `io.modelcontextprotocol/protocolVersion` ou `io.modelcontextprotocol/clientCapabilities`, a borda HTTP ([`servidor-mcp/src/http.js`](servidor-mcp/src/http.js)) responde `-32602` com HTTP 400 em qualquer caso. O SDK já faz isso quando o header `MCP-Protocol-Version` vem. Sem header nenhum, ele trata o request como protocolo legado (`legacyStatelessFallback`, em `node_modules/@modelcontextprotocol/server/dist/index.mjs`) ou responde `-32022` com `legacy: 'reject'`.
- **Header `A2A-Version`:** o `@a2a-js/sdk` trata a falta do header como versão 0.3 (`ABSENT_HEADER_VERSION = "0.3"`, `node_modules/@a2a-js/sdk/dist/server/index.js`, linhas 224 e 253) e recusa com `-32009`, porque o card só declara 1.0. O validador não manda o header, então o `contextBuilder` em `a2a.js` trata a ausência como `1.0`. O header explícito continua valendo, e `0.3` explícito recebe `-32009`.
- **Forma do `GetTask`:** devolve a Task direto em `result`, que é a forma da spec v1.0 (`rpc GetTask(...) returns (Task)`) e do SDK JS. O wire 09, capturado com o SDK Python, embrulha em `result.task`. O validador aceita as duas formas (`validar.py:152`). O `SendMessage` devolve `result.task`.
- **Elicitation vazia:** `{"elicitation": {}}` conta como form mode no SDK (`isImpliedCapabilityMember`, em `node_modules/@modelcontextprotocol/server/dist/src-DdvbAHrR.mjs`), como a spec define por compatibilidade. O agente declara sempre `{"elicitation": {"form": {}}}`.
- **Respostas MCP:** saem sempre em `application/json` (`responseMode: 'json'`), nunca em SSE.
- **Prazos:**
  - o agente espera no máximo 8 s pela conexão MCP e 7 s por request. Se o servidor MCP falhar, a Task termina em FAILED: na hora, se a conexão for recusada; em 7 s, se ele aceitar e não responder; em até 8 s, se o agente nunca tiver conseguido conectar. Com ele lento mas vivo, o pior caso fica abaixo dos 30 s do validador;
  - falhas de transporte chegam ao cliente A2A como uma mensagem curta, sem a URL interna nem o corpo da resposta HTTP.
- **Datas:** a janela e a duração são comparadas como instantes no horário de São Paulo. `inicio` e `fim` voltam exatamente como as strings recebidas, e datas inexistentes, como 31/11, são recusadas como formato inválido.

### Limitação do SDK documentada
O `connect()` do `@modelcontextprotocol/client` manda uma sonda `server/discover`. O `_meta` dessa sonda é montado só com a versão, o `clientInfo` e as capabilities, e não há parâmetro para `traceparent`:

```js
// node_modules/@modelcontextprotocol/client/dist/public-CvV4ZHkX.mjs, linhas 2368-2380
/** Build the probe request: `server/discover` carrying the full per-request `_meta` envelope. */
function buildProbeRequest(id, protocolVersion, clientInfo, capabilities) {
	return {
		jsonrpc: "2.0",
		id,
		method: "server/discover",
		params: { _meta: codecForVersion(protocolVersion).outboundEnvelope({
			protocolVersion,
			clientInfo,
			clientCapabilities: capabilities
		}) }
	};
}
// linha 2444: window.exchange((id) => buildProbeRequest(id, requestedVersion, deps.clientInfo, deps.capabilities), timeoutMs)
```

Por isso a sonda sai sem `traceparent`. O `connect(transport, { prior })` pularia a sonda, mas exige um `DiscoverResult` obtido antes, que não existe na primeira conexão.

O agente conecta na subida, fora de qualquer Task, e assim todos os requests MCP de uma Task levam o `traceparent`. Se o servidor MCP estiver fora do ar na subida, a reconexão acontece dentro da primeira Task, e a sonda dessa reconexão sai sem `traceparent`.

## Saída do validador

Esta é a última execução, num clone limpo do commit `ea9a536`, seguindo os comandos da seção "Como rodar". Os dois processos foram recém-iniciados (Node v22.15.0, Python 3.14), e o código de saída foi 0. No stderr do servidor MCP, as linhas `cliente=agente-central-de-salas` com o trace-id `5df5a01365ae94a691affb6f5ca575fc` mostram o `tools/list` antes do primeiro `tools/call` e o par `tools/call` mais retry (`retry=sim`) com ids diferentes. O mesmo código também passou 36/36 num clone limpo do GitHub no WSL Ubuntu, com Node 20.19 (o mínimo exigido é o 20) e Python 3.10. Depois de `ea9a536`, só o README mudou.

```text
trace-id desta execucao: 5df5a01365ae94a691affb6f5ca575fc
procure esse valor no stderr do servidor MCP para conferir a propagacao do traceparent.

PASS 01 tools/list traz as tres tools
PASS 02 toda tool tem inputSchema de objeto
PASS 03 listar_salas devolve structuredContent e o mesmo JSON em texto
PASS 04 _meta sem protocolVersion devolve -32602 e HTTP 400
PASS 05 _meta sem clientCapabilities devolve -32602 e HTTP 400
PASS 06 tool inexistente e recusada, por -32602 ou por isError
PASS 07 resources/read de politica://uso devolve a politica
PASS 08 resources/read de URI inexistente devolve -32602
PASS 09 sala inexistente devolve isError com a mensagem exata
PASS 10 fora da janela devolve isError com a mensagem exata
PASS 11 duracao acima de 2h devolve isError com a mensagem exata
PASS 12 intervalo invertido devolve isError com a mensagem exata
PASS 13 conflito devolve input_required com inputRequests e requestState
PASS 14 a elicitation e form mode e oferece as alternativas na ordem certa
PASS 15 conflito sem a capability elicitation devolve -32021 e HTTP 400
PASS 16 retry com inputResponses e requestState conclui a reserva
PASS 17 requestState adulterado e rejeitado com -32602
PASS 18 argumentos adulterados no retry nao tomam efeito
PASS 19 recusa conclui sem reservar e sem isError
PASS 20 conflito sem alternativa possivel devolve isError com a mensagem exata

PASS 21 agent card responde 200 no well-known com JSON
PASS 22 o card declara a interface JSON-RPC com url e versao 1.0
PASS 23 o card declara a skill reservar-sala
PASS 24 SendMessage com sala livre conclui a Task
PASS 25 o artifact chama reserva e traz a versao da politica
PASS 26 GetTask devolve id, contextId e estado corrente
PASS 27 SendMessage com sala ocupada pausa a Task
PASS 28 a Task pausada lista as alternativas na ordem certa
PASS 29 escolha fora do enum mantem a Task pausada
PASS 30 a continuacao conclui a Task na sala escolhida
PASS 31 SendMessage em Task terminal e recusado
PASS 32 a recusa termina a Task em CANCELED
PASS 33 duas Tasks pausadas ao mesmo tempo concluem cada uma com a sua reserva
PASS 34 nenhuma resposta A2A carrega o requestState
PASS 35 sala inexistente termina a Task em FAILED com a mensagem da tool
PASS 36 o agente e deterministico: o mesmo pedido produz a mesma pausa

resumo: 36 passaram, 0 falharam, de 36 verificacoes
```
