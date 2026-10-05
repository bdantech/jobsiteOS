# JOBSITEOS — Claude Code Prompt 05C: Inteligência de Conversas

## Captura de reuniões, rubrica de qualidade, score e feedback automático

> Builds on Prompts 01–09. Reuse pesado: `comunicacoes` e threads (05A), `voz_ligacoes` e transcrição da Ana (09 + contrato de voz), `mandatos` e `mandato_acoes` (09), `vendedores` e `vendedor_carteira` (04g/04k), Meu Dia (04p), aba Reunião existente no funil de reuniões e no funil de venda, motor de filtros (02), event log, buckets privados com RLS.
> **Localização**: a maior parte aparece dentro de telas existentes (aba Reunião dos funis, painel do vendedor). O que é novo: aba **Feedback** no painel do vendedor, e **Comercial → Qualidade** para gestores.
> UI pt-BR, código em inglês. Migrations via Supabase MCP. Segredos só em env/Vault.

---

## 0. O que este módulo é

Três entregas que se sustentam uma na outra:

1. **Captura** — toda reunião agendada pela plataforma é gravada e transcrita pelo Fireflies, automaticamente, e volta amarrada à empresa, ao contato e ao mandato.
2. **Julgamento** — toda interação (reunião, ligação, WhatsApp, e-mail) é avaliada contra uma **rubrica versionada** que descreve o nosso modo de operar. O resultado é uma nota explicável, item a item.
3. **Loop de feedback automático** — o vendedor recebe a análise na própria tela, sem passar por ninguém, com o que faltou, a citação do trecho e o que era esperado. E pode contestar cada item — contestação que volta como rótulo humano e recalibra o sistema.

**Fronteira com os outros módulos**: 05A é o ledger de comunicação (o que foi dito). 09 é o agente que age. **Este módulo não envia nada e não decide nada** — ele lê o que já aconteceu, julga e devolve. A única escrita no mundo é o convite do Fireflies (§1) e o write-back cadastral aditivo (§11).

---

## 1. Captura de reuniões — Fireflies

### 1.1 O mecanismo (ler antes de implementar)

Convidar `admin@oneos.com.br` **não basta** para o notetaker entrar. O que dispara o join é a reunião estar no calendário conectado da conta Fireflies com auto-join atendido. Portanto, **toda reunião criada pela plataforma convida os dois**:

- `admin@oneos.com.br` — põe a reunião no calendário da conta central, que passa a ser **dona do transcript** (webhooks são entregues para as reuniões que a conta possui).
- `fred@fireflies.ai` — dispara o join do bot.

Na conta central, o auto-join deve estar configurado como **"somente quando eu convidar o fred"**, nunca "todas as reuniões com link" — senão qualquer reunião interna que caia naquele calendário vira transcript gravado.

Toda reunião criada pelo JobsiteOS (pelo SDR humano ou pelo agente de IA do Prompt 09) passa por um único caminho de criação que anexa os dois convidados. Não existe caminho alternativo de criação de reunião na plataforma.

### 1.2 Amarração desde a origem

Ao criar a reunião, gravar nosso id interno e propagá-lo como **`client_reference_id`** na integração Fireflies. O webhook devolve esse campo, então a reunião volta amarrada sem depender de casar por título ou por horário — que é onde esse tipo de integração costuma falhar.

```sql
create table reunioes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  contato_id uuid references contatos(id),
  vendedor_id uuid references vendedores(id),        -- quem conduz (SDR ou closer)
  agente_id uuid references vendedores(id),          -- quando agendada por IA (09)
  mandato_id uuid references mandatos(id),
  google_event_id text,
  link_conferencia text,
  titulo text,
  inicio timestamptz not null,
  fim timestamptz,
  participantes_convidados jsonb,                    -- e-mails do convite
  -- Fireflies
  fireflies_meeting_id text unique,
  fireflies_client_reference_id text unique,
  bot_entrou_em timestamptz,
  transcricao_recebida_em timestamptz,
  resumo_recebido_em timestamptz,
  captura_status text not null default 'agendada',
    -- agendada | bot_entrou | transcrita | sem_captura | dispensada
  transcricao text,
  resumo text,
  participantes_detectados jsonb,                    -- quem realmente falou
  url_fireflies text,                                -- link, NÃO copiamos a mídia
  criada_em timestamptz default now()
);
create index on reunioes (empresa_id, inicio desc);
create index on reunioes (captura_status) where captura_status in ('agendada','bot_entrou');
```

### 1.3 Webhook

`POST /webhooks/fireflies`, assinado com **HMAC-SHA256** no header `X-Hub-Signature` — verificar com comparação de tempo constante contra o segredo configurado, sobre o corpo cru. Eventos tratados:

- `meeting.bot_joined` → `captura_status = 'bot_entrou'`, grava `bot_entrou_em`.
- `meeting.transcribed` → buscar o transcript completo pela GraphQL com o `meeting_id`, persistir texto e participantes, disparar análise (§4).
- `meeting.summarized` → persistir resumo.

Evento desconhecido é **registrado**, nunca descartado com 200 silencioso. Entrega repetida não pode duplicar nada — idempotência por `(evento, meeting_id)`.

### 1.4 Quando o bot não entra

Job `reunioes/vigiar-captura` a cada 5 minutos: reunião que começou há mais de `minutos_para_bot` (config, default 5) e segue `agendada` → marca alerta e notifica o condutor. Sem isso, a falha de captura só aparece quando alguém procura o transcript e não acha.

**Resgate manual**: botão "Chamar o bot agora" usa a mutation `addToLiveMeeting` com o link da conferência. **Limite duro de 3 chamadas a cada 20 minutos** no lado do Fireflies — implementar com fila e contador local, mostrando ao usuário quando o próximo resgate estará disponível em vez de estourar o limite e devolver erro críptico.

Reunião interna ou que não deve ser gravada: marcar `dispensada` na criação, e o convite do Fireflies não é anexado.

### 1.5 Mídia

**Não copiamos áudio nem vídeo.** Guardamos link (`url_fireflies`), transcrição e análise. Copiar dobra custo de storage e cria um segundo lugar de onde vazar conversa de cliente.

---

## 2. A interação como unidade de análise

Reunião e ligação se analisam inteiras. WhatsApp e e-mail não: uma mensagem isolada não tem rubrica aplicável — o que se julga é **a janela de conversa**.

```sql
create table analises (
  id uuid primary key default gen_random_uuid(),
  escopo text not null,                 -- reuniao | ligacao | janela_conversa
  reuniao_id uuid references reunioes(id),
  voz_ligacao_id uuid references voz_ligacoes(id),
  conversa_id uuid references conversas(id),
  janela_inicio timestamptz,            -- para escopo = janela_conversa
  janela_fim timestamptz,
  empresa_id uuid not null references empresas(id),
  contato_id uuid references contatos(id),
  vendedor_id uuid references vendedores(id),
  agente_id uuid references vendedores(id),
  rubrica_id uuid not null references rubricas(id),
  rubrica_versao int not null,
  -- resultado
  score numeric(4,3),                   -- NULL enquanto a rubrica não estiver calibrada
  itens_aplicaveis int,
  itens_atendidos int,
  modo text not null default 'publicado',  -- sombra | publicado
  -- custo
  provedor text not null,               -- jev | claude
  custo_centavos numeric(10,4),
  tokens_entrada int,
  analisada_em timestamptz default now(),
  unique (escopo, reuniao_id, voz_ligacao_id, conversa_id, janela_fim)
);

create table analise_itens (
  id uuid primary key default gen_random_uuid(),
  analise_id uuid not null references analises(id) on delete cascade,
  item_id uuid not null references rubrica_itens(id),
  aplicavel boolean not null,
  aplicabilidade_prob numeric(4,3),
  resultado text,                       -- sim | nao | <opção> | <score>
  probabilidade numeric(4,3),
  atendido boolean,
  citacao text,                         -- trecho que justifica (Claude, só quando reprovado)
  orientacao text,                      -- o que era esperado (Claude, só quando reprovado)
  provedor text not null,
  contestado boolean default false
);
create index on analise_itens (item_id, atendido);
```

**Janela de conversa**: job diário fecha a janela de cada conversa ativa desde a última análise, com mínimo de mensagens (config, default 4) para valer a pena analisar. Conversa parada não gera análise nova.

---

## 3. A rubrica — o modo de operar, versionado

A spec do nosso modus operandi vira dado, não texto solto em documento. Versionada, igual às regras da pirâmide (02) e ao scorecard (04d).

```sql
create table rubricas (
  id uuid primary key default gen_random_uuid(),
  tipo_interacao text not null,         -- reuniao | ligacao | conversa_texto
  nome text not null,
  versao int not null,
  ativa boolean default false,
  calibrada_em timestamptz,             -- §5 — sem isso, roda em sombra
  descricao text,
  criada_por uuid references usuarios(id),
  criada_em timestamptz default now(),
  unique (tipo_interacao, versao)
);

create table rubrica_itens (
  id uuid primary key default gen_random_uuid(),
  rubrica_id uuid not null references rubricas(id) on delete cascade,
  ordem int not null,
  chave text not null,                  -- escutou_dor, proximo_passo_com_data, ...
  etapa text,                           -- agrupador visual: Dor | Solução | Segurança | Próximos passos
  pergunta text not null,               -- a pergunta tipada enviada ao classificador
  tipo_resposta text not null,          -- sim_nao | escolha | score
  opcoes jsonb,                         -- quando escolha
  peso numeric(4,2) not null default 1,
  condicao_aplicabilidade text,         -- outra pergunta tipada; NULL = sempre aplicável
  limiar numeric(4,3),                  -- CALIBRADO (§5), nunca chutado
  orientacao text not null,             -- o que o vendedor deveria ter feito — insumo do feedback
  ativo boolean default true,
  unique (rubrica_id, chave)
);
```

### 3.1 Seeds obrigatórios

**Rubrica de reunião** — o formato proposto, decomposto em checagens observáveis:

| Etapa | Item | Pergunta (ao classificador) |
| --- | --- | --- |
| Dor | `explorou_dor` | O vendedor fez perguntas sobre a situação ou dificuldade atual do cliente antes de apresentar a solução? |
| Dor | `cliente_verbalizou_dor` | O cliente descreveu uma dificuldade, necessidade ou problema concreto? |
| Solução | `apresentou_solucao` | O vendedor explicou como a OnePay resolve a dificuldade que o cliente descreveu? |
| Solução | `conectou_a_dor` | A solução apresentada foi conectada explicitamente ao que o cliente disse? |
| Segurança | `tratou_objecao` | Toda objeção levantada pelo cliente recebeu resposta? |
| Segurança | `trouxe_prova` | O vendedor trouxe elemento de segurança (caso, número, garantia, prazo, referência)? |
| Próximos passos | `definiu_proximo_passo` | Ficou combinado um próximo passo concreto? |
| Próximos passos | `proximo_passo_com_data` | Esse próximo passo tem data ou prazo definido? |

**Rubrica de ligação e de conversa de texto** — aderência e pendência:

| Item | Pergunta |
| --- | --- |
| `aderencia_discurso` | O que o vendedor disse está alinhado com a proposta de valor e as condições definidas? |
| `respondeu_pergunta` | Alguma pergunta do cliente ficou sem resposta? |
| `pendencia_nossa` | Ficou alguma pendência do nosso lado sem retorno? |
| `follow_up_no_prazo` | O retorno ao cliente aconteceu dentro do prazo combinado? |
| `objecao_registrada` | Houve objeção? Qual? *(escolha: preço · prazo · burocracia · concorrente · não é o momento · sem objeção)* |
| `mencionou_concorrente` | O cliente mencionou outra empresa de antecipação ou ERP? |

### 3.2 Condição de aplicabilidade — não opcional

Rubrica aplicada fora de contexto gera ruído e mata a credibilidade da aba Feedback na primeira semana. `definiu_proximo_passo` numa ligação de 90 segundos em que o cliente disse "não tenho interesse" é falso negativo, e o vendedor é punido por ter encerrado certo.

Por isso cada item carrega `condicao_aplicabilidade` — outra pergunta tipada ao classificador, avaliada **antes** do item. Item não aplicável **sai do denominador**: não conta como atendido nem como falho.

Exemplos de seed: `definiu_proximo_passo` só se aplica quando a conversa não terminou em recusa explícita; `tratou_objecao` só se aplica quando houve objeção; `conectou_a_dor` só se aplica quando o cliente verbalizou uma dor.

### 3.3 Versionamento

Editar rubrica ativa cria nova versão, não altera a vigente. Nova versão nasce **não calibrada** e portanto em modo sombra (§5). Análise guarda `rubrica_versao` — comparação histórica de nota só é válida dentro da mesma versão, e a UI deve dizer isso quando o usuário cruza a fronteira.

---

## 4. O motor de análise

### 4.1 Adapter de classificação

```ts
// packages/core/analise/classificador.ts
interface Classificador {
  perguntar(estado: string, perguntas: PerguntaTipada[]): Promise<RespostaCalibrada[]>
}
```

Duas implementações, selecionáveis em settings:

- **`jev`** (padrão) — TypeSafe AI. Devolve escolha, score ou sim/não com **probabilidade calibrada**, texto apenas na entrada, sem saída de texto. É o braço que roda em tudo, todo dia.
- **`claude`** (fallback) — mesma interface, usado quando o Jev falha, está indisponível ou o item precisa de raciocínio encadeado.

**Chaveamento automático**: erro, timeout ou indisponibilidade do Jev cai para Claude dentro da mesma análise, registrando o provedor por item em `analise_itens.provedor`. Nenhuma análise fica sem rodar por causa de fornecedor — e o painel de custo mostra quanto correu em cada braço.

### 4.2 O que vai para cada modelo

| Tarefa | Quem | Por quê |
| --- | --- | --- |
| Condição de aplicabilidade de cada item | Jev | sim/não de alto volume |
| Resposta de cada item da rubrica | Jev | conjunto fixo de respostas |
| Score agregado | **ninguém** — é aritmética | §4.3 |
| Citação que justifica item reprovado | Claude | extração |
| Frase de orientação ao vendedor | Claude | geração |
| Resumo quando o Fireflies não entregou | Claude | geração |
| Extração de contato novo (nome, cargo, e-mail) | Claude | extração |
| Item na banda cinzenta (§4.4) | Claude | julgamento |

**O Claude roda só sobre itens reprovados e banda cinzenta**, que é a minoria. É a mesma cascata grátis-primeiro do Radar aplicada a análise: o braço barato roda em tudo, o caro roda onde há consequência.

### 4.3 O score é aritmética

```
score = Σ(peso_i × atendido_i) / Σ(peso_i)      — só sobre itens APLICÁVEIS
```

Nenhum modelo opina sobre a nota final. Isso é o que torna a nota **explicável e contestável**: "0,62 porque faltou próximo passo com data e a objeção de prazo ficou sem resposta" sai dos itens, não de um juízo opaco. Se todos os itens forem inaplicáveis, `score = NULL` e a interação aparece como "sem avaliação aplicável" — nunca como zero.

### 4.4 Banda cinzenta e calibração do Jev

O Jev é documentadamente **subconfiante**: respostas corretas costumam pontuar em torno de 0,75 e raramente chegam a 0,95. Cravar limiar em 0,9 por intuição descarta metade dos acertos.

Por isso: `limiar` por item vem da calibração (§5), e existe uma **banda cinzenta** `[limiar - delta, limiar + delta]` (config, default 0,10) em que o item é reenviado ao Claude para decisão. Registrar `provedor` por item para medir quanto da banda cinzenta está custando — banda larga demais anula a economia.

**Regra dura**: o Jev nunca é o único julgador de um item que reprova alguém. Item reprovado sempre passa pelo Claude, nem que seja só para produzir citação e orientação — e se o Claude discordar do Jev na banda cinzenta, vale o Claude, e a divergência é registrada para a recalibração.

---

## 5. Calibração — etapa obrigatória

Nenhuma nota chega a um vendedor antes disso. Rubrica não calibrada roda em **modo sombra**: analisa, grava, não publica.

1. **Conjunto de calibração**: mínimo `min_amostras_calibracao` por rubrica (config, default 20 interações por tipo), rotuladas à mão por gestor numa tela dedicada — item a item, mesma pergunta que vai ao classificador.
2. **Ajuste de limiar por item**: maximizar F1 sobre as amostras, mostrando a curva precisão/recall e quantas amostras sustentam cada ponto. Item com amostras insuficientes fica **inativo**, não com limiar chutado.
3. **Gravação**: `rubrica_itens.limiar` só pode ser escrito pela calibração ou por override explícito de gestor, com registro de quem e por quê.
4. **Recalibração**: automática quando entram `n_contestacoes_para_recalibrar` contestações novas (config, default 15) ou quando a rubrica muda de versão.

**Relatório de calibração** por item: F1, precisão, recall, nº de amostras, limiar escolhido. Item com F1 abaixo de `f1_minimo` (config, default 0,70) **não publica nota** — fica em sombra, sinalizado como "pergunta mal formulada", que é a leitura correta: o problema é a rubrica, não o vendedor.

---

## 6. Onde o resultado aparece

**Aba Reunião — funil de reuniões e funil de venda** (as abas já existem; estender). Para cada reunião: participantes, duração, link do Fireflies, **transcrição completa** com busca, resumo, **a análise item a item agrupada por etapa** (Dor · Solução · Segurança · Próximos passos), o score com a memória de cálculo, próximos passos detectados e objeções registradas.

**Modal de interação** nos demais funis: ligação e janela de conversa com o mesmo tratamento, em escala menor.

**Selo de nota** no card da empresa e no histórico da conversa — sempre clicável para o detalhe, **nunca um número solto**.

---

## 7. Aba Feedback — painel do vendedor

Nova aba ao lado de Meu Dia, visível para **o próprio vendedor**, publicada automaticamente, sem revisão humana.

**Cabeçalho fixo e explícito**: *"Análise gerada por IA a partir das suas conversas. Use o botão Contestar quando discordar — é assim que o sistema aprende."*

**Conteúdo**:
- **Suas últimas interações** — cada uma com nota, itens atendidos, e os itens que faltaram trazendo **a citação do trecho e o que era esperado**. A citação é o que torna o feedback discutível em vez de sentencioso.
- **Onde você mais perde pontos** — os itens com pior taxa nos últimos 30 dias, com a orientação da rubrica.
- **Pendências detectadas** — o que ficou parado do nosso lado: pergunta sem resposta, follow-up fora do prazo, próximo passo combinado e não cumprido. **Cada pendência vira item acionável no Meu Dia (04p)**, com link para a conversa. Esta é a parte de maior valor prático do módulo.
- **Evolução** — a nota ao longo do tempo, por etapa da rubrica, dentro da mesma versão.
- **Botão Contestar** em cada item.

O agente de IA (09) tem a mesma aba, com o mesmo tratamento — é assim que se compara IA e humano na mesma régua.

---

## 8. Comercial → Qualidade (gestores)

Visão agregada: nota média por vendedor, por etapa da rubrica e por tipo de interação; distribuição das objeções; menções a concorrente; pendências abertas por vendedor; evolução no tempo; comparação entre vendedores humanos e agentes de IA no mesmo escopo.

E a seção que importa para a saúde do sistema: **taxa de contestação por item**. Item muito contestado é rubrica mal escrita. Mostrar isso ao lado das notas evita que o instrumento seja usado contra as pessoas quando o defeito é dele.

Custo da análise por período e por provedor, com o quanto correu em Jev e quanto caiu para Claude.

---

## 9. Contestação — o loop que se alimenta

```sql
create table analise_contestacoes (
  id uuid primary key default gen_random_uuid(),
  analise_item_id uuid not null references analise_itens(id),
  contestado_por uuid not null references usuarios(id),
  justificativa text,
  resposta_gestor text,
  veredito text,                        -- procedente | improcedente | rubrica_ajustar
  rotulo_humano text,                   -- a resposta correta, segundo o gestor
  revisada_por uuid references usuarios(id),
  criada_em timestamptz default now(),
  revisada_em timestamptz
);
```

Contestar não apaga a nota — abre uma revisão. Fila para o gestor, com a citação e o trecho em volta. Veredito `procedente` corrige o item e recalcula o score daquela análise; `rubrica_ajustar` marca o item para revisão de redação.

**Todo `rotulo_humano` entra no conjunto de calibração.** É isso que faz o loop girar sem ninguém montar dataset: quanto mais o sistema é usado e contestado, melhor ele fica.

---

## 10. Vinculação de contas a empresas

Hoje o comercial faz esse casamento à mão. Vira cascata, no mesmo padrão:

1. **Determinístico, grátis** — domínio do e-mail → CNPJ já conhecido; telefone exato já cadastrado; `client_reference_id` quando vier de reunião da plataforma.
2. **Shortlist** — até 20 candidatas por similaridade (razão social normalizada, nome fantasia, domínio, UF).
3. **Jev** pontua cada par candidato com probabilidade de ser a mesma entidade. Em benchmark independente de resolução de identidade, essa abordagem rendeu F1 ≈ 0,95 em bases de dezenas de milhares de contas, a ordens de grandeza menos custo e latência que modelos de geração.
4. **Banda cinzenta → Claude**, que é onde o mesmo benchmark recuperou os casos difíceis a custo modesto.
5. **Fila humana** para o que sobrar, ordenada por valor potencial.

**Modos de falha conhecidos, a tratar explicitamente**: diretórios com contas duplicadas derrubam muito a precisão — deduplicar antes de pontuar; e-mail pessoal (gmail) não casa com empresa — tratar como não resolvível em vez de forçar; pares secundários na faixa 0,2–0,5 vão para humano, não para automático.

Medir e mostrar: % resolvido automaticamente, % na fila humana, e precisão amostrada por auditoria mensal.

---

## 11. Write-back cadastral

Aditivo grava direto: contato novo detectado numa reunião (nome, cargo, e-mail), telefone novo, cargo quando o campo está vazio. Sempre com `origem = 'analise_conversa'` e link para a interação de onde veio — rastreável.

**Sobrescrita propõe**, nunca grava: campo já preenchido com valor diferente vira sugestão na fila de revisão da empresa.

---

## 12. Retenção, acesso e privacidade

- **Mídia** fica no Fireflies. Guardamos link, transcrição, resumo e análise.
- **Transcrição** em tabela, com RLS: visível a quem já vê a empresa.
- **Análise individual**: visível ao **próprio vendedor** e a gestores. Um vendedor não vê a análise de outro.
- **Toggles por pessoa** (settings): `captura_ativa` e `analise_ativa`, independentes. Desligar captura desliga análise por consequência; desligar análise mantém a gravação e o transcript.
- **Expurgo** de transcrições configurável (default: manter), com o dado de análise sobrevivendo ao texto.
- Registrar Fireflies e TypeSafe AI na lista de subprocessadores — é conversa de cliente saindo para mais dois fornecedores.

---

## 13. Settings (Comercial → Qualidade, `webOnly`, gestor)

Conta e segredo do Fireflies · `minutos_para_bot` · CRUD de rubricas com versionamento e pré-visualização · tela de rotulagem e relatório de calibração · provedor de classificação (jev/claude) e `delta` da banda cinzenta · `f1_minimo` · `min_amostras_calibracao` · `n_contestacoes_para_recalibrar` · mínimo de mensagens para fechar janela de conversa · toggles de captura e análise por pessoa · retenção.

---

## 14. Eventos, tools, notificações, entregáveis

**Eventos**: `reuniao.agendada`, `reuniao.bot_entrou`, `reuniao.sem_captura`, `reuniao.transcrita`, `analise.concluida`, `analise.publicada`, `analise.contestada`, `analise.contestacao_resolvida`, `rubrica.versionada`, `rubrica.calibrada`, `vinculacao.resolvida_automaticamente`, `vinculacao.enviada_para_humano`.

**Notificações**: bot não entrou (ao condutor, imediato) · transcrição pronta (ao condutor) · pendência detectada (vira item no Meu Dia) · contestação aberta (ao gestor) · contestação resolvida (ao vendedor) · rubrica saiu de sombra.

**Tools (barra de IA)**, leitura: `qualidade.minhas_analises` · `qualidade.detalhe_analise` · `qualidade.pendencias` · `qualidade.reuniao` (transcrição e análise de uma reunião) · `qualidade.agregado` (gestor).

**Worker**: `reunioes/vigiar-captura` (5 min) · `analise/processar` (fila, disparada por webhook e por fechamento de janela) · `analise/fechar-janelas` (diário) · `analise/recalibrar` (quando atingir o gatilho) · `vinculacao/resolver` (diário).

**Core** (`packages/core/analise/`), com testes:
- `classificador.ts` — adapter, com testes de queda do Jev para Claude no meio da análise.
- `rubrica.ts` — aplicabilidade e score aritmético. **Testes**: todos os itens inaplicáveis → score NULL, nunca zero; item inaplicável fora do denominador; peso zero; rubrica sem itens ativos.
- `calibracao.ts` — ajuste de limiar por F1, amostras insuficientes, item abaixo do F1 mínimo permanece em sombra.
- `vinculacao.ts` — cascata determinístico → shortlist → Jev → Claude → humano. **Testes**: e-mail pessoal; empresa duplicada na base; domínio compartilhado (contabilidade que responde por várias).
- `fireflies.ts` — verificação HMAC com corpo cru, idempotência, evento desconhecido registrado, rate limit do `addToLiveMeeting`.

**Docs**: `docs/qualidade.md` — como a rubrica é escrita, por que a condição de aplicabilidade existe, como ler a nota, o que significa modo sombra, e o procedimento de calibração. Incluir a orientação de que **mudar a rubrica reinicia a comparabilidade histórica**.

---

## 15. Fora de escopo

Gravação de ligação fora da Ana · análise de reunião interna · ranking público de vendedores · nota entrando em cálculo de comissão (explicitamente fora: instrumento de coaching não vira instrumento de remuneração sem outra discussão) · tradução de transcrição · detecção de emoção por áudio (o Jev não é multimodal e não vale o custo no Claude) · integração com outro provedor de reunião além do Fireflies.

---

## 16. Verificações antes de começar

1. **Plano do Fireflies** — webhook de time (que entrega reuniões de todos os membros) exige Super Admin em plano Enterprise. Confirme o plano; se não for Enterprise, o desenho da conta central (§1.1) continua funcionando, porque a conta central é a dona das reuniões — mas registre essa dependência no README.
2. **Teto de transcrições do plano** — com conta central, tudo cai num assento só. Reporte o limite antes de ligar para todo o time.
3. **Credencial do Jev** — a conta existe. Confirme se o acesso é direto pela API da TypeSafe ou via OpenRouter, e qual a latência medida do Brasil (o serviço roda na costa oeste). Se a latência inviabilizar o volume, a fila assíncrona resolve — mas meça antes.
4. **Conflito de criação de reunião** — confirme que existe um único caminho de criação de reunião na plataforma. Se houver mais de um, unifique antes, senão a captura nasce com furo.
