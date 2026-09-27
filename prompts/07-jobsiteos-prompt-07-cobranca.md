# JOBSITEOS — Claude Code Prompt 07: Cobrança Extrajudicial e Sinistro

> Builds on Prompts 01–05B e 08. Reuse pesado: `empresas` + regra matriz/SPE (04s), sync de produção e operações (04f/04n/04s), `comunicacoes` e compositor (05A), `contatos` + `ponto_focal` (04), calculadora de dívida e `processos` (08), esteira de crédito (04d), buckets privados + RLS, event log, notificações + push.
> **Localização**: novo item de menu **Cobrança** (tabs: Painel · Cobranças · Sinistros · Protestos · Modelos).
> UI pt-BR, código em inglês. Migrations via Supabase MCP. Nenhum segredo no código — tudo em env/Vault.

---

## 0. O que este módulo é — e o que ele NÃO é

**NÃO é** régua de cobrança de vencidos de curto prazo. Atraso de 1 a 14 dias continua sendo tratado na plataforma de produção (Onepay), como hoje. Nada aqui altera aquele fluxo.

**É** a esteira formal que começa em **D+15** com a notificação extrajudicial e vai até um de quatro desfechos: quitação, acordo cumprido, protesto/judicialização, ou sinistro pago pela seguradora.

E há uma segunda função, que é a razão de este módulo existir com esta forma: **a apólice Atradius exige, como documentação obrigatória de sinistro, exatamente os artefatos que esta esteira produz** (§7.2). Cobrar mal, ou cobrar sem registrar, não é só perder o título — é perder a indenização. O módulo é tanto ferramenta de cobrança quanto **construtor do dossiê de sinistro**.

---

## 1. Fluxo de entrada

1. Operador abre **Cobrança → Nova cobrança** e escolhe a **construtora (sacado)**. O seletor busca por razão social/CNPJ e **resolve sempre para a matriz**: escolher uma SPE seleciona o grupo inteiro.
2. O sistema lista **todos os títulos em aberto** daquele grupo (matriz + todas as SPEs/filiais), com: nº do título/NF, cedente, SPE devedora, emissão, vencimento, **dias de atraso**, valor de face, valor atualizado (§9.1), status na produção.
3. Operador **seleciona os títulos** que quer cobrar (checkbox, "selecionar todos", filtros por cedente/SPE/faixa de atraso).
4. Operador escolhe o **escopo de notificação**: `sacado` ou `sacado_e_cedente`.
5. Operador confirma. O sistema cria a cobrança, calcula os **destinatários e agrupamentos** (§4), gera as **minutas de notificação** (§5) e mostra **o alerta da apólice** (§6.4) antes do envio.

**Nada dispara sozinho.** Toda criação, todo envio, todo protesto, todo sinistro é ação humana explícita. O sistema calcula, redige, alerta e cobra prazo — quem aperta o botão é gente.

## 2. Fonte dos títulos

Reusar o sync de produção já existente (04f/04n/04s). Materializar uma projeção de títulos:

```sql
create table titulos (
  id uuid primary key default gen_random_uuid(),
  externo_id text not null unique,              -- id do título na produção
  operacao_externo_id text,
  numero text,                                   -- nº do título / duplicata
  nf_chave_acesso text,                          -- quando originado de NF
  sacado_cnpj text not null,                     -- quem deve (pode ser SPE/filial)
  sacado_matriz_cnpj text not null,              -- SEMPRE a matriz (regra 04s)
  sacado_empresa_id uuid references empresas(id),
  cedente_cnpj text not null,
  cedente_matriz_cnpj text not null,
  cedente_empresa_id uuid references empresas(id),
  valor_face numeric(14,2) not null,
  valor_cedido numeric(14,2),                    -- o que efetivamente pagamos ao cedente
  emissao date,
  vencimento date not null,                      -- VENCIMENTO ORIGINAL — nunca sobrescrever
  vencimento_prorrogado date,                    -- prorrogações acordadas, se houver
  status text not null,                          -- aberto | pago | parcial | recomprado | cancelado
  pago_em date,
  valor_pago numeric(14,2),
  coberto_apolice boolean default true,
  limite_credito_vigente numeric(14,2),
  sincronizado_em timestamptz default now()
);
create index on titulos (sacado_matriz_cnpj, status, vencimento);
create index on titulos (cedente_cnpj, status);
```

**`vencimento` é o vencimento original e é sagrado.** Toda a contagem de prazo da apólice roda sobre ele — a cláusula 16900.20 diz textualmente que a prorrogação não desloca a data usada para aplicar os termos da apólice. Prorrogação acordada vai em `vencimento_prorrogado` e serve só para a conversa comercial.

Se o endpoint de produção hoje não expõe algum destes campos (em especial `sacado_matriz_cnpj`, `valor_cedido`, `limite_credito_vigente` e `pago_em`), **gere uma doc de requisição para o time de produção** no mesmo formato da `integracao-credito-plataforma-producao` e siga com os campos disponíveis, marcando os ausentes como `null` e degradando as telas com aviso — não invente valor.

## 3. Modelo

```sql
create table cobrancas (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,                            -- COB-2026-0001, sequencial
  sacado_matriz_cnpj text not null,
  sacado_empresa_id uuid references empresas(id),
  escopo_notificacao text not null default 'sacado',   -- sacado | sacado_e_cedente
  notificar_matriz_cedente boolean default true,
  estagio text not null default 'rascunho',
    -- rascunho | notificada | em_negociacao | acordo_firmado | acordo_em_cumprimento
    -- | quitada | judicializada | encerrada_perda | cancelada
  responsavel_id uuid references usuarios(id),
  -- parâmetros de atualização da dívida (herdam do settings, editáveis POR COBRANÇA)
  juros_mora_mes numeric(6,4),
  multa_pct numeric(6,4),
  honorarios_pct numeric(6,4),
  indice_correcao text,                          -- igpm | ipca | nenhum
  data_base date,
  -- vínculo com o jurídico (Prompt 08)
  processo_id uuid references processos(id),
  convertida_em_processo_em timestamptz,
  observacoes text,
  criada_por uuid references usuarios(id),
  criada_em timestamptz default now(),
  encerrada_em timestamptz,
  motivo_encerramento text
);

create table cobranca_titulos (
  id uuid primary key default gen_random_uuid(),
  cobranca_id uuid not null references cobrancas(id) on delete cascade,
  titulo_id uuid not null references titulos(id),
  -- snapshot no momento da inclusão (a produção pode mudar; o dossiê não pode)
  valor_face_snapshot numeric(14,2) not null,
  vencimento_snapshot date not null,
  dias_atraso_snapshot int not null,
  situacao text not null default 'em_cobranca',  -- em_cobranca | quitado | acordado | protestado | sinistrado | retirado
  quitado_em date,
  valor_recebido numeric(14,2),
  unique (cobranca_id, titulo_id)
);
-- um título só pode estar em UMA cobrança ativa
create unique index titulo_cobranca_ativa on cobranca_titulos (titulo_id)
  where situacao in ('em_cobranca','acordado','protestado','sinistrado');
```

## 4. Agrupamento e destinatários — a regra que faz o módulo funcionar

Confirmada a cobrança, o sistema calcula o conjunto de **notificações** (não de títulos). A regra, literal:

**Sacado**
- **Uma notificação para a matriz**, contendo **TODOS os títulos selecionados, de TODAS as SPEs/filiais do grupo**. A matriz responde pelo conjunto.
- **Uma notificação para cada SPE/filial devedora**, contendo **apenas os títulos dela**.
- **Dedup obrigatório**: se `sacado_cnpj = sacado_matriz_cnpj` no título, ele entra só na notificação consolidada da matriz — a matriz nunca recebe duas cartas.
- Se o grupo tem uma única entidade devedora e ela é a matriz, sai **uma** notificação.

**Cedente** (só quando `escopo_notificacao = 'sacado_e_cedente'`)
- **Uma notificação por cedente**, agrupando **todos os títulos daquele cedente na cobrança**, independentemente de qual SPE do sacado deve.
- Mesma regra matriz/filial, aplicada ao cedente, quando `notificar_matriz_cedente = true` (default, editável na tela de confirmação): matriz do cedente recebe o consolidado, filial recebe o dela, com o mesmo dedup.

```sql
create table cobranca_notificacoes (
  id uuid primary key default gen_random_uuid(),
  cobranca_id uuid not null references cobrancas(id) on delete cascade,
  papel text not null,                    -- sacado_matriz | sacado_filial | cedente_matriz | cedente_filial
  destinatario_cnpj text not null,
  destinatario_empresa_id uuid references empresas(id),
  destinatario_razao_social text not null,
  destinatario_endereco jsonb,            -- cadastral Receita, editável antes do envio
  modelo_id uuid references cobranca_modelos(id),
  rodada int not null default 1,          -- 1 = notificação inicial; 2+ = reiterações
  valor_total numeric(14,2) not null,
  qtd_titulos int not null,
  prazo_pagamento_dias int not null,
  prazo_expira_em date,
  documento_path text,                    -- PDF no bucket privado
  documento_hash text,
  status text not null default 'rascunho', -- rascunho | pronta | enviada | entregue | falhou | respondida
  gerada_em timestamptz default now(),
  enviada_em timestamptz,
  unique (cobranca_id, destinatario_cnpj, rodada)
);

create table cobranca_notificacao_titulos (
  notificacao_id uuid references cobranca_notificacoes(id) on delete cascade,
  cobranca_titulo_id uuid references cobranca_titulos(id) on delete cascade,
  primary key (notificacao_id, cobranca_titulo_id)
);

create table cobranca_notificacao_entregas (
  id uuid primary key default gen_random_uuid(),
  notificacao_id uuid not null references cobranca_notificacoes(id) on delete cascade,
  canal text not null,                    -- email | whatsapp | correio_ar | cartorio_td | entrega_pessoal
  destino text,                           -- e-mail, telefone ou endereço
  contato_id uuid references contatos(id),
  comunicacao_id uuid references comunicacoes(id),   -- ledger do 05A
  codigo_rastreio text,                   -- AR dos Correios / protocolo do cartório de TD
  comprovante_path text,                  -- upload do AR digitalizado / certidão
  status text not null default 'pendente', -- pendente | enviado | entregue | recusado | devolvido
  enviado_em timestamptz,
  confirmado_em timestamptz,
  observacao text
);
```

**Canais.** E-mail (Resend) e WhatsApp (Wasender) saem do sistema e registram no ledger `comunicacoes` (05A) normalmente — mesma thread da empresa, mesma supressão, mesmo ponto focal. **Correio com AR e cartório de Títulos e Documentos são canais manuais**: o sistema gera o PDF pronto para impressão/protocolo e o operador devolve `codigo_rastreio` e o comprovante digitalizado. Essa prova de entrega é item obrigatório do dossiê de sinistro; a tela de sinistro (§7) bloqueia o envio enquanto ela faltar, com opção de justificar a ausência.

**Destinatários pessoa-a-pessoa**: puxar de `contatos` da empresa, priorizando `ponto_focal` e cargos financeiro/jurídico. Endereço físico vem do cadastral da Receita, **editável antes do envio** (endereço de Receita desatualizado é a causa nº 1 de AR devolvido).

## 5. Notificação extrajudicial (D+15)

**Modelos versionados**, editáveis por gestor:

```sql
create table cobranca_modelos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,          -- notificacao_sacado | notificacao_cedente | reiteracao
                               -- | confissao_divida_simples | confissao_divida_aval
                               -- | confissao_divida_af | confissao_divida_garantia_real
  nome text not null,
  versao int not null default 1,
  ativo boolean default true,
  corpo_markdown text not null,   -- com placeholders
  criado_por uuid references usuarios(id),
  criado_em timestamptz default now()
);
```

Placeholders disponíveis (validar na gravação do modelo; placeholder desconhecido = erro, não string vazia): `{{destinatario.razao_social}}`, `{{destinatario.cnpj}}`, `{{destinatario.endereco}}`, `{{credor.razao_social}}`, `{{credor.cnpj}}`, `{{tabela_titulos}}`, `{{valor_total_face}}`, `{{valor_total_atualizado}}`, `{{data_base}}`, `{{prazo_dias}}`, `{{prazo_data}}`, `{{dados_pagamento}}`, `{{cobranca.codigo}}`, `{{data_hoje}}`.

`{{tabela_titulos}}` renderiza a tabela dos títulos **daquela notificação** (nº, NF, cedente, SPE devedora, emissão, vencimento, dias de atraso, valor de face, valor atualizado) — a notificação da matriz mostra a coluna "SPE devedora"; a da SPE não mostra.

Render → **PDF** (mesma stack de PDF do report semanal, 04q) → bucket privado `cobrancas/` com RLS → `documento_hash` (SHA-256) gravado. **O PDF enviado é imutável**: qualquer alteração gera nova rodada, nunca sobrescreve.

Conteúdo mínimo exigido no modelo padrão de seed: qualificação de credor e devedor, origem do crédito (contrato de cessão + NF/duplicata), relação dos títulos, valor atualizado com memória de cálculo, prazo para pagamento (config, default **5 dias úteis**), meios de pagamento, e a consequência do silêncio (protesto, negativação, execução judicial e comunicação à seguradora).

**Reiterações**: botão "Nova rodada" gera `rodada = n+1` com o valor atualizado na data, mantendo todo o histórico. Config `dias_para_reiteracao` (default 15) só gera **lembrete** ao responsável — não dispara nada.

## 6. Relógio da apólice Atradius — o motor de prazos

Esta é a parte que não pode falhar. Os prazos abaixo saem da apólice **9000373_SUSEP** (Construcredit Securitizadora, vigência 01/06/2026–31/05/2027). Todos os números vão para `apolice_config` — **nada hardcoded**, porque a renovação anual muda parâmetro.

```sql
create table apolices (
  id uuid primary key default gen_random_uuid(),
  seguradora text not null default 'Atradius Crédito y Caución',
  numero text not null,                          -- 9000373_SUSEP
  segurado_cnpj text not null,
  vigencia_inicio date not null,
  vigencia_fim date not null,
  percentagem_segurada numeric(5,4) not null,    -- 0.90
  periodo_espera_dias int not null,              -- 180 (6 meses)
  prazo_maximo_credito_dias int not null,        -- 180
  periodo_max_prorrogacao_dias int not null,     -- 60
  prazo_notificacao_apos_prorrogacao_dias int not null,  -- 30
  prazo_envio_sinistro_meses int not null,       -- 6, contados da Data da Perda
  prazo_documentos_complementares_dias int not null,     -- 30
  franquia numeric(14,2) not null,               -- 20000.00
  responsabilidade_maxima numeric(16,2),         -- 11.520.000
  ativa boolean default true
);
```

### 6.1 A régua (D = vencimento ORIGINAL do título)

| Marco | Quando | O que é | Consequência de perder |
|---|---|---|---|
| **D+60** | fim do *período máximo de prorrogação* | **Parada automática de cobertura** (cl. 17700.20 a) | Novas cessões daquele sacado deixam de ser cobertas |
| **D+90** | 30 dias após D+60 | **Prazo final para notificar a Atradius** do inadimplemento (cl. 18500.01) | **Perda do direito à indenização** (cl. 28509.01 iv) |
| **D+180** | fim do *período de espera* | **Data da Perda** por Mora Prolongada (cl. 00500.00) | — (é o gatilho que abre o direito) |
| **D+360** | 6 meses após a Data da Perda | **Prazo final para enviar o sinistro completo** (cl. 22100.20 §1) | Sinistro inadmissível |
| sob demanda | 30 dias da solicitação | **Documentos complementares** pedidos pela seguradora | Suspensão/negativa da análise |

**Insolvência** (cl. 00300.00) não segue esse calendário: a Data da Perda é a data da decisão judicial (ou do evento equivalente), e o prazo de 6 meses corre a partir dela. Quando o Jurídico (Prompt 08) detecta recuperação judicial/falência do sacado, o relógio **recalcula para o caminho de insolvência** e o prazo de D+360 é substituído por `data_decisao + 6 meses`. Alertar no ato — esse caso costuma ser mais curto que o de mora.

### 6.2 Tabela de prazos

```sql
create table apolice_prazos (
  id uuid primary key default gen_random_uuid(),
  apolice_id uuid not null references apolices(id),
  titulo_id uuid not null references titulos(id),
  cobranca_id uuid references cobrancas(id),
  causa text not null default 'mora_prolongada',  -- mora_prolongada | insolvencia
  vencimento_original date not null,
  data_parada_cobertura date not null,            -- D+60
  data_limite_notificacao date not null,          -- D+90
  data_perda date not null,                       -- D+180 ou data da decisão
  data_limite_sinistro date not null,             -- Data da Perda + 6 meses
  notificado_seguradora_em date,
  sinistro_id uuid references sinistros(id),
  status text not null default 'ativo',           -- ativo | cumprido | perdido | encerrado_pagamento
  calculado_em timestamptz default now(),
  unique (titulo_id, apolice_id)
);
```

### 6.3 Job `cobranca/relogio-apolice` (diário, 06:00)

1. Para todo `titulo` com `status = 'aberto'`, `coberto_apolice = true` e `vencimento < hoje`, criar/atualizar `apolice_prazos`.
2. Fechar (`status = 'encerrado_pagamento'`) os prazos de títulos que foram pagos — **e registrar se o pagamento entrou dentro dos 30 dias após D+60**, porque nesse caso a cobertura se restabelece **com efeito retroativo** (cl. 17700.20 a). Pago depois disso, a cobertura volta só para recebíveis cedidos **após a data do pagamento**. Gravar `restabelecimento_retroativo boolean` e mostrar isso na ficha do sacado — é dinheiro.
3. Gerar alertas escalonados (config `alertas_dias_antes`, defaults abaixo), cada um com **push + e-mail + item no Meu Dia** do responsável e do gestor:
   - **D+45** — "faltam 15 dias para a parada automática de cobertura deste sacado" (aviso).
   - **D+75** — "faltam 15 dias para o prazo de notificação à seguradora" (alto).
   - **D+85** — **crítico, diário até resolver**: "5 dias para perder o direito à indenização".
   - **D+150** — "Data da Perda em 30 dias; prepare o dossiê".
   - **D+300** e **D+345** — prazo de envio do sinistro.
4. Nunca enviar nada à seguradora sozinho. O alerta é a ação.

O **Painel de Cobrança** abre com um bloco "Relógio da apólice": contagem regressiva por faixa, com os títulos em risco de perda ordenados por dias restantes. Esse bloco é a primeira coisa que o gestor vê ao abrir o módulo.

### 6.4 O aviso que aparece ANTES do primeiro envio

Ao confirmar uma cobrança, mostrar modal de confirmação com:

> **Atenção — efeito na apólice.** Colocar valores deste sacado em cobrança é uma circunstância de Interrupção Automática de Cobertura (cl. 17700.20 b). A partir de agora, **novos recebíveis cedidos contra este sacado não estarão cobertos** até que os valores em aberto sejam pagos. Após o pagamento, a cobertura volta a valer para recebíveis cedidos **a partir da data do pagamento**.

Exigir aceite explícito (checkbox + registro de quem aceitou no event log). Esse aviso já poupou o problema uma vez: a equipe comercial não pode descobrir isso depois.

## 7. Sinistro

### 7.1 Modelo

```sql
create table sinistros (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,                       -- SIN-2026-0001
  apolice_id uuid not null references apolices(id),
  cobranca_id uuid references cobrancas(id),
  sacado_matriz_cnpj text not null,
  sacado_empresa_id uuid references empresas(id),
  causa text not null,                      -- mora_prolongada | insolvencia
  data_perda date not null,
  valor_total_face numeric(14,2) not null,
  valor_recebido_parcial numeric(14,2) default 0,
  perda_segurada_estimada numeric(14,2),    -- §7.3
  indenizacao_estimada numeric(14,2),
  indenizacao_recebida numeric(14,2),
  estagio text not null default 'preparacao',
    -- preparacao | notificado | enviado | em_analise | docs_pendentes
    -- | aceito | recusado | indenizado | encerrado
  notificado_em date,                       -- cl. 18500.01 — o D+90
  enviado_em date,
  resposta_prevista_em date,                -- enviado_em + 120 dias
  respondido_em date,
  motivo_recusa text,
  modo_envio text not null default 'manual', -- manual | api
  protocolo_externo text,
  responsavel_id uuid references usuarios(id),
  criado_em timestamptz default now()
);

create table sinistro_titulos (
  sinistro_id uuid references sinistros(id) on delete cascade,
  titulo_id uuid references titulos(id),
  valor_face numeric(14,2) not null,
  valor_cedido numeric(14,2),
  primary key (sinistro_id, titulo_id)
);

create table sinistro_documentos (
  id uuid primary key default gen_random_uuid(),
  sinistro_id uuid not null references sinistros(id) on delete cascade,
  item text not null,                       -- chave do checklist (§7.2)
  obrigatorio boolean default true,
  origem text not null default 'sistema',   -- sistema | upload | nao_aplicavel
  arquivo_path text,
  arquivo_hash text,
  justificativa_ausencia text,
  status text not null default 'pendente',  -- pendente | ok | nao_aplicavel
  anexado_por uuid references usuarios(id),
  anexado_em timestamptz
);

create table sinistro_solicitacoes (          -- pedidos de doc complementar da seguradora
  id uuid primary key default gen_random_uuid(),
  sinistro_id uuid not null references sinistros(id) on delete cascade,
  descricao text not null,
  solicitada_em date not null,
  prazo_em date not null,                    -- solicitada_em + 30 dias
  respondida_em date,
  status text not null default 'aberta'      -- aberta | respondida | vencida
);

create table sinistro_custos (                -- cl. 20700.20
  id uuid primary key default gen_random_uuid(),
  sinistro_id uuid references sinistros(id) on delete cascade,
  cobranca_id uuid references cobrancas(id),
  descricao text not null,
  valor numeric(14,2) not null,
  data date not null,
  aprovado_pela_seguradora boolean default false,
  aprovacao_referencia text,                 -- e-mail/protocolo da aprovação prévia
  comprovante_path text
);
```

**`sinistro_custos.aprovado_pela_seguradora` não é burocracia**: a cl. 20700.20 só reembolsa custos de cobrança incorridos **com aprovação prévia ou por instrução** da seguradora. Custo lançado sem aprovação prévia entra no painel marcado em vermelho como "provável não reembolsável" — para o time parar de gastar às cegas.

### 7.2 Checklist do dossiê (cl. 22208.00 — literal da apólice)

Ao criar um sinistro, semear `sinistro_documentos` com os 16 itens, já **auto-resolvendo** do que o sistema tem:

| # | Item | Origem no JobsiteOS |
|---|---|---|
| a | Pedidos/Contratos | upload |
| b | Termos e condições da venda | upload |
| c | Faturas | **auto** — XML/DANFE das NFs (04) |
| d | Comprovante de entrega | upload |
| e | Letras de câmbio e outros títulos | upload / n/a |
| f | Cópia de garantia de terceiros | upload / n/a |
| g | Correspondência de cobrança, inclusive protesto e SERASA/PFIN | **auto** — notificações (§5) + certidão de protesto (§8) |
| h | Notificação formal de insolvência | **auto** — Jurídico (08) quando houver RJ/falência |
| i | Registro de dívida | **auto** — extrato de `cobranca_titulos` |
| j | Confirmação de dívida | **auto** — confissão de dívida assinada (§9.3), se houver |
| k | Lista de faturas em aberto | **auto** |
| l | Extrato completo da conta dos 12 meses anteriores ao vencimento | **auto** — histórico de operações do sacado |
| m | Procuração com cláusula ad judicia | upload |
| n | Contrato e aditivos de cessão de direitos creditórios registrados em cartório | upload |
| o | Notificações ao sacado sobre a titularidade do crédito e sobre o não pagamento | **auto** — §5 + notificação de cessão |
| p | Notificação ao cedente pela inadimplência | **auto** — §5, quando `escopo = sacado_e_cedente` |

Onde diz **auto**, o sistema monta o PDF e marca `origem = 'sistema'`. Um item obrigatório só pode ficar de fora com `justificativa_ausencia` preenchida — e a justificativa entra no corpo do envio.

**Botão "Gerar dossiê"**: produz um **ZIP com índice** (`00-indice.pdf` listando item por item, com hash de cada arquivo) e um **sumário executivo em PDF** com qualificação das partes, relação dos títulos, cronologia completa da cobrança (todo o event log renderizado) e memória de cálculo da perda. É esse pacote que vai para a seguradora, por API ou por e-mail.

### 7.3 Cálculo da perda e da indenização (cl. 22100.20 §3)

```
perda_segurada  = valor devido pelo Comprador na Interrupção Automática de Cobertura
                  − recebíveis não segurados
                  − créditos do Comprador (pagamentos, notas de crédito, abatimentos,
                    descontos, compensações, reconvenção, produto de garantias,
                    produto da revenda de bens recuperados)

indenizacao     = percentagem_segurada × MIN(perda_segurada, limite_credito_vigente)
indenizacao     = MIN(indenizacao, valor efetivamente pago/comprometido ao cedente)

se perda_segurada ≤ franquia  →  não indenizável (cl. 26100.00)
```

Mostrar a conta **aberta, linha a linha**, com cada dedução nomeada e sua origem. Ninguém deve descobrir o teto da indenização no e-mail de recusa.

A franquia de R$ 20.000 é **por Comprador** — o que reforça a lógica de §4: consolidar todos os títulos do grupo do sacado num único sinistro, em vez de fatiar por SPE e cair abaixo da franquia em cada fatia.

### 7.4 Integração com a Atradius — o que existe hoje

A Atradius publica uma **Non-Payments API** (`api.atradius.com/non-payments`), da mesma família OAuth 2.0 das Buyers/Cover/Policy APIs que já usamos, com sandbox. Ela cobre submissão de aviso de não pagamento, validação automática de elegibilidade, acompanhamento de status, alertas e relatórios. **Mas o acesso é liberado por registro/entitlement por apólice** — não é self-serve, e não temos a credencial hoje.

Portanto, implementar com **adapter e dois modos**, selecionáveis em settings:

- **`manual` (default, funciona no dia 1)** — o sistema monta o dossiê, gera o e-mail formal com o ZIP e o sumário, endereçado ao contato da apólice (broker/gestor de conta), registra `notificado_em`, `enviado_em`, e o operador cola o protocolo de resposta em `protocolo_externo`.
- **`api` (atrás de feature flag)** — `packages/core/atradius/non-payments.ts` com `notificarNaoPagamento()`, `enviarSinistro()`, `consultarStatus()`, `enviarDocumentos()`. Reusar o client OAuth já existente das Buyer/Cover APIs, só trocando o escopo. Manter o payload mapeado a partir das mesmas estruturas do modo manual, de forma que **ligar a API não mude o dossiê, só o transporte**.

Regra inegociável: **o prazo nunca depende da API**. Se a chamada falhar, o alerta continua vermelho e o modo manual continua disponível no mesmo botão. Um prazo de apólice não pode morrer por 500.

Adicionar ao roadmap a tarefa externa: *"solicitar acesso à Non-Payments API em api.atradius.com/register-now, referenciando a apólice 9000373_SUSEP"*.

## 8. Protesto

**Sim, é possível protestar eletronicamente — mas não existe API pública de auto-serviço.** O caminho real é:

1. **Firmar convênio como apresentante** com o IEPTB/CRA do estado (em SP, IEPTB-SP/CENPROT; cada estado tem seu CRA, e a maioria opera o padrão CRA/CRA21 de troca de arquivos XML).
2. Conveniado, há dois canais: o **portal** (digitação, planilha ou XML da NF-e) e a **troca eletrônica de arquivos / API** liberada para o apresentante.
3. Exige **certificado digital e-CNPJ ICP-Brasil da apresentante**. Importante: os certificados que já temos são **dos cedentes** (usados para NF-e). Para protestar, quem apresenta é a nossa entidade cessionária — é preciso o e-CNPJ dela, que é outro certificado.
4. Abrangência é **estadual**: o convênio de SP não protesta título de devedor no PR. Rollout por UF, priorizando onde está a carteira.

Implementação, com o mesmo padrão de adapter:

```sql
create table protesto_remessas (
  id uuid primary key default gen_random_uuid(),
  cobranca_id uuid references cobrancas(id),
  uf text not null,
  cra text not null,                        -- CENPROT-SP, CRA-PR, ...
  modo text not null default 'portal_manual',  -- portal_manual | api
  arquivo_path text,                        -- XML/remessa gerada
  protocolo text,
  enviada_em timestamptz,
  status text not null default 'rascunho',  -- rascunho | enviada | confirmada | rejeitada
  retorno_path text,
  retorno_processado_em timestamptz
);

create table protesto_titulos (
  id uuid primary key default gen_random_uuid(),
  remessa_id uuid references protesto_remessas(id) on delete cascade,
  cobranca_titulo_id uuid references cobranca_titulos(id),
  cartorio text,
  protocolo_cartorio text,
  situacao text not null default 'enviado',
    -- enviado | apontado | protestado | pago_em_cartorio | retirado | sustado | rejeitado
  data_protesto date,
  certidao_path text,
  custas numeric(12,2),
  motivo_rejeicao text
);
```

Modo **`portal_manual`** (default): o sistema monta a remessa no layout do CRA de destino, o operador envia pelo portal e sobe o retorno; o parser lê o retorno e atualiza `situacao`. Modo **`api`**: liberado por UF conforme o convênio for assinado. **Instruções de desistência/cancelamento** seguem o mesmo caminho e são obrigatórias após quitação (§11) — protesto não retirado depois de pago vira dano moral contra nós.

A **certidão de protesto entra automaticamente no item (g) do dossiê de sinistro**. É por isso que protestar antes de sinistrar quase sempre compensa.

Tarefa externa para o roadmap: *"assinar convênio de apresentante com IEPTB-SP (ieptbsp@ieptbsp.com.br, 11 2189-9666) e emitir e-CNPJ ICP-Brasil da cessionária"*.

## 9. Acordo

**Escopo desta versão: calculadora e minuta. Nada de boleto, nada de acompanhamento de cumprimento** — boleto continua na plataforma de produção, e o acompanhamento automático do acordo fica para depois.

### 9.1 Calculadora de dívida atualizada

Reusar `packages/core/divida/calculadora.ts` do Prompt 08 — **não duplicar**. Estender apenas com os parâmetros por cobrança:

```
principal        = Σ valor_face dos títulos selecionados
correcao         = principal × (índice[data_base] / índice[vencimento] − 1)   [se índice ≠ nenhum]
juros_mora       = (principal + correcao) × juros_mora_mes × (dias_atraso / 30)
multa            = (principal + correcao) × multa_pct
subtotal         = principal + correcao + juros_mora + multa
honorarios       = subtotal × honorarios_pct
total_atualizado = subtotal + honorarios
```

Defaults em settings (editáveis por cobrança, com o valor herdado mostrado ao lado): juros **1% a.m.**, multa **2%**, honorários **10%**, índice **IGP-M**, data base **hoje**. Juros pro rata die por padrão (`juros_pro_rata` config, default true).

Saída sempre com **memória de cálculo linha a linha**, exportável — vai para a notificação, para a minuta e para o dossiê.

### 9.2 Simulador de parcelamento

Entradas: nº de parcelas, entrada (valor ou %), data da primeira parcela, periodicidade, taxa de juros do parcelamento (% a.m.), sistema (**Price** ou **SAC**).
Saídas: tabela parcela a parcela (vencimento, amortização, juros, valor), **valor total projetado**, custo total do parcelamento vs. à vista, e comparação lado a lado de até **3 cenários**. Cenário escolhido é salvo:

```sql
create table acordos (
  id uuid primary key default gen_random_uuid(),
  cobranca_id uuid not null references cobrancas(id),
  valor_atualizado numeric(14,2) not null,
  memoria_calculo jsonb not null,
  entrada numeric(14,2) default 0,
  qtd_parcelas int not null default 1,
  periodicidade text default 'mensal',
  juros_parcelamento_mes numeric(6,4) default 0,
  sistema text default 'price',             -- price | sac
  primeira_parcela date,
  valor_total_projetado numeric(14,2),
  parcelas jsonb not null,                  -- cronograma completo
  modelo_minuta_id uuid references cobranca_modelos(id),
  minuta_path text,
  documento_assinado_path text,
  status text not null default 'simulado',  -- simulado | minuta_gerada | assinado | cancelado
  criado_por uuid references usuarios(id),
  criado_em timestamptz default now()
);
```

### 9.3 Minuta de confissão de dívida

Gerada a partir de `cobranca_modelos` do tipo `confissao_divida_*`. Seeds obrigatórios:
- **Simples** — confissão pura, sem garantia.
- **Com aval** — bloco de qualificação do(s) avalista(s) pessoa física, com CPF, estado civil e endereço.
- **Com alienação fiduciária** — bloco de descrição do bem alienado.
- **Com garantia real** — bloco de hipoteca/penhor com matrícula/identificação.

Placeholders adicionais: `{{tabela_parcelas}}`, `{{valor_confessado}}`, `{{memoria_calculo}}`, `{{avalistas}}`, `{{bem_garantia}}`, `{{foro}}`, `{{testemunhas}}`. Render → PDF no bucket privado. **Assinatura eletrônica fica fora de escopo** nesta versão; o campo `documento_assinado_path` aceita upload do documento assinado, e esse upload é o que move o acordo para `assinado` e a cobrança para `acordo_firmado`.

## 10. Conversão em processo

Botão **"Converter em processo judicial"** na cobrança. Duas rotas:

- **Vincular a processo existente** — busca em `processos` (Prompt 08) por número CNJ ou parte.
- **Criar processo** — abre o formulário de `processos` pré-preenchido com partes, valor da causa (= total atualizado), e os documentos já produzidos anexados.

Em qualquer rota: gravar `cobrancas.processo_id` e `convertida_em_processo_em`, preencher `processos.vinculo_cobranca_id` (campo já reservado no Prompt 08), mover `estagio → 'judicializada'` e **linkar todos os títulos da cobrança ao processo** (`processo_titulos`). A partir daí a tela do processo mostra a relação de títulos e a cobrança de origem, e a cobrança mostra o processo — navegação nos dois sentidos, sem duplicar dado.

**A cobrança não fecha ao virar processo.** Prazo de apólice continua correndo, dossiê continua sendo montado, e o ajuizamento é justamente uma das "Ações para minimizar perdas" que a cl. 90253.00 exige — o número do processo entra no dossiê como prova de que agimos.

## 11. Bloqueio e regularização do sacado

**Bloqueio.** Quando uma cobrança atinge `estagio = 'notificada'` (config `estagio_que_bloqueia`), setar em `empresas`:

```sql
alter table empresas add column bloqueio_cobranca boolean default false;
alter table empresas add column bloqueio_cobranca_motivo text;
alter table empresas add column bloqueio_cobranca_em timestamptz;
alter table empresas add column bloqueio_cobranca_cobranca_id uuid references cobrancas(id);
```

O bloqueio é **de grupo**: aplica à matriz e propaga a todas as SPEs/filiais. Efeitos:
- Esteira de crédito (04d) recusa novas análises e **suspende limites vigentes** daquele grupo.
- Funil de NFs (04) e Sacados por NF (04r/04s) marcam os cards com selo vermelho "Em cobrança" e bloqueiam a solicitação de operação.
- Pré-autorizações (04s) daquele sacado são recusadas com motivo explícito.
- Campanhas e sequências (05B) suprimem o grupo automaticamente.

**Regularização.** Quando **todos** os títulos de **todas** as cobranças ativas do grupo estiverem `quitado`, o sistema:
1. Habilita o botão **"Regularizar sacado"** (ação humana, gestor apenas) com um resumo do que foi pago e quando.
2. Ao confirmar: limpa o bloqueio, registra evento `cobranca.sacado_regularizado`.
3. **Dispara as instruções de retirada de protesto** pendentes (§8) — bloqueando a regularização até que cada protesto tenha instrução de cancelamento enviada ou seja marcado como não aplicável.
4. Encerra os `apolice_prazos` com `status = 'encerrado_pagamento'` e calcula `restabelecimento_retroativo` (§6.3 item 2), mostrando ao gestor **a partir de que data novas cessões voltam a ser cobertas**.
5. Coloca o limite de crédito em `revisao_pos_inadimplencia` na esteira (04d) — o limite **não volta sozinho ao valor anterior**. Config `restaurar_limite_automaticamente` (default **false**) permite mudar isso, mas o default é exigir decisão humana. Quem já não pagou uma vez merece uma segunda olhada, não um carimbo.

Quitação parcial não regulariza: mantém o bloqueio e mostra o saldo remanescente.

## 12. Estágios e painel

**Kanban de cobranças** por `estagio`, com filtros por responsável, sacado, faixa de atraso, valor e risco de prazo de apólice.

**Card da cobrança**: sacado (matriz + nº de SPEs envolvidas), nº de títulos, valor de face, valor atualizado, dias desde a notificação, próximo prazo de apólice com contagem regressiva colorida, selos de protesto/sinistro/processo.

**Painel** (topo do módulo, acesso restrito a gestores para os números consolidados):
- Bloco **Relógio da apólice** (§6.3) — sempre primeiro.
- Aging da carteira em cobrança (15–30, 31–60, 61–90, 91–180, 180+).
- Valor em cobrança · recuperado no mês · recuperado nos últimos 12 meses · taxa de recuperação.
- Sinistros por estágio, com valor estimado de indenização e prazos.
- Protestos por situação.
- Custos de cobrança, separando **aprovados pela seguradora** de **não aprovados**.

**Mobile**: consulta e acompanhamento (lista, card, prazos, histórico) + registro de contato. **Criação de cobrança, envio de notificação, protesto e sinistro são `webOnly`** — são atos com consequência jurídica e não se faz isso no celular entre uma reunião e outra.

## 13. Settings (Cobrança, `webOnly`, acesso de gestor)

**Cobrança**: `dias_inicio_cobranca` (15) · `prazo_pagamento_dias` (5 úteis) · `dias_para_reiteracao` (15) · `estagio_que_bloqueia` (notificada) · motivos de encerramento · canais habilitados por padrão.
**Cálculo**: juros de mora (1% a.m.) · multa (2%) · honorários (10%) · índice de correção (IGP-M) · `juros_pro_rata` (true).
**Apólice**: CRUD de `apolices` com todos os parâmetros de §6 · `alertas_dias_antes` por marco · contato da seguradora · modo de envio (`manual`/`api`).
**Protesto**: convênios por UF (CRA, modo, credenciais no Vault) · custas padrão · `retirar_protesto_ao_quitar` (true, não desabilitável sem justificativa).
**Modelos**: CRUD versionado de notificações e confissões de dívida, com pré-visualização renderizada em dados de exemplo.
**Regularização**: `restaurar_limite_automaticamente` (false).

## 14. Eventos, tools, notificações, entregáveis

**Eventos** (em `empresa_eventos`, na empresa do sacado e na do cedente quando couber): `cobranca.criada`, `cobranca.notificacao_gerada`, `cobranca.notificacao_enviada`, `cobranca.notificacao_entregue`, `cobranca.reiteracao`, `cobranca.titulo_quitado`, `cobranca.acordo_simulado`, `cobranca.acordo_assinado`, `cobranca.convertida_em_processo`, `cobranca.encerrada`, `cobranca.sacado_bloqueado`, `cobranca.sacado_regularizado`, `protesto.remessa_enviada`, `protesto.apontado`, `protesto.protestado`, `protesto.retirado`, `sinistro.criado`, `sinistro.notificado`, `sinistro.enviado`, `sinistro.doc_solicitado`, `sinistro.aceito`, `sinistro.recusado`, `sinistro.indenizado`, `apolice.prazo_alerta`, `apolice.prazo_perdido`.

**Notificações + push**: todos os marcos de §6.3 (responsável + gestor); notificação entregue/devolvida; título quitado dentro de cobrança; resposta da seguradora; protesto efetivado; acordo assinado. O marco **D+85** notifica diariamente até ser resolvido, e aparece no topo do **Meu Dia** (04p) do responsável.

**Tools (AI bar)** — todas **read-only ou draft-only**, coerente com "tudo humano":
`cobranca.listar` · `cobranca.detalhe` · `cobranca.titulos_em_aberto` (por construtora) · `cobranca.simular_atualizacao` · `cobranca.simular_parcelamento` · `cobranca.prazos_apolice` (o que vence e quando) · `cobranca.rascunhar_notificacao` (gera rascunho, **não envia**) · `sinistro.checklist` (o que falta no dossiê).
Nenhuma tool envia notificação, protesta, abre sinistro ou bloqueia sacado.

**Worker**: `cobranca/relogio-apolice` (diário 06:00) · `cobranca/atualizar-titulos` (após cada sync de produção; fecha títulos pagos e atualiza cobranças) · `cobranca/lembretes` (diário; reiterações vencidas, prazos de documentos complementares, protestos a retirar) · `protesto/processar-retorno` (ao subir arquivo de retorno).

**Core** (`packages/core/cobranca/`), com testes:
- `agrupamento.ts` — a regra matriz/SPE/cedente de §4. **Testes obrigatórios**: título cujo sacado é a própria matriz (não duplica); grupo com 1 SPE; grupo com 5 SPEs e 3 cedentes; cedente com filial; `escopo = 'sacado'` (nenhuma notificação de cedente); seleção com títulos de dois grupos diferentes (deve recusar).
- `relogio-apolice.ts` — os quatro marcos, o caminho de insolvência, o restabelecimento retroativo de 30 dias. **Testes**: vencimento em fim de semana; título pago em D+85; título pago em D+95; mudança de causa de mora para insolvência no meio; apólice renovada com parâmetros diferentes no meio da contagem.
- `perda.ts` — cálculo de §7.3 com franquia, percentagem segurada, teto do limite de crédito e teto do valor pago ao cedente. **Testes**: perda abaixo da franquia; perda acima do limite; recuperação parcial antes da Data da Perda.
- `dossie.ts` — montagem do ZIP, índice e hashes.
- Calculadora de dívida e parcelamento: **importar do Prompt 08**, estender, não reescrever.

**Docs** (README do módulo): a régua de prazos da apólice em tabela, com a cláusula de origem ao lado de cada número; por que colocar em cobrança interrompe a cobertura; o que muda quando o modo passa de `manual` para `api`; o que é preciso assinar para protestar em cada UF; e o aviso de que os parâmetros de apólice são anuais e devem ser revistos em toda renovação.

## 15. Fora de escopo

Boleto e conciliação de pagamento de acordo (continuam na plataforma de produção) · acompanhamento automático de cumprimento de acordo · assinatura eletrônica das minutas · negativação em bureaus (Serasa/PFIN) · cobrança de pessoa física · honorários de escritório terceirizado e repasse · automação de qualquer etapa (por decisão explícita: tudo humano nesta versão).
