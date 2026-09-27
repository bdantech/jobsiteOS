# JOBSITEOS — Claude Code Prompt 09: Agentes Comerciais de IA

## Mandatos, personas e o loop autônomo

> Builds on Prompts 01–08. Reuse pesado: `vendedores` + `is_ia` (04g), `vendedor_carteira` (04k), motor de filtros `packages/core/mercado/filters.ts` (02), `comunicacoes` + compositor + supressão + ponto focal (05A), `whatsapp_contas` (04), campanhas (05B), integração de voz existente (`voz_ligacoes`, `app_voz_enfileirar`, `POST /webhooks/voz`), Apollo e Nova Vida (03/04l), esteira de crédito (04d), funil de NFs (04), Meu Dia (04p), event log.
> **Localização**: novo item de menu **Agentes** (tabs: Ao vivo · Mandatos · Personas · Materiais · Desempenho).
> UI pt-BR, código em inglês. Migrations via Supabase MCP. Segredos só em env/Vault.
> **Documento companheiro**: o contrato da API de voz (JobsiteOS ↔ Ana) está sendo tratado com o time da Ana em paralelo. Este prompt implementa o lado do JobsiteOS e degrada com elegância enquanto a v2 da Ana não existir.

---

## 0. Onde estamos e o que este prompt faz

Existem hoje três peças que **nunca agiram em produção**: o serviço de ligação (Ana), o agente de próximo passo, e o cadastro `vendedores.is_ia`. Zero ligações, zero decisões, zero vendedores de IA, zero mensagens com `por_ia = true` em 18.461. Elas também não se conectam entre si — a única ponte viva é acidental.

Este prompt faz três coisas, nesta ordem:

1. **Corrige o que impede qualquer teste honesto** (§1). Não é opcional e não é depois.
2. **Troca a unidade de trabalho de conversa para mandato** (§2), que é o que permite ao agente perseguir um objetivo através de vários contatos, canais e dias.
3. **Transforma o vendedor de IA numa entidade completa** (§3) — persona, linha de WhatsApp, caixa de e-mail, conta de voz, closer designado, carteira e cotas — e dá a ele um loop real de ferramentas (§5–§6).

**Princípio que governa o módulo**: o agente é autônomo dentro de limites duros e auditáveis. Ele não pede autorização a cada mensagem; ele opera sob teto de orçamento, cota de volume, escopo de população e um disjuntor que o para sozinho. O controle é estrutural, não por aprovação.

---

## 1. Correções bloqueantes (fazer antes de qualquer feature nova)

Cada item abaixo já foi conferido no código ou no banco. Nenhum causa dano hoje porque tudo está parado; todos aparecem no primeiro dia de operação.

**1.1 — Deadlock da fila do agente.** `decidir.ts:167`: conversa sem playbook retorna **sem reagendar**, e a seleção pega as 50 mais antigas. Resultado: as mesmas 50 conversas travadas ocupam a fila para sempre e nenhuma conversa com playbook é alcançada. Corrigir: (a) sempre gravar `proxima_avaliacao` antes de retornar, mesmo quando não há nada a fazer; (b) a seleção passa a ordenar por `proxima_avaliacao asc`, não por criação; (c) conversa sem mandato nem playbook recebe um intervalo longo (config, default 24h), não zero.

**1.2 — Bypass do portão de voz.** Migração 0225:368-445: `app_voz_enfileirar` aceita qualquer `pedido`, e a supressão é verificada na coluna `telefone` da linha enquanto o número realmente discado é `pedido.telefone`. Corrigir: a RPC valida que `pedido.telefone = telefone`, normaliza para E.164 e roda a verificação de supressão/Procon/base legal **dentro da transação**, recusando com erro nomeado. Nenhum caminho pode enfileirar sem passar pelo portão.

**1.3 — Portão congelado no enfileiramento.** `jobs/voz/enviar.ts`: o pedido é montado ao enfileirar e nunca revalidado. Corrigir: reexecutar `podeLigar` com dados frescos **no momento do envio**; se falhar, cancelar a ligação, gravar o motivo e devolver o controle ao mandato (o agente decide se recalcula a oferta ou desiste). Recalcular taxa, TAC e líquido nesse instante.

**1.4 — Escalação que não reagenda.** `decidir.ts:189-197`: a escalação por guardrail não grava `proxima_avaliacao`, então a mesma conversa escala e notifica a cada hora. Corrigir: reagendar e marcar a conversa como `aguardando_humano` até alguém tocá-la.

**1.5 — Ligação órfã trava a nota.** `webhook.ts:45-49`: desfecho ou status fora da lista responde 200 e descarta; não há timeout nem cancelamento. Corrigir: (a) desfecho desconhecido é **aceito e registrado** como `desconhecido` com o payload bruto, nunca descartado; (b) job de varredura marca como `falhou` toda ligação `enviada` há mais de `voz_timeout_minutos` (config, default 30), liberando a nota; (c) implementar cancelamento no lado do JobsiteOS, e chamar `DELETE` na Ana quando ela expuser.

**1.6 — Gravação e links descartados pelo zod.** `voz/webhook.ts:58` passa à RPC o objeto validado, e `voz/schemas.ts:165` descarta campos não declarados — então `links.painel` e a gravação nunca são gravados e o botão "Ouvir" nunca aparece. Corrigir: declarar os campos no schema e persistir. Adicionar `transcricao` e `custo`.

**1.7 — Mensagem autônoma na conversa errada.** `decidir.ts:406-424` + `enviar-fila.ts:219`: no modo autônomo a mensagem sai por um número `ia` mas é gravada na conversa do número humano, então a resposta do cliente cai em outra thread e o histórico se parte. Corrigir: a conversa é resolvida pelo par (número de origem, número do contato). Enviou pela linha da persona → grava na conversa daquela linha.

**1.8 — Cooldown e despertar.** `enviar-fila.ts:281`: o cooldown é zerado para toda origem diferente de `outbox`, e a resposta do cliente não acorda o agente. Corrigir: (a) o cooldown conta a partir da última mensagem **nossa**, qualquer que seja a origem; (b) mensagem recebida dispara reavaliação imediata do mandato (`proxima_acao_em = now()`), não espera o próximo ciclo.

**1.9 — Distribuição alimentando carteira fantasma.** `distribuir.ts:60` e `roteamento.ts:27` filtram só tipo e ativo. Corrigir: excluir `is_ia` da distribuição padrão; a IA só recebe pelo escopo definido em §3.3.

**1.10 — Contradição de identificação.** `decidir.ts:372` manda assumir que é IA se perguntarem; `agente.ts:250-251` escala quando perguntam "é robô?". Corrigir conforme §7.4: responder com naturalidade e seguir, sem escalar.

**1.11 — Comissão quando o titular é IA.** `comissao-v2.ts:816`: quando o titular é IA, o originador-como-cedente humano recebe a parte. Contradiz a regra "não é paga nem redistribuída". Corrigir e cobrir com teste.

**1.12 — Documentação ficcional.** `docs/voz.md` e `docs/voz-decisoes.md` descrevem uma arquitetura que nunca foi construída (serviço Python com Telnyx, `voz_contas`, `voz_roteiros`). Mover para `docs/arquivo/` com um cabeçalho dizendo que nunca foram implementadas, e corrigir as partes de `docs/comunicacao.md` listadas ao final. Doc que mente custa mais que doc que falta.

---

## 2. Mandato — a unidade de trabalho

Um **mandato** é um objetivo comercial delegado a um agente, com escopo, prazo, orçamento e prestação de contas. O agente o persegue através de quantos contatos, canais e dias forem necessários, até conseguir ou desistir.

A diferença que faz tudo funcionar: **a conversa é presa a um número de telefone; o mandato não é**. O caso que o agente de hoje nunca resolveria — ligou, não era o decisor, buscou outro contato no Apollo, ligou de novo, mandou e-mail, marcou — atravessa três conversas e um contato que não existia no começo. Só existe como trabalho contínuo se houver uma entidade acima delas.

```sql
create table mandatos (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,                        -- MDT-2026-00001
  tipo text not null,
    -- originacao_nf | agendamento_reuniao | reativacao | qualificacao
  objetivo text not null,                    -- frase em linguagem natural, legível por humano
  empresa_id uuid not null references empresas(id),
  nota_fiscal_id uuid references notas_fiscais(id),   -- quando tipo = originacao_nf
  agente_id uuid not null references vendedores(id),  -- vendedor com is_ia = true
  playbook_id uuid references agente_playbooks(id),   -- o "como", reusa o que já existe
  estado text not null default 'aberto',
    -- aberto | em_andamento | aguardando_externo | pausado
    -- | concluido | encerrado_sem_sucesso | escalado
  resultado text,                            -- o que foi conseguido
  motivo_encerramento text,
  prioridade int not null default 50,
  -- limites
  orcamento_centavos int not null,
  gasto_centavos int not null default 0,
  max_acoes int not null,
  acoes_executadas int not null default 0,
  expira_em timestamptz not null,
  -- estado de trabalho
  plano jsonb,                               -- §2.2
  contatos_tentados jsonb default '[]',
  proxima_acao_em timestamptz,
  ultima_acao_em timestamptz,
  -- procedência
  origem text not null,                      -- regra | manual | escalonamento
  regra_id uuid references mandato_regras(id),
  criado_por uuid references usuarios(id),
  criado_em timestamptz default now(),
  encerrado_em timestamptz
);
create index on mandatos (estado, proxima_acao_em) where estado in ('aberto','em_andamento');
create index on mandatos (agente_id, estado);
create index on mandatos (empresa_id);
-- um mandato ativo por (empresa, tipo): não duas IAs perseguindo a mesma coisa
create unique index mandato_ativo_unico on mandatos (empresa_id, tipo)
  where estado in ('aberto','em_andamento','aguardando_externo');

create table mandato_acoes (
  id uuid primary key default gen_random_uuid(),
  mandato_id uuid not null references mandatos(id) on delete cascade,
  sequencia int not null,
  ferramenta text not null,
  intencao text not null,                    -- POR QUE o agente fez isso, em português
  argumentos jsonb,
  resultado jsonb,
  sucesso boolean,
  erro text,
  contato_id uuid references contatos(id),
  conversa_id uuid references conversas(id),
  comunicacao_id uuid references comunicacoes(id),
  voz_ligacao_id uuid references voz_ligacoes(id),
  custo_centavos int default 0,
  tokens_entrada int, tokens_saida int,
  duracao_ms int,
  executada_em timestamptz default now(),
  unique (mandato_id, sequencia)
);
create index on mandato_acoes (executada_em desc);

create table mandato_conversas (
  mandato_id uuid references mandatos(id) on delete cascade,
  conversa_id uuid references conversas(id),
  primary key (mandato_id, conversa_id)
);
```

### 2.2 O plano explícito

Requisito de produto, não enfeite: **em qualquer momento tem que estar claro o que o agente está tentando e por quê.** É o que torna a autonomia supervisionável sem aprovar mensagem por mensagem.

```jsonc
{
  "objetivo_atual": "Falar com quem decide antecipação no financeiro da Construtora X",
  "hipotese": "A Marcia é do RH e indicou o Carlos como responsável financeiro",
  "proximas_acoes": [
    { "acao": "ligar", "quando": "2026-09-27T15:30:00-03:00",
      "contato": "Carlos Menezes", "por_que": "horário que a Marcia indicou",
      "condicao": "se não atender, tentar 17h" },
    { "acao": "enviar_email", "quando": "2026-09-27T18:00:00-03:00",
      "contato": "Carlos Menezes", "por_que": "deixar a apresentação institucional antes da 2ª tentativa",
      "condicao": "só se a ligação não converter" }
  ],
  "bloqueios": [],
  "confianca": 0.7
}
```

Versionar: toda vez que o plano muda, gravar em `mandato_plano_versoes` com o motivo da mudança. Ler a evolução do plano é como se audita um agente que errou.

### 2.3 Como um mandato nasce

- **Por regra** (o caminho principal): `mandato_regras` usa o **motor de filtros do Prompt 02** (`packages/core/mercado/filters.ts`) — a mesma árvore JSON que já governa pirâmide, faixas de NF, segmentos e campanhas. Um job diário avalia as regras ativas e cria mandatos para o que entrou no filtro, respeitando o teto de mandatos simultâneos por agente.
- **Manual**: botão em qualquer tela de empresa, NF ou funil — "Delegar ao agente", escolhendo tipo, agente e objetivo.
- **Por escalonamento**: um mandato de qualificação que descobre interesse pode **propor** um mandato de agendamento. Proposta vai para fila de aprovação humana; o agente não cria mandato sozinho.

```sql
create table mandato_regras (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo_mandato text not null,
  agente_id uuid references vendedores(id),
  filtro jsonb not null,                     -- árvore do motor de filtros (02)
  objetivo_template text not null,
  orcamento_centavos int not null,
  max_acoes int not null,
  prazo_dias int not null,
  teto_mandatos_ativos int,
  ativa boolean default false,               -- nasce DESLIGADA
  criada_por uuid references usuarios(id)
);
```

Toda regra nasce desligada e tem **prévia de impacto** antes de ligar: quantas empresas o filtro pega hoje, quantos mandatos criaria, e o custo estimado se todos gastarem o orçamento. Mesmo padrão das regras versionadas do Prompt 02.

### 2.4 Quando o agente desiste

Encerramento por qualquer um: objetivo atingido; `expira_em` vencido; `max_acoes` esgotado; orçamento esgotado; contatos esgotados (todos tentados o número máximo de vezes); `pediu_nao_contatar`; empresa bloqueada por cobrança (§Prompt 07) ou entrou em supressão; disjuntor aberto (pausa, não encerra); escalação para humano.

Todo encerramento grava motivo e alimenta o painel de desempenho. Um agente que encerra 80% por "contatos esgotados" tem problema de dados, não de conversa — e isso só aparece se o motivo for estruturado.

---

## 3. A persona — o vendedor de IA como entidade completa

Hoje `is_ia` é um checkbox lido em cinco lugares para excluir a IA de coisas. Passa a ser a entidade que carrega tudo que a IA precisa para existir diante do cliente.

```sql
alter table vendedores add column persona jsonb;
  -- { nome_exibicao, tom, assinatura_email, bio_curta, foto_path, genero_gramatical }
alter table vendedores add column voz_conta_id text;         -- identidade na Ana
alter table vendedores add column email_remetente text;      -- ana@oneos.com.br
alter table vendedores add column email_caixa_id uuid references email_caixas(id);
alter table vendedores add column closer_id uuid references vendedores(id);
alter table vendedores add column closer_substituto_id uuid references vendedores(id);
alter table vendedores add column escopo jsonb;              -- §3.3
alter table vendedores add column limites jsonb;             -- §10.2
alter table vendedores add column modo_rodagem text default 'piloto';  -- piloto | pleno
alter table vendedores add column autonomo boolean default false;
alter table vendedores add column pausado_em timestamptz;
alter table vendedores add column pausado_motivo text;
```

**3.1 — `whatsapp_conta_id` passa a ser lida.** A coluna existe e nenhum código a usa; o envio "como IA" hoje faz rodízio anônimo entre contas do tipo `ia`. Corrigir: cada agente tem **sua linha**, e toda mensagem dele sai por ela. Rodízio some. A tela de persona passa a permitir escolher a conta, e uma conta só pode pertencer a um agente ativo.

**3.2 — Closer designado.** Cada agente de tipo SDR tem `closer_id`: as reuniões que ele marca vão para a agenda daquele closer. `closer_substituto_id` cobre férias e ausência — e o agente usa o substituto quando o titular não tem janela dentro do horizonte de agendamento (config, default 10 dias úteis) ou está marcado como ausente. Trocar o closer de um agente **não encerra mandatos em andamento**: as reuniões já marcadas ficam onde estão, as próximas vão para o novo.

**3.3 — Escopo: os dois modos.**

```jsonc
{
  "modo": "filtro",           // filtro | carteira
  "filtro": { /* árvore do motor de filtros (02) */ },
  "piloto": { /* filtro adicional aplicado enquanto modo_rodagem = 'piloto' */ }
}
```

- **`filtro`** (o de agora): a IA trabalha o que cai no filtro — para originação, por faixa de valor de NF ou por sacado; para SDR, por scorecard, porte ou UF. Não recebe distribuição.
- **`carteira`** (o de depois): a IA entra no rodízio de distribuição como um humano, com `vendedor_carteira` normal. Já deixar implementado e desligado — é uma flag, não um projeto.

**`modo_rodagem = 'piloto'`** aplica o filtro de piloto **por cima** do escopo, restringindo a população inicial a onde errar é barato. Cota limita volume; piloto limita a quem. Os dois juntos.

---

## 4. Canais

### 4.1 WhatsApp
Linha própria por agente (§3.1). Envio e recebimento de **texto, imagem, documento e áudio**. Mídia recebida vai para bucket privado e entra na conversa; PDF e imagem são descritos para o agente (extração de texto; imagem via visão do modelo) para que ele possa reagir a um documento enviado pelo cliente. Mídia enviada sai da biblioteca de materiais (§5) ou de um arquivo anexado por humano. Supressão, janela de envio e cooldown do 05A valem integralmente.

### 4.2 E-mail

```sql
create table email_caixas (
  id uuid primary key default gen_random_uuid(),
  endereco text not null unique,
  provedor text not null,                    -- google_workspace | resend
  identificador_externo text,
  ativa boolean default true,
  criada_em timestamptz default now()
);
```

Saída por Resend ou pela conta do Workspace, com o remetente da persona e assinatura própria.

**Entrada — verificar antes de implementar.** Não temos certeza se existe rota de inbound hoje. **Antes de codar, confira no repositório e nas configurações se há**: (a) webhook de inbound do Resend configurado, (b) domínio com MX apontando para receber, (c) integração Gmail API com escopo de leitura em alguma caixa de serviço. **Reporte o que encontrou antes de seguir.** Se não houver:

- **Recomendado**: criar `ana@oneos.com.br` como caixa real no Google Workspace e ler via Gmail API com a mesma integração OAuth já usada pelos vendedores humanos. Vantagem: a caixa existe de verdade, um humano pode abrir e ver, e o histórico não depende de webhook.
- Alternativa: rota de inbound do Resend com webhook.

Em qualquer caso: e-mail recebido entra em `comunicacoes` na conversa da empresa, resolve o contato pelo endereço, e **acorda o mandato imediatamente** (§1.8).

### 4.3 Voz
Segue a integração existente, corrigida por §1.2, §1.3, §1.5 e §1.6, e evolui conforme o contrato com a Ana.

**Implementar agora, degradando**: a ferramenta `ligar` do agente recebe `objetivo` e `contexto`; enquanto a Ana só aceitar v1, o adapter traduz `ofertar_antecipacao` para o payload atual e **recusa os demais objetivos com erro claro**, que o agente lê e contorna por outro canal. Não simular capacidade que não existe.

**Já implementar o consumo dos desfechos estruturados** — em especial `agendar_retorno` com contato novo e `indicou_outro_contato`, criando o contato e reagendando a próxima ação. É o que destrava o comportamento que o módulo existe para ter.

**Quebrar o acoplamento com a NF agora**: `voz_ligacoes` ganha `mandato_id`, `objetivo` e `contato_id`; `nota_fiscal_id` vira opcional. A restrição de uma tentativa aberta passa a ser por (mandato, contato), não por nota.

---

## 5. Biblioteca de materiais de apoio

```sql
create table materiais (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text not null,
  quando_usar text not null,            -- em português: quando este material é o certo
  tipo text not null,                   -- pdf | link | imagem | video | texto
  arquivo_path text,                    -- bucket privado
  url text,
  corpo text,                           -- para tipo = texto (blurbs reusáveis)
  tags text[],
  canais text[] default '{email,whatsapp}',
  ativo boolean default true,
  vezes_usado int default 0,
  criado_por uuid references usuarios(id),
  criado_em timestamptz default now()
);
```

`quando_usar` é o campo que faz a biblioteca ser usável por um agente: ele recebe o catálogo (nome + descrição + quando usar + canais) e escolhe. Sem esse campo, ou o agente manda o material errado, ou não manda nenhum.

Upload por gestor, com pré-visualização. Contador de uso e taxa de resposta após envio alimentam o painel de desempenho — material que nunca converte deve ser aposentado com base em número.

---

## 6. O loop do agente

Substitui `decidir.ts`. A mudança central: **de "escolher uma de dez ações" para um loop real de ferramentas com orçamento de passos.** É o que permite encadear "buscar contato no Apollo → criar contato → ligar" dentro de um mesmo ciclo.

**Worker `agentes/ciclo`, a cada 5 minutos.** Granularidade de hora não serve: um agente que combinou ligar às 15h30 precisa ligar às 15h30.

Por ciclo:

1. **Selecionar** mandatos com `estado in ('aberto','em_andamento')` e `proxima_acao_em <= now()`, ordenados por prioridade e depois por `proxima_acao_em`. Teto de mandatos por ciclo (config).
2. **Trancas, nesta ordem** — qualquer uma para o mandato sem chamar o modelo: kill switch global · agente pausado · disjuntor aberto · orçamento global esgotado · orçamento do mandato esgotado · cota diária do agente · `max_acoes` · `expira_em` · empresa em supressão ou bloqueada por cobrança · fora da janela de envio (reagenda para a abertura).
3. **Montar o contexto**: mandato e plano atual, playbook, últimas 30 mensagens de todas as conversas do mandato, desfechos de ligações, contatos conhecidos e os já tentados (com resultado), empresa e dados de crédito, catálogo de materiais, orçamento restante, cotas restantes.
4. **Loop de ferramentas** com a API da Anthropic, limite de `max_passos_por_ciclo` (config, default 8) e limite de tempo. O modelo chama ferramentas de verdade; cada chamada é executada, o resultado volta, ele decide o próximo passo.
5. **`atualizar_plano` é obrigatória** antes de encerrar o ciclo. Ciclo que termina sem plano atualizado é erro registrado.
6. **Persistir** cada ação em `mandato_acoes` com intenção em português, custo e tokens. Gravar tokens sempre — hoje `agente_decisoes.tokens` nunca é escrito e por isso não há como saber se o agente se paga.
7. **Agendar** `proxima_acao_em` a partir do plano.

**Guardrails dentro do loop** (herdar de `agente.ts:162`, estendidos): escalar para humano em pedido expresso, reclamação, negociação de taxa, menção a advogado ou cobrança; teto de tentativas por contato; cooldown mínimo entre mensagens ao mesmo contato; nunca contatar fora da janela; nunca falar de valores que não vieram no contexto.

### 6.1 Catálogo de ferramentas

Cada ferramenta declara `custo_estimado_centavos`, `muta` e `requer_orcamento`. Ferramenta paga com orçamento insuficiente **não aparece** para o modelo naquele ciclo — evita que ele planeje o que não pode fazer.

| Ferramenta | Custo | Observação |
| --- | --- | --- |
| `consultar_empresa`, `consultar_historico`, `consultar_contatos`, `listar_materiais` | grátis | leitura |
| `buscar_contatos_apollo` | pago | filtro de cargo, reusa 03 |
| `enriquecer_telefone` | pago | Nova Vida, reusa 04l |
| `buscar_dominio_empresa` | baixo | Claude + web search, reusa 03 |
| `registrar_contato`, `atualizar_contato` | grátis | inclusive contato indicado em ligação |
| `enviar_whatsapp` | baixo | texto ou mídia, pela linha da persona |
| `enviar_email` | baixo | pela caixa da persona |
| `enviar_material` | baixo | escolhe da biblioteca, envia pelo canal |
| `ligar` | pago | via Ana, com objetivo |
| `agendar_ligacao` | grátis | ligação futura, com contato e motivo |
| `consultar_agenda_closer` | grátis | janelas livres do closer |
| `agendar_reuniao` | grátis | cria no Google Calendar e convida |
| `mover_estagio_funil` | grátis | precisa ter efeito real (hoje é no-op) |
| `propor_mandato` | grátis | vai para fila de aprovação humana |
| `escalar_humano` | grátis | notifica e pausa o mandato |
| `encerrar_mandato` | grátis | com resultado e motivo |
| `atualizar_plano` | grátis | obrigatória |

**Ferramentas que hoje são no-op precisam funcionar ou sair da lista.** `mudar_estagio_funil`, `pedir_enriquecimento_contato` e `trocar_contato_da_conversa` contam como executadas sem fazer nada — um agente que acha que agiu e não agiu é pior que um agente que não age.

---

## 7. Agenda e agendamento de reunião

Reusar a integração Google Calendar já existente para os funcionários.

1. `consultar_agenda_closer` resolve as janelas livres do closer designado dentro do horizonte, respeitando duração padrão da reunião, buffer entre reuniões e horário comercial (config por closer).
2. Para ligação com objetivo `agendar_reuniao`, o JobsiteOS envia à Ana um **conjunto fechado de janelas**. A Ana confirma uma delas ou devolve `agendar_retorno`. Ela nunca inventa horário.
3. `agendar_reuniao` cria o evento no Calendar do closer, convida o contato, anexa o resumo do mandato na descrição, e grava `reuniao_id` no mandato.
4. Reunião marcada por agente de IA **não abre titularidade de SDR** (regra existente) e não gera comissão (§1.11).
5. Janelas oferecidas ficam com **reserva temporária** (config, default 30 min) para não oferecer o mesmo horário em duas conversas paralelas. Reserva expira sozinha.

Se o closer titular não tem janela no horizonte, usar o substituto; se nenhum tem, o agente devolve `interesse` com pendência e notifica o gestor.

---

## 8. Orçamento

**Teto global mensal** para todos os agentes, como pedido, **mais teto por mandato** — o global é a trava dura, o por-mandato impede que um mandato em laço drene a pool no dia 4 e deixe todos os outros parados em silêncio.

```sql
create table agentes_orcamento (
  id uuid primary key default gen_random_uuid(),
  mes date not null unique,                  -- primeiro dia do mês
  teto_centavos int not null,
  consumido_centavos int not null default 0,
  reservado_centavos int not null default 0,
  alertas_enviados int[] default '{}'        -- 50, 80, 95
);

create table agentes_orcamento_movimentos (
  id uuid primary key default gen_random_uuid(),
  mes date not null,
  mandato_id uuid references mandatos(id),
  acao_id uuid references mandato_acoes(id),
  agente_id uuid references vendedores(id),
  ferramenta text,
  tipo text not null,                        -- reserva | consumo | estorno
  valor_centavos int not null,
  criado_em timestamptz default now()
);
```

**Reserva e consumo atômicos.** Antes de chamar ferramenta paga: reservar o custo estimado numa transação que verifica teto global, teto do mandato e teto diário do agente ao mesmo tempo. Depois da chamada: consumir o custo real e estornar a diferença. Falhou: estornar tudo. Sem isso, dois agentes simultâneos gastam o mesmo saldo.

**Alertas** em 50%, 80% e 95% para gestores. **Em 100%**: todas as ferramentas pagas param; mandatos em andamento seguem só com ferramentas grátis até o fim do ciclo, e depois ficam `pausado` com motivo `orcamento_esgotado`. Nada é encerrado por falta de orçamento — orçamento novo no mês seguinte retoma.

Tokens contam no orçamento, calculados pela tabela de preço do modelo em config.

---

## 9. Cotas e disjuntor

### 9.1 Cotas (em `vendedores.limites`)

```jsonc
{
  "ligacoes_por_dia": 30,
  "mensagens_por_dia": 60,
  "emails_por_dia": 40,
  "mandatos_ativos": 25,
  "acoes_por_mandato_por_dia": 4,
  "tentativas_por_contato": 4,
  "cooldown_minutos_mesmo_contato": 180
}
```

### 9.2 Disjuntor automático

Não é aprovação humana — é parada automática. Ninguém precisa vigiar, mas o agente não corre uma semana ladeira abaixo.

```sql
create table agentes_disjuntor (
  agente_id uuid primary key references vendedores(id),
  janela_acoes int not null default 20,      -- janela móvel por CONTAGEM, não por tempo
  limiar_supressao numeric(4,3) default 0.10,
  limiar_sem_interesse numeric(4,3) default 0.60,
  limiar_escalacao numeric(4,3) default 0.30,
  limiar_falha_tecnica numeric(4,3) default 0.25,
  estado text not null default 'ok',         -- ok | alerta | aberto
  aberto_em timestamptz,
  aberto_motivo text,
  reaberto_por uuid references usuarios(id),
  reaberto_em timestamptz
);
```

Janela móvel por **contagem de ações**, não por tempo: com volume baixo, taxa por hora engana. Ultrapassou qualquer limiar → `aberto`, agente pausa, push imediato para gestor com as últimas ações que motivaram. **Reabertura só manual**, com registro de quem reabriu.

Kill switch **único** para tudo que é automático — hoje voz e agente têm switches separados (`antecipacao_config.voz.kill_switch` e `comunicacao_config.agente.kill_switch`), o que significa que desligar em emergência exige lembrar dos dois. Unificar em `agentes_config.kill_switch`, mantendo os antigos como espelho durante a transição.

---

## 10. Identificação

Política vigente: **a IA não anuncia que é IA; perguntada, confirma com naturalidade e segue a conversa.** Nunca afirma ser humana. Vale em todos os canais, incluindo voz.

Implementar como **configuração**, não como texto fixo no prompt: `agentes_config.identificacao = 'se_perguntada' | 'sempre' | 'nunca_afirmar_humano'`. É o tipo de política que muda com uma resposta jurídica, e mudá-la não pode exigir deploy.

Remover o guardrail que escala quando perguntam "é robô?" (§1.10): responder e seguir é comercialmente melhor que abandonar a conversa no momento mais sensível. O guardrail de escalação permanece para reclamação, negociação e menção a advogado.

**Regra dura**: o modelo nunca pode afirmar ser humano, nem inventar atributos pessoais (família, fim de semana, escritório). Cobrir com teste de prompt.

---

## 11. Menu Agentes

### 11.1 Ao vivo (aba padrão)
Pedido explícito: acompanhar em tempo real o que os agentes estão fazendo. Supabase Realtime sobre `mandato_acoes` e `mandatos`.

- **Faixa de agentes**: um cartão por agente com foto, estado (operando · ocioso · pausado · disjuntor aberto), o que está fazendo agora, mandatos ativos, consumo do dia e cotas restantes em barra.
- **Agora**: feed ao vivo das ações, mais recente no topo — agente, ferramenta, empresa, contato e a **intenção em português**. É a tela que se deixa aberta num monitor.
- **Próximas 2 horas**: linha do tempo das ações agendadas, com as ligações destacadas.
- **Termômetro**: mandatos por estado, reuniões marcadas hoje, NFs convertidas hoje, consumo do mês contra o teto.
- Clique em qualquer ação abre o **mandato em modal**, nunca troca de página (padrão do 04p).

### 11.2 Mandatos
Kanban por estado, filtros por agente, tipo, empresa e prioridade. **Modal do mandato** com: objetivo, plano atual em destaque (objetivo corrente, próximas ações com o porquê), linha do tempo de todas as ações, todas as conversas e ligações num só histórico, contatos tentados com resultado, consumo contra orçamento, e ações humanas — pausar, encerrar, reatribuir agente, assumir manualmente, ajustar orçamento.

**Assumir manualmente** move o mandato para `escalado`, notifica e passa o controle ao humano, mantendo o histórico. É a saída para quando a conversa merece uma pessoa.

### 11.3 Personas
CRUD de agentes: persona, linha de WhatsApp, caixa de e-mail, conta de voz, closer e substituto, escopo (com prévia: quantas empresas o filtro pega hoje), cotas, orçamento, modo de rodagem, ligar/desligar autonomia.

### 11.4 Materiais
Biblioteca (§5) com upload, `quando_usar`, canais, e uso medido.

### 11.5 Desempenho
Por agente e por playbook: mandatos concluídos, taxa de sucesso por tipo, custo por mandato concluído, **custo por reunião marcada e por NF convertida**, tempo médio até o objetivo, motivos de encerramento, eficácia por material e por canal, e a comparação com a média dos vendedores humanos no mesmo escopo.

Essa última coluna é o que decide se a IA continua. Calcular `agendou` e `converteu` de verdade — hoje nunca são apurados.

**Acesso**: Ao vivo e Mandatos para gestores e para o vendedor dono do escopo; Personas, Materiais, Desempenho e Settings só para gestores.

**Mobile**: Ao vivo e Mandatos em leitura, com push de escalação e de disjuntor. Configuração é `webOnly`.

---

## 12. Settings (Agentes, `webOnly`, gestor)

Kill switch único · orçamento mensal e alertas · política de identificação · `max_passos_por_ciclo` · intervalo do ciclo · janela de envio · horizonte de agendamento · duração e buffer de reunião · `voz_timeout_minutos` · tabela de preços do modelo e das ferramentas · limiares do disjuntor · CRUD de `mandato_regras` com prévia de impacto · playbooks por tipo de mandato.

---

## 13. Eventos, tools, notificações, entregáveis

**Eventos**: `mandato.criado`, `mandato.iniciado`, `mandato.acao_executada`, `mandato.plano_atualizado`, `mandato.escalado`, `mandato.concluido`, `mandato.encerrado`, `mandato.pausado`, `agente.disjuntor_aberto`, `agente.disjuntor_reaberto`, `agente.cota_atingida`, `orcamento.alerta`, `orcamento.esgotado`, `reuniao.agendada_por_ia`, `voz.desfecho_estruturado`.

**Notificações + push**: escalação para humano (imediato, ao gestor e ao closer quando houver) · disjuntor aberto (imediato) · orçamento em 80% e 95% · reunião marcada (ao closer) · mandato concluído com conversão · proposta de mandato aguardando aprovação. **Digest diário** por agente: o que fez, o que conseguiu, quanto custou, o que planeja.

**Tools (barra de IA)**, todas de leitura: `agentes.estado` · `agentes.mandatos` · `agentes.detalhe_mandato` · `agentes.desempenho` · `agentes.orcamento`. Criação e pausa de mandato ficam na interface — a barra de IA não comanda os agentes.

**Worker**: `agentes/ciclo` (5 min) · `agentes/criar-mandatos` (diário, avalia `mandato_regras`) · `agentes/disjuntor` (após cada ação) · `agentes/digest` (diário 18h) · `voz/varrer-orfas` (§1.5) · `agentes/reconciliar-custo` (diário).

**Core** (`packages/core/agentes/`), com testes:
- `loop.ts` — o ciclo de ferramentas com orçamento de passos. Testes: passo esgotado no meio; ferramenta paga sem orçamento; ferramenta que falha; ciclo sem `atualizar_plano`.
- `trancas.ts` — a ordem das trancas de §6.2. Testes: cada tranca isolada; duas simultâneas; fora de janela reagenda em vez de encerrar.
- `orcamento.ts` — reserva/consumo/estorno atômicos. Testes: dois mandatos concorrendo pelo mesmo saldo; custo real acima do estimado; falha após reserva.
- `disjuntor.ts` — janela móvel por contagem. Testes: janela incompleta não abre; limiar exato; reabertura manual.
- `escopo.ts` — resolução de escopo com o motor de filtros e o filtro de piloto por cima.
- `agenda.ts` — janelas livres, reserva temporária, substituto. Testes: closer sem janela; reserva expirada; duas conversas disputando o mesmo horário.
- Adapter de voz com tradução v1/v2 e consumo de desfechos estruturados. Testes: `agendar_retorno` com contato novo; `indicou_outro_contato`; objetivo não suportado pela v1.

**Docs**: `docs/agentes.md` — o que é um mandato, como nasce, como o agente decide, o catálogo de ferramentas com custos, os limites e o disjuntor, e como ler o plano de um mandato. Corrigir `docs/comunicacao.md` nas divergências listadas em §1.12 e arquivar `docs/voz.md` e `docs/voz-decisoes.md`.

---

## 14. Fora de escopo

Agente criando mandato sozinho (só propõe) · agente negociando taxa ou prazo (escala) · agente em conversa de cobrança (Prompt 07 é humano) · atendimento inbound sem mandato aberto · treinamento ou ajuste fino de modelo · transcrição e análise de reuniões (05C) · IA operando em modo `carteira` (implementado, desligado).

---

## 15. Verificações antes de começar

1. **Rota de inbound de e-mail** (§4.2) — confira o que existe e **reporte antes de implementar**.
2. **Integração Google Calendar** — confirme o escopo OAuth atual dos funcionários: leitura de disponibilidade e criação de evento com convidados. Se faltar escopo, reporte em vez de contornar.
3. **Contas de WhatsApp tipo `ia`** — hoje são 0. O cadastro de persona deve recusar ativação de agente sem linha, com mensagem clara em vez de falhar no envio.
4. **Versão da API da Ana** — detecte se responde v2; se não, opere em v1 degradado (§4.3) e registre isso no painel, visível, para ninguém achar que a capacidade existe.
