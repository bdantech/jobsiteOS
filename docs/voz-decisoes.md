# Voz (05C): as decisões, depois das três leituras

> **Status: resposta ao `voz-fase0.md` e ao `voz-encaixe.md`.** Fecha o que estava aberto e
> substitui as partes do `voz.md` que foram escritas sem acesso ao código. Referências `§N`
> apontam para o `voz.md` salvo quando dito o contrário.

Os dois documentos respondem a Fase 0 inteira e vão além dela — o `voz-encaixe.md` já vem
com o vazamento da sessão pré-aquecida fechado, `/health` e o container. A Fase 0 está
encerrada.

A §4 do `voz.md` está errada e sai: ela fatia código Python com regras de TypeScript. A §5
estava certa e agora é a única opção. **O serviço fica em Python, não compartilha código com
`packages/core`, e a fronteira de linguagem é a fronteira de serviço.**

O que segue é: o que eu aceito sem ressalva, as quatro perguntas de vocês respondidas, um
problema que nenhum dos três documentos viu, e o único ponto em que eu não concedo — bem
menor do que eu tinha proposto.

---

## Sumário

1. [Aceito sem ressalva](#1-aceito-sem-ressalva)
2. [As quatro perguntas, respondidas](#2-as-quatro-perguntas-respondidas)
3. [O problema que nenhum dos três documentos viu](#3-o-problema-que-nenhum-dos-três-documentos-viu)
4. [Onde eu não concedo — e o quanto menor ficou](#4-onde-eu-não-concedo--e-o-quanto-menor-ficou)
5. [O opt-out não existe nos 15 desfechos](#5-o-opt-out-não-existe-nos-15-desfechos)
6. [Sete lacunas nas costuras](#6-sete-lacunas-nas-costuras)
7. [O aviso de gravação: proposta concreta](#7-o-aviso-de-gravação-proposta-concreta)
8. [Correções ao `voz.md`](#8-correções-ao-vozmd)
9. [Plano revisado](#9-plano-revisado)
10. [O que eu preciso de vocês agora](#10-o-que-eu-preciso-de-vocês-agora)

---

## 1. Aceito sem ressalva

| O que vocês disseram | Aceito porque |
| --- | --- |
| Não reescrever em TypeScript | 290 testes com a ligação que originou cada regra no docstring. Isso não é lógica, é observação acumulada. Reescrever é redescobrir por ligação queimada |
| Não fatiar em `provedor/ sessao/ discador/` | A §4 modelou três coisas e as ~2.300 linhas de política de `tools.py` + `agent.py` não são nenhuma delas |
| Guardas de ferramenta são política, e política é código | Os três exemplos são decisivos. Uma regra que o agente ignorou em ligação real e só parou de ignorar quando virou guarda **não pode** voltar a ser texto editável |
| §2.6 fica com duas unidades de custo | Fim-a-fim, sem STT/TTS separados. `por_minuto_stt` e `por_1k_chars_tts` saem de `voz_config.custos` |
| §2.8(b) é trabalho novo, não capacidade herdada | `LLMMessagesAppendFrame` como no-op com o Realtime, com o handler stub logando `!!! NEED TO IMPLEMENT MESSAGES APPEND`, é o tipo de defeito que eu teria escrito como pronto no cronograma |
| O desfecho declarado vence o classificado | Ele é decidido com o estado da sessão na mão — quais ferramentas rodaram, o que foi confirmado. Isso não sobrevive inteiro no texto |
| `app/realtime.py` não atravessa | — |
| Latência é o produto | Consequência aceita e virou regra dura: **durante a chamada, só áudio e modelo no caminho crítico** |

As três armadilhas silenciosas (§6 de vocês) vão para a documentação do módulo. A do
sample rate — 8 kHz do Telnyx contra 24 kHz fixo do Realtime, voz três vezes acelerada e
nenhum erro em lugar nenhum — é exatamente a categoria de defeito que este repositório
documenta em comentário no ponto onde ele mora.

---

## 2. As quatro perguntas, respondidas

### 2.1 Confirmar a fronteira — **sim, com uma correção**

O serviço Python não chama `packages/core`. Mas ele também **não escreve direto em
`ligacoes`**. São duas RPCs, e a diferença importa:

```sql
-- Reivindica UMA linha e devolve o trabalho pronto. FOR UPDATE SKIP LOCKED,
-- transição de status e lease numa transação só.
voz_proxima_ligacao(p_instancia text, p_voz_conta_id uuid default null) returns jsonb

-- Recebe o payload do post_call.py INTEIRO, como jsonb, e desempacota do nosso lado.
voz_registrar_resultado(p jsonb) returns jsonb
```

Por que RPC e não escrita direta:

- **A reivindicação precisa ser atômica**: `SKIP LOCKED` + status + lease + `id_externo`
  numa transação. Em SQL avulso do lado de vocês, isso é fácil de escrever quase certo.
- **O resultado toca cinco tabelas**: `ligacoes`, `comunicacoes` (o ledger), `conversas`,
  `contatos` (o decisor descoberto) e `empresa_eventos`. É regra da casa que isso seja uma
  transação, e vocês não deveriam ter que conhecê-la.
- **A RPC desacopla o schema.** `voz_registrar_resultado` recebe o payload que vocês já
  produzem, **sem renomear nada**. Quando eu acrescentar uma coluna, eu mudo a RPC, não o
  Python. Esse é o ponto inteiro do seam.

`p_voz_conta_id` opcional é o que faz §2.2 funcionar: uma instância amarrada a um número
pede só o trabalho daquele número; sem o parâmetro, pega qualquer um.

**Conexão:** `psycopg` direto no Postgres, com um role dedicado que só pode executar essas
duas funções. Sem PostgREST, sem cliente Supabase no Python, sem `service_role` solto.

### 2.2 O formato da linha da fila

`voz_proxima_ligacao` devolve, num jsonb:

```jsonc
{
  "ligacao_id": "uuid",            // a chave de correlação. Volta intacta no resultado
  "telefone_e164": "+55...",
  "voz_conta": { "connection_id": "...", "from_number": "+55..." },
  "roteiro": { "id": "uuid", "versao": 3 },   // null enquanto §4 não existir
  "tentativa": 1,
  "oferta": { /* exatamente o payload de crm.registrar_oferta */ }
}
```

Duas notas:

- **`ligacao_id` é a chave de correlação, não `oferta_id`.** Vocês ecoam de volta sem tocar.
  Isso é o que amarra o resultado ao card de NF (`funil_card_id = access_key`), à conversa e
  ao vendedor — identificadores que não fazem sentido nenhum do lado de vocês e que não
  deveriam vazar para lá como campos separados.
- **A oferta vem NA linha da fila, não por `POST /ligar`.** Isso mata um round-trip HTTP e
  mata o estado intermediário "oferta registrada e ligação nunca feita".
  `crm.registrar_oferta` continua existindo como validador/normalizador interno de vocês —
  só passa a ser chamado com o dicionário da linha em vez de com o corpo de um POST. Se
  isso não couber na estrutura interna, me digam: é a única coisa que eu peço da costura 2
  além de trocar a origem do gatilho.

### 2.3 Para onde vai o resultado

Para `voz_registrar_resultado`, não para webhook. Um caminho só — dois lugares onde o
resultado pode aterrissar são dois lugares para reconciliar.

**Mas com uma exigência que nenhum dos dois documentos cobre: o resultado precisa ser
durável antes de ser empurrado.** A ligação já aconteceu; se o banco estiver fora do ar
naquele segundo, o payload não pode evaporar. O SQLite em `/app/dados` deixa de ser
"registro que some quando a plataforma virar dona disso" e passa a ser **outbox local**:
grava o payload, tenta empurrar, marca como entregue, e um laço drena o que ficou. Isso
inverte o papel dele de forma útil e resolve a única coisa que faltava para o SQLite ter
motivo de existir depois do port.

`voz_registrar_resultado` é idempotente por `ligacao_id` — reenviar o mesmo payload não
duplica nada.

### 2.4 O aviso de gravação

Seção 7. Resposta curta: vocês estão certos sobre a forma e eu mantenho a estrutura, e as
duas coisas cabem juntas.

---

## 3. O problema que nenhum dos três documentos viu

**A Ana vai falar em voz alta um número que a proposta escrita não vai confirmar.**

O payload de `crm.registrar_oferta` exige `valor_desconto`, `valor_iof` e `valor_liquido`,
e a costura 1 diz — com razão — que *"os valores vêm calculados de fora; o serviço de voz
não precifica nada"*. O problema é o **de fora**: hoje a plataforma não calcula isso.

O que existe é uma conta só, em `packages/core/src/antecipacao/economia.ts`:

```
receita_esperada = valor × (taxa_mensal / 100) × (dias / 30)
líquido_estimado = valor − receita_esperada
```

Sem termo de IOF, sem tarifa, sem retenção. E o comentário dela diz, literalmente, *"o
líquido é o número que eu falo em voz alta na ligação"* — a intenção já estava escrita, e o
número não serve para isso.

Confrontei contra **1.124 antecipações reais** sincronizadas da plataforma Onepay
(20/07 a 09/09/2026, 489 fornecedores, todas com breakdown completo):

| Bruto | Dias | Taxa a.m. | Nosso líquido estimado | Líquido REAL | Erro |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10.229,00 | 92 | 2,25% | 9.523,20 | 9.223,53 | **+299,67** |
| 15.000,00 | 93 | 2,25% | 13.953,75 | 13.641,90 | **+311,85** |
| 59.125,78 | 30 | 3,00% | 57.352,01 | 56.836,52 | **+515,49** |
| 105.620,00 | 31 | 3,00% | 102.345,78 | 101.639,13 | **+706,65** |

**O erro é sempre para mais.** A estimativa promete mais do que o cliente recebe, em todas
as linhas que conferi. Numa ligação gravada, dita por uma assistente que se identifica como
da OnePay, isso não é imprecisão — é a promessa que a proposta escrita vai desmentir dois
dias depois.

E há um segundo termo que a estimativa ignora inteiro: **`withhold_tax`**. Em 205 das 1.124
(18%) ele é diferente de zero, e não é IOF — é retenção de imposto da nota (construção:
INSS, ISS). Ele **reduz a base** antes do deságio: numa nota de R$ 37.485,80 com
R$ 6.582,46 retidos, o que se antecipa são R$ 30.903,34. O valor de face não é o valor
antecipável, e 18% não é caso de borda.

### O que fazer

**Curto prazo (bloqueia a Fase 2): a Ana não fala valor líquido.**

Isso é uma guarda de ferramenta — o mecanismo que vocês já provaram que funciona.
`simular_antecipacao` e `detalhar_recebiveis` recebem os campos de valor **ausentes** e o
prompt trabalha com o que sobrevive: taxa ao mês, prazo, e o custo por dia que
`comparar_custo` calcula. A oferta em reais chega por escrito, que é o passo que
`enviar_proposta` já existe para dar.

Isso não enfraquece a ligação tanto quanto parece: a defesa de preço de vocês é feita em
taxa e em custo/dia, não em líquido. E é melhor que a alternativa.

**Médio prazo: o motor de cotação, calibrado contra as 1.124.**

Temos bruto, retenção, base descontada, líquido, taxa e prazo de mais de mil casos reais.
A fórmula da plataforma é reconstruível e — mais importante — **verificável**: o critério de
aceite é reproduzir o `net_value` das 1.124 dentro de centavos. Enquanto não reproduzir,
o campo continua ausente no payload.

**Uma pergunta que é do produto, não da engenharia:** existe um endpoint da Onepay que
cote uma antecipação ainda não solicitada? Se existir, o motor não precisa ser
reconstruído — a oferta é pedida a quem vai honrá-la, que é estritamente melhor.

### E o filtro de elegibilidade, que é irmão disso

Nas colunas abertas do funil há **12.930 notas operáveis**. Em apenas **2.477 (19%)** o
sacado tem crédito `APPROVED`.

Nas outras 81%, a antecipação **pode não estar disponível** — e a taxa que a nota carrega
não é a do sacado, é o padrão da carteira. Ligar sobre elas é gastar minuto e reputação numa
conversa que não pode fechar, e ainda cotar uma taxa inventada.

**O primeiro filtro da fila não é faixa nem receita: é `sacado_credito_status = 'APPROVED'`
e limite disponível que cubra a nota.** Isso derruba o universo discável de 12.930 para
~2.500, e é a coisa mais barata que vocês vão ganhar deste documento.

---

## 4. Onde eu não concedo — e o quanto menor ficou

Vocês provaram que **o prompt não é onde a política é aplicada**. Aceito. Mas isso não é o
mesmo que provar que o prompt deve morar numa constante Python — são duas afirmações
diferentes, e a segunda tem um custo que a §2.7 não sobrevive.

Se as 26k de `INSTRUCOES_BASE` vivem em código e não são registradas em lugar nenhum,
**a versão do prompt que rodou cada ligação não existe como dado**. Daqui a dois meses, com
mil ligações no banco, ninguém consegue responder "a abertura que menciona o sacado
primeiro converte mais que a anterior?" — porque não há como separar as ligações de antes
das de depois. Todo o laço de ajuste da §2.7 depende disso, e é a razão pela qual
`agente_playbooks` é versionado do lado de cá.

### O que eu peço agora: um pino de versão, não um editor

Mínimo viável, e é pequeno do lado de vocês:

```jsonc
"roteiro": {
  "prompt_hash": "sha256:8f3a…",      // hash do prompt montado (base + níveis carregados)
  "guardas_versao": "2026.09.05",     // versão das guardas de ferramenta
  "modelo": "gpt-realtime-...",
  "voz": "marin",
  "reasoning_effort": "..."
}
```

No payload do `post_call.py`, gravado em `ligacoes`. **Nenhum editor, nenhuma tela, nenhuma
promessa de que editar muda comportamento.** Só o suficiente para que `voz_eficacia` corte
por versão em vez de misturar tudo. Dez linhas, e sem elas o painel da §2.7 nasce mentindo.

### O que fica para depois, e explicitamente separado

`voz_roteiros` não vira `prompt_sistema` inteiro no banco. Vira um conjunto pequeno de
**overrides de texto** que o serviço recebe na linha da fila e injeta nos pontos que já são
variáveis: a abertura, o enquadramento da oferta, os scripts de objeção. Nada mais.

E a tela diz, com essas palavras: **"isto muda o que ela diz, não o que ela pode fazer"** —
que é a frase de vocês, e é a que evita a decepção do "editei e não mudou nada".

Fase 4, não Fase 1. O pino de versão é Fase 2.

---

## 5. O opt-out não existe nos 15 desfechos

Os 15 cobrem bem o comercial. Nenhum deles é **"não me ligue mais"**.

```
antecipacao_solicitada  cadastro_iniciado    proposta_enviada    interesse_futuro
retorno_agendado        agendado_com_decisor quer_negociar       transferido_humano
recusa                  objecao_taxa         nao_tem_interesse   pessoa_errada
caixa_postal            nao_atendeu          indefinido
```

`recusa` e `nao_tem_interesse` são recusas **da oferta**. `higienizar_contato` é o próximo
passo de `pessoa_errada`, que é contato errado. Nenhum dos três é o pedido para não ser mais
contatado — e são coisas com consequências opostas: da recusa comercial se volta em três
meses; do opt-out não se volta nunca.

Do lado de cá isso vira uma linha em `supressao` com `escopo = 'telefone'`, e é
**irreversível na prática**. O 05A já argumenta o porquê: um falso opt-out queima um contato
para sempre; um opt-out perdido é uma reclamação, e potencialmente do titular ao ANPD.

**Isso não pode ser inferido de transcript por classificador.** Precisa ser declarado durante
a ligação, como os outros 15, por uma ferramenta:

```
registrar_nao_contatar(escopo: 'telefone' | 'qualquer_canal', literal: str)
```

`literal` é o trecho do que a pessoa disse — a evidência, que é o mesmo padrão de
`base_legal = 'indicacao'` do 05A. E um desfecho novo, `pediu_para_nao_contatar`.

É o único item deste documento que eu chamaria de bloqueante para ligar o discador em
produção. Tudo o mais suporta ser descoberto rodando.

### E o bônus que já está pronto

O campo `decisor` — *"quem decide e COMO chegar nele, descoberto na ligação"* — encaixa
exatamente no fluxo de indicação do 05A. `voz_registrar_resultado` cria o contato novo com
`base_legal = 'indicacao'` e a evidência, e marca o anterior como `contatos.nao_e_o_decisor`
— **nunca suprimido**, porque "fala com o Marcelo" diz que esta pessoa não decide, não que
ela não pode ser abordada. A coluna já existe e nunca foi usada. Agora vai ser.

---

## 6. Sete lacunas nas costuras

Nenhuma delas está em nenhum dos três documentos.

**6.1 Lease e recuperação de queda.** Se a instância morre com a ligação no ar, a linha fica
`em_curso` para sempre. `voz_proxima_ligacao` grava `reivindicada_em` + `reivindicada_por`; um
job varre leases vencidos (> `duracao_max_seg` + margem) e move para **`falhou`, não para
`na_fila`** — rediscar alguém que estava no meio de uma conversa é pior que não ligar.

**6.2 Drain no SIGTERM.** O serviço separado só resolve o problema da §5 se ele **drenar**:
ao receber SIGTERM, parar de reivindicar e deixar as chamadas em curso terminarem, com
janela de graça. Sem isso o serviço separado tem exatamente o defeito que ele foi criado para
evitar. Railway respeita a janela se ela for declarada.

**6.3 Quem sobe o áudio.** O `voz-encaixe.md` diz que subir para `ligacoes-audio` *"é
trabalho da plataforma"*. Não pode ser: o áudio está num volume do serviço de vocês, e a
plataforma não alcança volume de outro serviço. **O upload é do lado de vocês.** Para não
entregar chave de storage ampla, o worker expõe um endpoint autenticado pelo
`WORKER_SECRET` que devolve URL assinada de upload, escopada naquele `ligacao_id`. A retenção
(apagar áudio, manter transcript) continua nossa.

**6.4 Assinatura do webhook do Telnyx.** Vocês já sinalizaram que não existe. Só acrescento
que ela é Ed25519 (`telnyx-signature-ed25519` + `telnyx-timestamp`) contra chave pública
**da conta**, não do número — e por isso o `webhook_secret_hash` por número que eu propus em
§3.2 **sai de `voz_contas`**. É uma variável de ambiente só, e falha fechada. O webhook
continua chegando no serviço de vocês; roteá-lo pelo Next poria um salto de rede antes do
`call.answered`, que é o começo da mídia.

**6.5 Custo da tentativa que não atende.** A §2.6 mede minuto e token de ligação atendida.
Com fila, a maioria das tentativas **não** vai ser atendida, e cada uma custa: a discagem no
Telnyx e a sessão pré-aquecida com a OpenAI que é aberta e descartada. Precisa de linha
própria — `custo_por_tentativa_nao_atendida` —, senão o custo por reunião agendada sai
subestimado exatamente na proporção em que a operação escala.

**6.6 O limite de duração precisa ser desenhado, não só imposto.** `duracao_max_seg` não
existe e §2.8(b) não funciona, então não dá para pedir ao modelo que encerre. Cortar a linha
no meio de uma frase é péssimo. Uma pergunta para vocês: **é possível empurrar um frame de
áudio/TTS direto pelo Pipecat, sem passar pelo LLM?** Se for, o vigia toca uma despedida
canônica em T-30s e desliga. Se não for, fica o corte seco com `encerrada_por_tempo`, e o
limite nasce generoso.

**6.7 Concorrência: a pergunta certa não é quantas cabem.** É **quantas chamadas simultâneas
cabem numa instância antes de a latência sentida sair da faixa 655–900 ms.** Se a terceira
leva o p95 para 1,5 s, a resposta é duas — e isso muda o modelo de custo inteiro, porque
escala vira número de instâncias. Latência é o produto; um teste de carga que meça throughput
e não latência responde a pergunta errada. É o pré-requisito da Fase 5.

E uma observação de forma, não de engenharia: `RUIDO_DE_LINHA` é uma decisão de produto que
merece estar escrita como decisão. Com a identificação como IA na abertura ela é defensável;
o que não seria defensável é ela aparecer depois sem nunca ter sido decidida por alguém.

---

## 7. O aviso de gravação: proposta concreta

Vocês estão certos sobre a forma e eu mantenho a estrutura. As duas coisas cabem juntas, e a
prova está na própria abertura de vocês.

**A abertura já carrega uma divulgação obrigatória sem se quebrar:** *"Sou assistente virtual
da OnePay"* é a identificação como IA, e ela vive na cláusula 2, onde não custa os três
segundos. O aviso de gravação cabe no mesmo lugar, na mesma respiração:

> "Oi, boa tarde! Aqui é a Ana, parceira da **[sacado]**. Sou assistente virtual da OnePay —
> **e esta ligação é gravada**. A gente trabalha com antecipação de recebíveis pra
> construção. Tô te ligando pra falar da nota fiscal número **[dígito a dígito]**. Falo com a
> **[contato]**?"

Uma oração subordinada, sem frase nova, sem abertura fria em "esta ligação está sendo
gravada". Vocês calibraram isso contra ligações reais e eu não — tratem como sugestão de
posição, não de texto. O que eu peço é só que o aviso **não seja um prefixo**.

**O que eu mantenho como estrutura, e é diferente de concatenar:** ao montar a sessão, o
serviço **verifica** que a abertura contém o aviso e **recusa discar** se não contiver. É uma
asserção, não uma concatenação — a redação continua inteiramente de vocês, e a presença
deixa de depender de alguém não ter apagado. É o mesmo princípio do link de descadastro no
worker, aplicado sem estragar a frase.

A pergunta jurídica — o aviso basta, ou precisa de consentimento ativo? — continua aberta do
nosso lado, e é o que segura a Fase 4. O discador nasce com
`voz_config.discador.habilitado = false`.

---

## 8. Correções ao `voz.md`

| § | Correção |
| --- | --- |
| **§4** | **Sai inteira.** Serviço Python, sem código compartilhado com o core. `custo.ts`, `analise.ts`, `schemas.ts` continuam em TS, mas são do **worker**, lendo o que o Python escreveu |
| **§5** | Confirmada, e agora obrigatória. Acrescenta drain no SIGTERM (6.2) |
| **§2.3** | Áudio nasce do lado de vocês; **upload é de vocês**, com URL assinada (6.3) |
| **§2.6** | Duas unidades, não cinco. Mais a linha de tentativa não atendida (6.5) |
| **§2.7** | A análise por LLM **complementa** o desfecho declarado: qualidade de áudio, momento da perda, quem desligou, objeção real por trás da declarada. Nunca recalcula o desfecho |
| **§2.8(b)** | **Removido do escopo**, não adiado |
| **§3.2** | `webhook_secret_hash` **sai** de `voz_contas` (6.4). Entram `connection_id` e `from_number` |
| **§3.3** | Nasce do payload do `post_call.py`, não ao lado dele. Acrescenta lease (6.1) e o bloco `roteiro` (§4) |
| **§3.4** | `voz_roteiros` encolhe para overrides de texto, e sai da Fase 1 |
| **§7.1** | Aviso desenhado dentro da abertura, verificado por asserção (§7) |
| **§2.7 / fila** | Filtro de elegibilidade por crédito do sacado (§3) — não estava em lugar nenhum |
| **Fase 0** | Encerrada |

---

## 9. Plano revisado

**Fase 1 — Fundação (nosso lado, sem tocar no serviço de voz).**
Migração: `voz_config`, `voz_contas`, `ligacoes` com lease, `vendedores.voz_conta_id`,
bucket `ligacoes-audio`, as duas RPCs, RLS. Persona `Ana` criada como `vendedores` com
`is_ia = true`. Filtro de elegibilidade por crédito. Endpoint de URL assinada.
*Verificável:* enfileirar uma ligação que fica parada porque o discador está desligado.

**Fase 2 — A costura (do lado de vocês).**
Trocar `POST /ligar` por `voz_proxima_ligacao`. Outbox no SQLite +
`voz_registrar_resultado`. Upload do áudio. Bloco `roteiro` no payload. Assinatura do
Telnyx. Guarda de valor líquido ausente. Drain no SIGTERM.
*Verificável:* uma ligação real, enfileirada pela plataforma, gravada, transcrita e visível
na thread do card de NF.

**Fase 3 — Medir.**
`voz_custos`, `voz_eficacia` cortada por hora, dia, versão de prompt e conta. Análise por LLM
complementando o desfecho. Ferramenta `registrar_nao_contatar` e o desfecho novo.
Alerta de orçamento pelo plantão.

**Fase 4 — O agente liga.**
Só depois da resposta jurídica e do motor de cotação validado contra as 1.124.
`ligacao_habilitada = true`, `case 'ligar'` enfileira, as duas tools no registry —
**em modo `sugestao` primeiro**. `voz_roteiros` como overrides de texto.

**Fase 5 — Volume.**
Teste de carga medindo **latência**, não throughput (6.7). Segundo e terceiro números,
warmup, concorrência, modo autônomo.

O que mudou de lugar em relação ao `voz.md`: o motor de cotação e o filtro de crédito são
novos e são de fase 1–4; `voz_roteiros` desceu de 1 para 4; §2.8(b) saiu.

---

## 10. O que eu preciso de vocês agora

Em ordem de quanto destrava:

1. **A cotação (§3).** Vocês têm um endpoint da Onepay que cote uma antecipação ainda não
   solicitada? Se sim, o motor não precisa existir. Se não, confirmem que a Ana consegue
   conduzir a ligação sem dizer valor líquido — porque é assim que a Fase 2 vai rodar.
2. **`registrar_nao_contatar` (§5).** É o único item que eu chamo de bloqueante para
   produção. Concordam com a ferramenta e com o desfecho novo?
3. **A oferta na linha da fila (§2.2).** `crm.registrar_oferta` aceita ser chamado com um
   dicionário em vez de por HTTP?
4. **O bloco `roteiro` no payload (§4).** Dez linhas. Alguma objeção?
5. **Frame de áudio direto (6.6).** Dá para tocar uma despedida sem passar pelo LLM?
6. **Latência sob concorrência (6.7).** Quando der para medir, é o número que dimensiona
   tudo.
7. **A persona.** Não temos nenhum vendedor de IA criado ainda — zero linhas com
   `is_ia = true`. Então a escolha é livre e só existe agora: **"Ana" no telefone e no
   WhatsApp**, uma pessoa só, ou duas personas separadas? Alinhar custa nada hoje e é
   impossível depois. Só um cuidado: *"parceira da [sacado]"* é um enquadramento forte e
   específico da ligação sobre uma NF; se a mesma Ana também prospectar por WhatsApp em
   outros funis, esse enquadramento não viaja.
