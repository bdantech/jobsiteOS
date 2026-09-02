# Voz: o discador de IA (05C) — status quo e plano de encaixe

> **Status: plano, não documentação.** Nada do que está aqui existe em código ainda. Este
> documento levanta o que a plataforma **já tem** e onde exatamente o código de voz que
> está na outra máquina se encaixa. Quando o port acontecer, este arquivo vira a
> documentação do módulo, como os outros de `docs/`.

O ponto de partida não é uma folha em branco. O 05A (Comunicação) foi escrito **prevendo
este dia**: a ação `ligar` já existe no espaço de ações do agente, desligada por config; o
ledger já aceita `canal = 'ligacao'`; a supressão já tem escopo `telefone`. O trabalho não
é inventar um lugar para a voz — é ligar um cabo que já foi deixado com a ponta descascada.

---

## Sumário

1. [O que já existe e que a voz vai usar](#1-o-que-já-existe-e-que-a-voz-vai-usar)
2. [Os oito requisitos, ponto a ponto](#2-os-oito-requisitos-ponto-a-ponto)
3. [Modelo de dados proposto](#3-modelo-de-dados-proposto)
4. [Onde o código novo mora](#4-onde-o-código-novo-mora)
5. [A incompatibilidade estrutural: a chamada é longa](#5-a-incompatibilidade-estrutural-a-chamada-é-longa)
6. [O que NÃO pode ser duplicado](#6-o-que-não-pode-ser-duplicado)
7. [Conformidade: gravação, LGPD e identificação da IA](#7-conformidade-gravação-lgpd-e-identificação-da-ia)
8. [Plano de port em cinco fases](#8-plano-de-port-em-cinco-fases)
9. [O que eu preciso saber do código que vem](#9-o-que-eu-preciso-saber-do-código-que-vem)
10. [Riscos](#10-riscos)

---

## 1. O que já existe e que a voz vai usar

### 1.1 O ledger já tem lugar para ligação

`comunicacoes` é o **registro canônico de toque** de toda a plataforma. O CHECK do canal já
é `whatsapp | email | ligacao | reuniao | interno` — a ligação foi prevista desde a
migração original do 05A.

Hoje `canal = 'ligacao'` é escrito **só** pelo clique em `tel:` na ficha do fornecedor e no
app (`origem = 'app_toque'`, `provedor = 'app_link'`): registra que alguém discou, não o que
foi falado. Zero linhas em produção hoje — o ledger inteiro tem 1 comunicação.

**Consequência:** a ligação da IA não precisa de um "histórico paralelo". Ela escreve na
mesma tabela que o WhatsApp e o e-mail, e a aba "Mensagens" de qualquer card já vai
mostrá-la em ordem cronológica junto do resto, sem uma linha de código de tela.

### 1.2 A thread da ligação já tem dono: a conversa do telefone

`conversas` é chaveada por **(canal, identificador canônico)** e o CHECK aceita só
`whatsapp | email`. Isso **não** é um buraco — é a decisão já registrada em
`packages/core/src/comunicacao/schemas.ts`:

> `whatsapp` e `email` são canais de THREAD: existe um identificador por onde a pessoa
> responde. Os outros três são registros de contato sem caixa de entrada — **uma ligação
> entra na thread de WhatsApp daquele número**.

Isso é o que mantém o **cooldown compartilhado**. Ligar hoje para quem recebeu WhatsApp
ontem é a mesma pessoa sendo tocada duas vezes, e um canal `telefone` separado em
`conversas` fragmentaria essa contagem — dois toques em dois dias viraria "um por canal",
que é exatamente como se queima um contato achando que se está sendo educado.

**Decisão proposta: `conversas` não muda.** A ligação anexa à conversa `whatsapp` daquele
número, criada se não existir. `identificadorCanonico()` já normaliza
`+55 (11) 99999-8888`, `5511999998888` e `011999998888` no mesmo valor, no banco e no core.

### 1.3 O portão, que a voz **tem** de atravessar

`packages/core/src/comunicacao/portao.ts` é uma função pura e testada que devolve a
**primeira** recusa nesta ordem:

```
kill switch → supressão → base legal → teto da thread → teto da conta → cooldown → janela
```

Metade é checada na transação que enfileira (fato do banco), metade no worker (fato do
relógio e da conta). A ligação usa as duas metades **sem exceção**, e três peças já estão
prontas para ela:

| Peça | Estado hoje |
| --- | --- |
| `supressao.escopo = 'telefone'` | **Já existe no CHECK.** Nunca foi usada porque nada liga |
| `contatos.base_legal` | Já derivada da origem. Contato sem base legal não é abordado |
| Kill switch | `comunicacao_config.agente.kill_switch` — alcança tudo que é automático |

O que **falta** é uma janela própria: ligar às 19h55 é pior que mandar mensagem às 19h55, e
uma janela só para os dois canais obrigaria a apertar o WhatsApp para proteger a ligação.

### 1.4 A conta de WhatsApp é o molde pronto da conta de voz

`whatsapp_contas` já resolve, em produção, exatamente o problema que "mais de um número
ligando" apresenta:

| Coluna | Para quê |
| --- | --- |
| `token_secret_id` | Ponteiro para o **Vault**. O valor só sai por `app__segredo_vault` (service_role) |
| `webhook_secret_hash` | Segredo do webhook **por número**, guardado como digest (0152) |
| `tipo` | `relacionamento` / `ia` / `plantao` — o número da IA nunca é o de um humano |
| `mensagens_por_dia` + `warmup_iniciado_em` | Teto e rampa |
| `intervalo_min_seg` / `intervalo_max_seg` | Cadência aleatória, porque regularidade perfeita é assinatura de robô |
| `ativo` | Desligar um número sem apagar o histórico dele |

E o round-robin entre contas do mesmo tipo já existe em `escolherConta()`: escolhe a **menos
usada hoje**, medido pelo que de fato saiu (`comunicacoes`), não por um contador em memória
que zera a cada deploy.

### 1.5 O vínculo número ↔ vendedor de IA já existe

```
vendedores (id, nome, tipo, usuario_id, is_ia, whatsapp_conta_id, email_remetente, settings, ativo)
CHECK (usuario_id is not null or is_ia)
```

`vendedores.whatsapp_conta_id` é **literalmente** o precedente do que você pediu. A persona
de IA já tem um número de WhatsApp próprio e um remetente de e-mail próprio; falta
`voz_conta_id`.

> **Hoje existem 0 vendedores com `is_ia = true`.** A persona de IA está modelada e
> nenhuma foi criada. Criar a primeira é pré-requisito do 05C, não consequência dele.

### 1.6 O agente já sabe escolher "ligar" — e já registra quando escolheria

```ts
export const ACOES_AGENTE = [
  'responder_agora', 'agendar_toque', 'enviar_link_agendamento', 'mudar_estagio_funil',
  'marcar_sem_interesse', 'escalar_humano', 'pedir_enriquecimento_contato',
  'trocar_contato_da_conversa', 'ligar', 'aguardar',
] as const
```

`acaoDisponivel()` recusa `ligar` enquanto `comunicacao_config.agente.ligacao_habilitada`
for falso, e o executor em `apps/worker/src/jobs/agente/decidir.ts:468` loga e adia. **A
decisão fica gravada em `agente_decisoes` mesmo assim** — foi escrito assim de propósito,
para que o número de vezes em que ligar era o passo certo existisse antes de haver
discador.

Ligar a voz é, do lado do agente, **uma linha de config e um `case` que troca `adiar()` por
`enfileirarLigacao()`**.

### 1.7 O playbook versionado é o mecanismo de "prompt editável"

`agente_playbooks (id, nome, funil, objetivo, instrucoes, acoes_permitidas, templates_disponiveis, prazos, ativo, versao)`

Editar **cria uma versão**; a anterior fica inativa e as decisões que ela produziu continuam
apontando para ela. A razão está escrita no 05A e vale inteira para voz:

> Sobrescrever faria o painel de eficácia comparar resultados de instruções diferentes sob o
> mesmo nome — a forma mais silenciosa de aprender errado.

Isso é exatamente o que o requisito "ajustar o modelo com base no resultado" precisa.

### 1.8 Custo de IA: medido em três lugares, somado em nenhum

| Onde | O que mede |
| --- | --- |
| `agente_decisoes.modelo` + `.tokens` | Tokens por decisão do agente |
| `processo_custos` | Custo por processo no Jurídico |
| `radar_config` chave `custos` | **Preços unitários** editáveis na tela (protesto, etc.) |
| `analise-propria.ts`, `parecer.ts`, `briefing.ts` | Somam `usage` e gravam no próprio domínio |

**Não existe um ledger de custo de IA transversal.** Cada módulo mede o seu. Para voz isso
não serve: uma ligação queima token de LLM, minuto de telefonia e (dependendo da
arquitetura) STT/TTS separados — três preços com três unidades.

O padrão certo já está no Radar: **preço unitário em config editável**, custo consumido
gravado na linha do evento. Um preço em constante de código faz o painel mentir no dia em
que o fornecedor reajusta.

### 1.9 O motor de ritmo de campanhas serve à fila de ligações

`packages/core/src/campanhas/ritmo.ts` já resolve: dado um ritmo/dia e N contas com tetos
diferentes (uns em warmup), produz uma **lista de horários** — não uma intenção.
`repartirPorFolga()` usa maior resto proporcional à folga de cada conta, e a razão está
comentada lá: round-robin cego daria ao número novo a mesma carga do maduro e estouraria o
teto do novo primeiro.

Ligação tem uma variável a mais que mensagem — **concorrência** (quantas chamadas
simultâneas por número) — mas a repartição por folga é a mesma matemática.

### 1.10 Infra: worker, crons, storage

- **Worker** (`apps/worker`, Railway): Express + jobs assíncronos. `dispararX()` devolve 202
  e o id; single-flight **em memória** (`emExecucao: Map<TipoJob, string>`).
- **Crons**: agenda em `apps/web/vercel.json` (**36 hoje**), catálogo explicativo em
  `packages/core/src/crons/catalogo.ts`. A tela cruza os dois pelo `path` e mostra
  "NÃO AGENDADA" para catálogo sem agenda — que é a falha que ninguém percebe.
- **Storage**: 4 buckets, todos privados (`importacoes`, `analise-docs`, `report-anexos`,
  `juridico-comprovantes`). Nenhum de áudio.
- **Tool Registry** (`packages/core/src/registry/`): módulos declaram `tools` com
  `inputSchema` zod e `mutates`. O contexto da tool usa o client **do usuário**, com RLS —
  uma tool não alcança o que a pessoa não alcançaria à mão.

---

## 2. Os oito requisitos, ponto a ponto

### 2.1 Fila para sequenciar as ligações

**Não reusar `mensagens_outbox`.** O CHECK dela é `email | whatsapp`, e alargá-lo seria o
começo do erro: uma mensagem tem um estado (`pendente → enviada`), uma ligação tem seis
(`na_fila → discando → tocando → atendida → em_curso → encerrada`), mais rediscagem por
não-atendimento, caixa postal, horário preferencial e número máximo de tentativas. Forçar as
duas na mesma tabela faz o job de envio crescer condicionais até ninguém conseguir ler o
portão.

**Tabela própria `ligacoes`**, que é fila **e** registro **e** resultado — o mesmo desenho de
`campanha_destinatarios`, que também é as três coisas.

O que a fila herda sem discussão:

- **Prioridade por `ORDER BY`, não por acordo entre processos.** A outbox já faz isso:
  `campanha_id NULLS FIRST` põe o envio individual à frente do disparo em massa. Ligação
  pedida por humano vem antes de ligação de campanha pelo mesmo mecanismo.
- **Fora da janela é adiamento, não descarte.** A linha continua na fila com
  `agendada_para` movido.
- **Teto é do dia: adia para a próxima abertura.**

### 2.2 Mais de um número ligando

`voz_contas`, irmã de `whatsapp_contas` (§3.2). A duplicação de estrutura é **deliberada** —
generalizar `whatsapp_contas` numa `contas_canal` obrigaria a mexer numa tabela viva, com
RLS, grants coluna a coluna (a lição da 0145) e três RPCs, para ganhar uma abstração que
esconde diferenças reais: um número de voz tem concorrência máxima, custo por minuto e
verificação de bina, e não tem nada disso um número de WhatsApp.

Duas coisas mudam de forma em relação ao WhatsApp:

- **Concorrência.** Mensagem é fire-and-forget; ligação ocupa o número por minutos.
  `concorrencia_max` por conta e um teto **global** (que é onde o custo estoura).
- **Escolha da conta.** O round-robin de `escolherConta()` (menos usada hoje) continua
  valendo, mas filtrado por quem **tem canal livre agora**.

### 2.3 Gravação e transcrição acessíveis na plataforma

Três artefatos, três lugares, e a divisão segue a regra do 05A ("quem precisa saber o que
foi falado **referencia** uma linha, nunca copia o texto"):

| Artefato | Onde | Por quê |
| --- | --- | --- |
| **O toque** (houve ligação, quando, com quem, resultado) | `comunicacoes`, `canal = 'ligacao'`, `corpo` = resumo | É o ledger. A thread do card já lê daqui |
| **O transcript** (turnos com timestamps) | `ligacoes.transcricao` jsonb | 10–40 KB por chamada. No `corpo` do ledger, tornaria pesada toda leitura de thread |
| **O áudio** | Bucket privado `ligacoes-audio`, ponteiro em `ligacoes.audio_path` | Nunca no banco |

`ligacoes.comunicacao_id` aponta para a linha do ledger — **exatamente** como
`mensagens_outbox.comunicacao_id` e `pedidos_apresentacao.comunicacao_id`. E vale o mesmo
CHECK que impede a duplicação de virar histórico paralelo.

**Retenção:** o áudio é o artefato mais sensível e o mais caro de guardar. Proposta: apagar
o áudio depois de N dias (config, padrão 90) e **manter o transcript**. Quem precisa
auditar uma ligação de um ano atrás precisa do que foi dito, não da voz.

### 2.4 Números ligados aos vendedores de IA

`vendedores.voz_conta_id`, espelhando `whatsapp_conta_id`. Uma persona de IA passa a ter:

```
nome · is_ia · whatsapp_conta_id · email_remetente · voz_conta_id
```

O vínculo é o que faz `comunicacoes.vendedor_id` e a atribuição de comissão funcionarem sem
caso especial — `comissoes-v2.ts` já trata `is_ia` explicitamente, e uma reunião agendada por
ligação de IA cai na mesma regra de uma agendada por WhatsApp de IA.

### 2.5 O agente enfileira ligação como ferramenta

Duas superfícies, e as duas já existem:

1. **O agente autônomo** — `case 'ligar'` em `decidir.ts` troca `adiar()` por
   `enfileirarLigacao()`, e `agente.ligacao_habilitada` vira `true`. O playbook precisa ter
   `ligar` em `acoes_permitidas`, senão `validarDecisao()` recusa — que é o comportamento
   certo: ligar num playbook de cobrança de documentação não é o mesmo que ligar num de
   prospecção.
2. **A barra de IA / o assistente** — duas tools novas no registry do módulo Comunicação:

   | Tool | `mutates` | O que faz |
   | --- | --- | --- |
   | `comunicacao.agendar_ligacao` | `true` | Enfileira. Passa pelo portão e devolve o **motivo** se recusar |
   | `comunicacao.transcricao_ligacao` | `false` | Devolve o transcript e a análise de uma ligação |

   `mutates: true` obriga confirmação explícita antes de executar — a mesma trava que
   `comunicacao.enviar_mensagem` tem hoje.

**O agente nunca liga; ele enfileira.** Um caminho de discagem direta "porque o agente
decidiu" seria o quinto lugar onde a supressão precisa ser lembrada.

### 2.6 Custo: tokens e minutos

Três unidades diferentes na mesma chamada. O desenho:

- **Consumo na linha da ligação**: `tokens_entrada`, `tokens_saida`, `segundos_audio`,
  `segundos_faturaveis` (a telefonia costuma faturar por bloco mínimo, e ignorar isso
  subestima o custo em toda chamada curta).
- **Preços unitários em `voz_config`**, editáveis na tela — padrão do `radar_config.custos`.
  Preço em constante de código é o painel mentindo no dia do reajuste.
- **Custo calculado, não gravado bruto**: uma view `voz_custos` multiplica consumo por preço
  vigente. Gravar o custo em reais na linha congela o preço do dia e impede recalcular
  quando se descobre que a tabela estava errada.
- **Teto de gasto com kill switch próprio**, ligado ao `orcamento.estourado` que o plantão
  já sabe alertar. Ligação é o primeiro canal em que um bug custa dinheiro por segundo.

### 2.7 Medir como foi a chamada, e o horário, e o resultado

Reusar o desenho da **triagem** (`packages/core/src/comunicacao/triagem.ts`), que já resolve
este problema para texto e cuja régua vale igual: **qualidade acima de custo** — o
classificador barato resolve só o inequívoco, o resto vai ao modelo.

Um job pós-chamada lê o transcript e grava `ligacoes.analise` (jsonb) + `ligacoes.desfecho`:

```
atendeu · falou_com_o_decisor · objecao_principal · interesse (0-1)
agendou_reuniao · pediu_humano · pediu_para_nao_ligar · soube_que_era_ia
qualidade_audio · quem_desligou · momento_da_perda
```

Duas regras não-negociáveis, herdadas do 05A:

1. **Classificar não muda nada sozinho** — exceto opt-out, que vira linha em `supressao`
   com `escopo = 'telefone'` + aviso ao dono. Um falso opt-out é irreversível na prática;
   um token gasto não é.
2. **Pedido de humano, reclamação, ameaça jurídica ou "você é um robô?" escalam**, e o modo
   autônomo daquela thread cai para sugestão.

**O laço de ajuste** vive numa view `voz_eficacia`, cortada por: hora do dia · dia da semana ·
roteiro **e versão** · conta de origem · faixa/segmento. Sem a versão do roteiro no corte, o
painel compara resultados de instruções diferentes sob o mesmo nome.

E `agente_decisoes.desfecho` — apurado uma vez por dia — passa a receber o resultado das
decisões `ligar`, fechando o laço que hoje mede só WhatsApp e e-mail.

### 2.8 Editar regras de prompt "em tempo real"

Duas coisas diferentes se escondem nessa frase, e só a primeira é requisito:

**(a) Editar sem deploy.** É o que `agente_playbooks` já faz e o que `voz_roteiros` vai
fazer: o prompt vive no banco, a tela edita, **editar cria versão**, e cada `ligacoes` grava
`roteiro_id` + `roteiro_versao`. A próxima chamada usa o texto novo; as anteriores continuam
explicáveis. Isto é o que torna §2.7 possível.

**(b) Mudar o prompt de uma chamada em curso.** Depende inteiramente do provedor: numa API
de voz em tempo real isso é um `session.update` no meio do stream; num pipeline
STT→LLM→TTS é trivial (o próximo turno já usa o novo system). **Não sei qual dos dois o
código que vem usa** — está em §9. De todo modo (b) não deveria ser usado para experimentar
em produção: mudar as instruções no meio de uma ligação produz uma linha que não pertence a
nenhuma versão.

---

## 3. Modelo de dados proposto

Convenções obrigatórias da casa, para quem for escrever as migrações:

- Nenhuma tabela do módulo tem `insert`/`update`/`delete` para `authenticated`. **Escrita só
  por RPC** `SECURITY DEFINER` com `set search_path = ''`, ou service_role no worker.
- RLS por `(select public.app_tem_modulo('comunicacao'))` — o `select` embrulha para o
  InitPlan avaliar uma vez.
- Tabela de nome feminino usa `set_atualizada_em()`; masculino, `set_atualizado_em()`.
- CHECK constraints: **ler do banco vivo** antes de recriar. A lista da migração original
  quase nunca é o estado atual.
- **Grant de SELECT coluna a coluna não alcança colunas futuras** (a lição da 0145). Toda
  coluna nova em tabela com ponteiro de Vault precisa de `grant select (coluna)` explícito.

### 3.1 `voz_config`

Irmã de `comunicacao_config`. Chaves:

```jsonc
{
  "janela":   { "dias_semana": [1,2,3,4,5], "hora_inicio": 9, "hora_fim": 18, "timezone": "America/Sao_Paulo" },
  "discador": {
    "concorrencia_global_max": 4,
    "max_tentativas": 3,
    "espera_entre_tentativas_h": [4, 24, 72],
    "duracao_max_seg": 420,
    "habilitado": false          // kill switch próprio, além do do agente
  },
  "custos":   { "por_minuto_telefonia": 0.0, "por_1k_tokens_entrada": 0.0,
                "por_1k_tokens_saida": 0.0, "por_minuto_stt": 0.0, "por_1k_chars_tts": 0.0 },
  "gravacao": { "aviso_obrigatorio": true, "reter_audio_dias": 90 },
  "orcamento": { "teto_mensal_brl": 0.0 }
}
```

Como em `CONFIG_COMUNICACAO_PADRAO`, um padrão de fábrica **em código**: um worker que suba
antes do seed não pode decidir ligar de madrugada porque a janela veio `undefined`.

### 3.2 `voz_contas`

```
id · apelido · numero (E.164, CHECK ^[0-9]{10,15}$) · tipo ('ia' | 'relacionamento')
token_secret_id → Vault          -- fora do grant coluna a coluna
webhook_secret_hash              -- digest, nunca lido; só comparado
ligacoes_por_dia · warmup_iniciado_em · intervalo_min_seg · intervalo_max_seg
concorrencia_max · bina_verificada_em · ativo · criada_em · atualizada_em
```

Warmup em voz é ainda mais literal que em WhatsApp: número novo com volume alto é marcado
como spam pelas operadoras e passa a cair antes de tocar — e, ao contrário do WhatsApp, isso
não gera erro nenhum. A ligação simplesmente não completa.

### 3.3 `ligacoes` — fila, registro e resultado

```
id · conversa_id → conversas · empresa_id · contato_id · destinatario (canônico)
voz_conta_id → voz_contas · vendedor_id → vendedores · roteiro_id · roteiro_versao
origem ('agente' | 'compositor' | 'campanha' | 'manual') · campanha_id
funil · funil_card_id · objetivo · briefing jsonb        -- o contexto que o roteiro recebe

status ('na_fila'|'discando'|'em_curso'|'encerrada'|'nao_atendida'|'falhou'|'descartada')
agendada_para · iniciada_em · atendida_em · encerrada_em
tentativas · motivo_descarte · erro
id_externo (id da chamada no provedor)  · quem_desligou

duracao_seg · segundos_faturaveis · tokens_entrada · tokens_saida
audio_path · audio_expira_em · transcricao jsonb
analise jsonb · desfecho · analisada_em
comunicacao_id → comunicacoes            -- a linha do ledger

CHECK (comunicacao_id is null or transcricao is not null)   -- ligação no ledger tem transcript
UNIQUE (id_externo) where id_externo is not null            -- idempotência de webhook
```

`id_externo` único é o que torna o webhook do provedor idempotente. Provedor de telefonia
reenvia evento; sem chave única, uma ligação vira duas no painel de custo.

### 3.4 `voz_roteiros` — o prompt versionado

```
id · nome · funil · objetivo · ativo · versao
prompt_sistema · primeira_fala · voz_id · instrucoes_objecao jsonb
acoes_permitidas text[]           -- as tools que o modelo pode chamar DURANTE a chamada
transferir_para_humano boolean · duracao_max_seg · criado_em · atualizado_em
```

Mesma regra do playbook: **editar cria versão**. `ligacoes.roteiro_versao` é copiada, não
referenciada por FK à versão — a linha precisa sobreviver a alguém apagar um roteiro.

### 3.5 O que muda em tabelas existentes

| Tabela | Mudança |
| --- | --- |
| `vendedores` | `+ voz_conta_id uuid` |
| `comunicacoes` | `provedor` ganha o valor do provedor de voz no CHECK; `origem` ganha `'ligacao'` se a ligação puder nascer fora do agente |
| `comunicacao_config` | `agente.ligacao_habilitada` → `true` (é config, não migração) |
| `agente_playbooks` | Nenhuma. `acoes_permitidas` já é `text[]` e já aceita `'ligar'` |
| Storage | Bucket privado `ligacoes-audio` |
| `EVENTO_TIPOS` | `ligacao.realizada`, `ligacao.nao_atendida`, `ligacao.escalou` |

---

## 4. Onde o código novo mora

O monorepo tem uma divisão que **não** admite exceção, e o código que vem precisa ser
fatiado por ela antes de entrar:

```
packages/core/src/voz/
  schemas.ts       vocabulário: status, desfechos, tipos de conta, config padrão
  portao.ts        as regras de ligação que faltam ao portão (janela própria, concorrência)
  ritmo.ts         repartição de ligações entre contas — reusa repartirPorFolga()
  roteiro.ts       montagem determinística do prompt a partir de roteiro + briefing
  analise.ts       schema zod da análise pós-chamada
  custo.ts         consumo × preço → custo. Puro e testado
  voz.test.ts

apps/voz/          ← SERVIÇO SEPARADO, ver §5
  src/provedor/    cliente do provedor de telefonia + do modelo de voz
  src/sessao/      o que segura a chamada: áudio, turnos, barge-in, tools em chamada
  src/discador/    consome a fila com `for update skip locked`

apps/worker/src/jobs/voz/
  enfileirar.ts    o que o agente chama
  analisar.ts      pós-chamada: transcript → análise (job, 5 min)
  metricas.ts      desfecho + rollup de custo (job, horário)
  retencao.ts      apaga áudio vencido (job, diário)

apps/web/src/components/voz/      fila, detalhe da ligação com player + transcript,
                                  roteiros (editor versionado), contas, painel de eficácia
apps/web/src/app/(app)/comunicacao/{ligacoes,roteiros,voz}/
```

**Regras que vão morder no port**, todas já custaram tempo neste repo:

- O worker roda os testes com `node --experimental-strip-types`, que **não implementa
  parameter properties** do TypeScript. `constructor(private readonly x: T)` explode com
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Campo declarado e atribuído à mão.
- Import do core no worker é caminho relativo com `.js`:
  `../../../../packages/core/src/voz/index.js`. Há um `scripts/checar-imports.mjs` que
  reprova o contrário.
- **`packages/core` não importa nada de `apps/`.** Se o código de voz tem lógica pura
  misturada com o cliente HTTP, a lógica sobe para o core e o cliente fica no serviço.
- A web **nunca** faz `.insert()` direto. Toda escrita é server action → RPC.
- Migrações **via Supabase MCP**, e o arquivo em `supabase/migrations/` com o mesmo
  conteúdo.
- Regenerar `database.ts` pelo MCP quebra a web (derruba `Views<>` e o `| null` de
  argumentos de RPC). Usar o CLI do projeto, ou repatchar.

---

## 5. A incompatibilidade estrutural: a chamada é longa

Este é o item que **não** se resolve copiando arquivos, e é o mais importante deste
documento.

Tudo no worker hoje é curto: um job dispara, roda, termina. O single-flight é um
`Map<TipoJob, string>` **em memória do processo**. Uma chamada de voz é o oposto: segura um
WebSocket bidirecional por minutos, com estado que não pode ser reconstruído.

Três consequências:

1. **Um deploy derruba as chamadas em curso.** O worker do Railway reinicia a cada push, e
   hoje isso é inofensivo. Com voz no mesmo processo, cada deploy corta ligações no meio —
   e do lado de lá isso é um cliente ouvindo a linha cair.
2. **O single-flight em memória para de funcionar com dois processos.** A fila de ligações
   precisa de trava **no banco**: `select ... for update skip locked` sobre `ligacoes`. É a
   diferença entre "duas instâncias dividem a fila" e "duas instâncias ligam para a mesma
   pessoa ao mesmo tempo".
3. **O perfil de recurso é outro.** Áudio em tempo real é CPU e rede sustentadas; os jobs
   atuais são rajadas de IO.

**Recomendação: `apps/voz` como serviço separado no Railway**, compartilhando
`packages/core`. O worker continua dono da fila, da análise e das métricas (jobs curtos); o
serviço de voz só **consome** a fila e conduz chamadas. O deploy de um não derruba o outro.

O custo dessa escolha é um serviço a mais para operar e um segredo a mais para distribuir.
O custo de não fazê-la é ligação caindo a cada deploy, que é o tipo de defeito que ninguém
reporta porque parece problema de rede do cliente.

---

## 6. O que NÃO pode ser duplicado

Todo item aqui é uma regra que já vive num lugar e que a voz vai ser tentada a reimplementar.
A tentação é sempre a mesma: o código que vem de fora **já tem** a versão dele.

| Não reimplementar | Onde já vive | O que acontece se duplicar |
| --- | --- | --- |
| Portão (supressão, base legal, cooldown, janela) | `core/comunicacao/portao.ts` | Quinto lugar onde a supressão precisa ser lembrada. Quem opta por sair do WhatsApp recebe ligação |
| Canonicalização de telefone | `identificadorCanonico()` — em SQL **e** em TS, testada nas duas | Duas threads para a mesma pessoa e cooldown cego |
| Ledger | `comunicacoes` + `escreverNoLedger()` | O histórico do card deixa de contar ligação |
| Fila de conversa / thread | `conversas` | Cooldown por canal em vez de por pessoa |
| Segredos | Vault + `app__segredo_vault` (service_role) | Credencial que gasta dinheiro num lugar legível |
| Round-robin entre contas | `escolherConta()` | Contador em memória que zera a cada deploy |
| Repartição por folga com warmup | `campanhas/ritmo.ts` | Número novo estoura o teto primeiro |
| Escalação por intenção | `triagem.ts` / `precisaEscalar()` | "Você é um robô?" sem escalar |
| Versionamento de instrução | `agente_playbooks.versao` | Comparar resultados de prompts diferentes sob o mesmo nome |
| Notificação ao dono | `avisarPlantao()` / `empresa_eventos` | Um segundo sino |

E a regra maior, do 05A: **nada sai sem passar pelo portão — humano ou IA, compositor,
outbox, agente ou campanha.** Um discador que ligue por fora dele não é uma otimização, é
uma porta.

---

## 7. Conformidade: gravação, LGPD e identificação da IA

Três exigências que precisam ser **estruturais**, não itens de roteiro que alguém possa
apagar editando o prompt. O precedente já existe: o link de descadastro é anexado **no
worker, no último instante antes do envio**, e não no template — porque "um template novo
escrito com pressa não pode ser a diferença entre uma mensagem conforme e uma que não é".

1. **Aviso de gravação.** Concatenado pelo serviço de voz à `primeira_fala`, sempre, com
   `voz_config.gravacao.aviso_obrigatorio`. Não é campo editável do roteiro.
2. **Identificação como IA.** O agente de texto já carrega `persona de IA — assuma isso se
   perguntarem` e a triagem escala "você é um robô?". Em voz isso precisa ser mais forte: a
   pergunta tem de ser respondida na hora, pelo próprio modelo, sem depender de um job
   posterior. É instrução de sistema fixa, não de roteiro.
3. **Base legal e supressão.** Contato sem `base_legal` não é ligado. Opt-out dito na
   ligação vira `supressao` com `escopo = 'telefone'` **e** aviso ao dono — e vale para o
   número, não para a empresa.

**A verificar com jurídico, e eu não vou afirmar sem isso:**

- Listas de bloqueio de telemarketing aplicáveis (o "Não Perturbe" da ANATEL cobre
  telecomunicações; há cadastros estaduais de Procon com escopo mais amplo). Se algum
  alcançar prospecção B2B, ele precisa virar mais uma fonte de supressão importada, não uma
  regra de roteiro.
- Se o aviso de gravação basta ou se é preciso consentimento ativo ("aperte 1").
- Horário permitido para chamada comercial — provavelmente mais restrito que a janela de
  mensagem que já usamos.
- Retenção de áudio e transcript, e por quanto tempo o titular pode pedir cópia.

Enquanto isso não estiver respondido, o discador roda com `voz_config.discador.habilitado =
false` e a fila acumula — que é o comportamento certo: uma fila parada é visível, uma
ligação indevida não se desfaz.

---

## 8. Plano de port em cinco fases

Cada fase entrega algo verificável. Nenhuma delas termina com "e aí liga tudo".

### Fase 0 — Ler o código que vem (nada de escrever)

Responder §9. Sem saber provedor e arquitetura de áudio, qualquer schema que eu escreva vai
ter uma coluna a mais e uma a menos.

### Fase 1 — Fundação sem discar

Migração com `voz_config`, `voz_contas`, `voz_roteiros`, `ligacoes`,
`vendedores.voz_conta_id`, bucket `ligacoes-audio`, RPCs de escrita, RLS. Telas de contas e
roteiros. Core: `voz/schemas.ts`, `custo.ts`, `portao.ts` com testes.

**Verificável:** dá para cadastrar um número, escrever um roteiro, versioná-lo, e enfileirar
uma ligação que fica parada porque o discador está desligado.

### Fase 2 — O serviço de voz, com uma conta e um número

`apps/voz` sobe, consome a fila com `for update skip locked`, conduz **uma** chamada por vez
para um número interno de teste. Webhook do provedor grava `id_externo`, duração, áudio e
transcript. A ligação aparece na thread do card.

**Verificável:** uma ligação real, gravada, transcrita e visível na plataforma.

### Fase 3 — Análise e custo

Job pós-chamada com a análise estruturada. `voz_custos` e `voz_eficacia`. Painel por hora,
dia da semana, roteiro/versão e conta. Alerta de orçamento pelo plantão.

**Verificável:** dá para responder "ligar às 10h converte mais que às 16h?" e "quanto custou
a semana?".

### Fase 4 — O agente liga

`agente.ligacao_habilitada = true`, o `case 'ligar'` passa a enfileirar, as duas tools novas
no registry. **Só em modo `sugestao` primeiro** — a decisão de ligar aparece e um humano
aprova. O 05A já argumenta por quê: um agente que começa autônomo manda a primeira mensagem
antes de alguém ter lido uma única sugestão dele. Em voz o custo do erro é maior.

### Fase 5 — Volume

Segundo e terceiro números, warmup, `repartirPorFolga` aplicado a ligações, concorrência,
modo autônomo nas carteiras da persona de IA, ligação como passo de campanha.

---

## 9. O que eu preciso saber do código que vem

Ordenado por quanto muda o desenho:

**Arquitetura de áudio — muda tudo**

1. É **um modelo de voz fim-a-fim** (speech-to-speech, tipo Realtime API) ou um **pipeline
   STT → LLM → TTS**? Isso decide como se conta token, se dá para trocar prompt em curso, e
   quanta CPU o serviço precisa.
2. Qual provedor de **telefonia** (Twilio, Telnyx, Vonage, SIP próprio, Zenvia)? Decide o
   formato do webhook, a idempotência, quem grava o áudio e como o número é provisionado.
3. Quem **grava**: o provedor de telefonia, o de modelo, ou o nosso processo? Se é o
   provedor, o áudio nasce num bucket dele e precisamos copiar (e apagar de lá).

**Estado e fila**

4. O código já tem fila? Em quê (Redis, Postgres, memória)? Se tem, ela **sai** — a fila é a
   `ligacoes`.
5. Como ele guarda transcript hoje? Formato dos turnos (role, texto, timestamp, confiança)?
6. Ele suporta mais de uma chamada simultânea no mesmo processo? Qual o limite medido?

**Modelo e prompt**

7. O prompt está em arquivo, env ou banco? Quantos "níveis" tem (sistema, roteiro, objeções,
   contexto do lead)?
8. Ele já usa **tools durante a chamada** (consultar algo, agendar, transferir)? Quais?
9. Como termina uma chamada — por decisão do modelo, por timeout, por silêncio?

**Operacional**

10. Runtime e versão (Node? Python?), gerenciador de pacotes, e se há dependência nativa
    (áudio costuma ter).
11. Variáveis de ambiente e segredos que ele espera.
12. Tem testes? Contra o quê — gravações fixas, mock do provedor, chamada real?

**Uma pergunta de produto, não técnica**

13. A persona de IA de voz é **a mesma** dos vendedores de IA de WhatsApp (mesmo nome, mesma
    carteira, mesmo `vendedores.id`) ou é outra? Se é a mesma, o cliente que troca mensagem
    com "a Camila" e recebe ligação "da Camila" precisa ouvir a mesma voz e o mesmo tom — e
    isso é decisão de posicionamento antes de ser de schema.

---

## 10. Riscos

| Risco | Por que importa aqui | Mitigação |
| --- | --- | --- |
| **Custo por segundo** | É o primeiro canal em que um laço mal fechado gasta dinheiro sozinho. Um bug de rediscagem custa mais que qualquer bug de WhatsApp | Teto global de concorrência, `max_tentativas`, teto mensal com kill switch, alerta de plantão |
| **Deploy derruba chamada** | O worker reinicia a cada push | Serviço separado (§5) |
| **Fila duplicada com 2 processos** | O single-flight é em memória | `for update skip locked`, nunca `Map` |
| **Número marcado como spam** | Não gera erro: a chamada simplesmente não completa | Warmup, teto por número, monitorar taxa de atendimento por conta |
| **Bypass do portão** | O código de fora tem a própria noção de "pode ligar" | Portão no core, uma função só, testada. Discador não decide |
| **Transcript no `corpo` do ledger** | Toda leitura de thread ficaria pesada | Transcript em `ligacoes`, resumo no ledger |
| **Prompt sobrescrito sem versão** | O painel de eficácia passa a comparar coisas diferentes | Versionar como `agente_playbooks`; `ligacoes` pina a versão |
| **Conformidade decidida depois** | Ligação indevida não se desfaz | Discador nasce desligado; §7 respondido antes da fase 4 |
| **36 crons na Vercel** | Cada job novo entra nessa conta | Agrupar os jobs de voz; conferir o teto do plano antes |
| **`vendedores` de IA: zero hoje** | Todo o vínculo depende disso | Criar a persona na fase 1 |
