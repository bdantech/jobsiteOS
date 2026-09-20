# JOBSITEOS — Claude Code Prompt 04r: Sacados por NF
## Funil de aquisição de sacado, evidenciado pelas notas que nossos fornecedores já emitem

> Builds on Prompts 01–05B. Reuse pesado: `notas_fiscais` + sync (04/04e), funil de NFs e seus componentes de card/kanban, esteira de crédito (04d/04j) e precificação (04o), scorecard e chance de concessão (04d), faturamento estimado (04c), Radar/lotes de protesto (03), `vendedor_carteira` e comissões (04g/04k), `pedidos_apresentacao` e compositor/Agente (05A), supressão, event log. UI pt-BR, code English. Migrations via Supabase MCP.
> **Localização**: nova aba no menu **Antecipação → Sacados por NF** (ao lado do funil de NFs, que é seu irmão direto).
> **Absorve e substitui** a aba "Sacados a prospectar" criada como placeholder no Prompt 04 — remover a antiga, migrando qualquer estado útil.

---

## 1. Conceito

Temos certificado digital de boa parte dos nossos **cedentes**, então enxergamos **todas as notas que eles emitem** — inclusive contra construtoras que ainda **não são nossas clientes**. Cada uma dessas construtoras é um sacado em potencial com **fluxo comercial observado**, não inferido.

**Diferença essencial para o funil de NFs (04)**: lá o sacado tem crédito aprovado e a pergunta é "o fornecedor vai antecipar?". Aqui o sacado **não tem análise**, e a pergunta é "conseguimos operar isso?". O gargalo é a esteira de crédito, não a conversa comercial. Por isso é funil próprio, com estágios e métricas próprias — reusando o componente de card e o shell de kanban para parecer a mesma casa.

**A unidade é o SACADO**, não a nota: a análise de crédito acontece uma vez por sacado, e três fornecedores emitindo contra a mesma construtora são **uma oportunidade com o triplo de evidência**, não três cards.

## 2. População e fornecedores seguidos

Entram notas com `fornecedor_cadastrado = true` e `sacado_cadastrado = false`, cujo **fornecedor é seguido pelo originador**:

```sql
create table fornecedores_seguidos (
  id uuid primary key default gen_random_uuid(),
  originador_id uuid not null references vendedores(id),
  fornecedor_cnpj text not null,
  origem text not null default 'manual',   -- manual | titularidade
  desde timestamptz default now(),
  ate timestamptz,
  unique (originador_id, fornecedor_cnpj, ate)
);
```
Fonte dos seguidos = **união** de (a) cedentes onde o originador é titular vigente em `vendedor_carteira` (papel `originacao`, 04k) — sincronizados automaticamente com `origem = 'titularidade'` — e (b) fornecedores marcados manualmente (botão "Seguir" no funil de fornecedores 04l e na Company 360). Perder titularidade por dormência **não** remove o seguir manual.

## 3. Modelo

```sql
create table sacados_prospeccao (
  id uuid primary key default gen_random_uuid(),
  cnpj_sacado text not null,
  empresa_id uuid references empresas(id),       -- criada/vinculada se não existir
  originador_id uuid references vendedores(id),  -- quem descobriu; reatribuível pelo gestor
  estagio text not null default 'identificado',
    -- identificado | fornecedor_consultado | apresentacao_solicitada | analise_solicitada
    -- | em_analise | aprovado | recusado | sem_interesse | descartado
  motivo_saida text,
  -- métricas (recalculadas pelo job, §4)
  volume_30d numeric(14,2),
  valor_operavel numeric(14,2),
  qtd_nfs_30d int,
  qtd_fornecedores int,
  meses_com_emissao_6m int,
  media_mensal_6m numeric(14,2),
  prazo_medio_dias int,
  ultima_nf_em date,
  -- qualificação (cache do 04c/04d)
  score_credito numeric(5,2), score_completude numeric(4,3),
  chance_concessao numeric(4,3),
  faturamento_estimado numeric(16,2),
  valor_esperado_mensal numeric(14,2),
  -- ligação com a esteira
  analise_credito_id uuid references analises_credito(id),
  entrou_em timestamptz default now(),
  atualizado_em timestamptz default now(),
  unique (cnpj_sacado)
);
create index on sacados_prospeccao (originador_id, estagio);
create index on sacados_prospeccao (valor_esperado_mensal desc);

-- A QUEBRA POR FORNECEDOR dentro do card
create table sacados_prospeccao_fornecedores (
  id uuid primary key default gen_random_uuid(),
  sacado_prospeccao_id uuid references sacados_prospeccao(id) on delete cascade,
  fornecedor_cnpj text not null,
  fornecedor_nome text,
  fornecedor_empresa_id uuid references empresas(id),
  na_carteira_do_originador boolean default false,
  valor_30d numeric(14,2),
  valor_operavel numeric(14,2),
  qtd_nfs_30d int,
  meses_com_emissao_6m int,
  media_mensal_6m numeric(14,2),
  ultima_nf_em date,
  unique (sacado_prospeccao_id, fornecedor_cnpj)
);
```
O detalhe nota a nota **não vira tabela** — é consultado direto em `notas_fiscais` pelo par (fornecedor, sacado).

## 4. Job de atualização (`prospeccao/atualizar-sacados`, após cada sync de NF)

**Entrada**: sacado entra quando tem NF de fornecedor seguido emitida nos últimos `janela_emissao_dias` (config, default **30**) e `volume_30d ≥ corte_volume` (config, default R$ 30.000).

**Métricas — e a distinção que faz a feature funcionar:**
- `volume_30d` — a evidência de que o fluxo existe.
- **`valor_operavel`** — soma apenas das NFs cujo `dias_para_vencimento` > `tempo_medio_esteira + margem_prazo_dias` (config; a margem default é 10 dias e o tempo de esteira vem medido do 04d). *Uma nota com 15 dias de vida não sobrevive à análise de um sacado novo — mostrar os dois números impede o originador de trabalhar um card duas semanas e descobrir no fim que não sobrou nada para operar.*
- `meses_com_emissao_6m` e `media_mensal_6m` — **recorrência medida em 6 meses** (config `janela_recorrencia_meses`). É o que separa o pico de uma anuidade.
- `qtd_fornecedores`, `prazo_medio_dias`, `ultima_nf_em`.

**Qualificação automática (grátis)**: vincular/criar a empresa por CNPJ (enfileirando em `cnpj_lookup_fila` quando faltar cadastral), e puxar faturamento estimado (04c), scorecard e `chance_concessao` (04d). **Protestos NÃO entram aqui** — custam e ficam sob demanda (§5).

**Ordenação default**: `valor_esperado_mensal = media_mensal_6m × chance_concessao × margem_estimada` (margem a partir da taxa default de `credito_config`, 04o). Ordenar pelo snapshot de 30 dias premiaria o pico; isto premia o fluxo que se destrava.

**Saída automática**: sacado que passa a `sacado_cadastrado = true` no sync → `estagio = 'aprovado'`, sai da lista ativa, e as notas dele seguem o fluxo normal do funil de NFs.

**Sinal de mercado**: todo sacado neste funil recebe `empresas.grafo_sefaz = true` mais as métricas de fluxo — deixando as regras da pirâmide (02) promoverem esses CNPJs sozinhas. A mesma descoberta alimenta o funil do originador **e** o SOM do SDR, sem trabalho extra.

## 5. UI — aba Antecipação → Sacados por NF

**Kanban por estágio** (web) / lista com swipe (mobile), filtros por fornecedor seguido, UF, faixa de score e recorrência. Reusar os componentes do funil de NFs.

**Card = sacado**, com:
- Cabeçalho: razão social, CNPJ, UF/município, porte e idade.
- **Score com completude** (badge honesto: score 72 com completude 45% aparece marcado como frágil).
- Quatro números: **volume 30d** · **valor operável** · **média mensal (6m)** · **recorrência** (ex.: "5 dos últimos 6 meses").
- **Quebra por fornecedor** (pedido explícito — é o coração do card): lista dos fornecedores que emitiram, cada um com **valor no período, nº de notas, última emissão e média mensal**, marcando quais estão na carteira do originador. Clicar num fornecedor expande as **notas individuais** (número, valor, emissão, vencimento, dias restantes, operável ou não).

**Ações do card**:
- **Falar com o fornecedor** → abre o compositor (05A) na thread daquele fornecedor, com template próprio ("você tem R$ X a receber da Construtora Y — quer antecipar?").
- **Pedir apresentação** → `pedidos_apresentacao` (04l), ponte do fornecedor para o sacado.
- **Enriquecer sacado** → lote do Radar (03) com protesto e o que faltar, **mostrando o custo estimado antes** e respeitando o teto do originador. *A economia certa é pagar protesto para as dezenas que já mostraram fluxo recorrente, não para os milhares da lista.*
- **Solicitar análise de crédito** → cria a análise na esteira (04d) pré-preenchida (CNPJ, razão social, limite sugerido a partir do `limite_potencial`, origem `prospeccao_fluxo`), move o card para `analise_solicitada` e grava `analise_credito_id`. A decisão da esteira move o card sozinha: aprovada → `aprovado`; negada → `recusado` com motivo.
- **Descartar / sem interesse** (motivo obrigatório, lista config) e **mover estágio** manualmente.

**Painel do originador** no topo: nº de sacados, volume observado total, **valor esperado mensal somado**, e quantos estão travados esperando análise.

## 6. Guardrail de relacionamento (não negociável)

A abordagem sai **pelo fornecedor**, nunca direto na construtora expondo o que vimos. **Nenhuma mensagem, template ou tela voltada ao sacado pode exibir o volume, o nome do fornecedor ou o detalhe das notas** — é dado que o fornecedor nos cedeu para antecipar, e devolvê-lo ao sacado soa como vigilância. Herdar a regra já aplicada no template de pedido de apresentação (04l). Validar isso nos seeds de template e deixar comentado no código.

Supressão, janela de envio, cooldown e ponto focal (05A) valem integralmente.

## 7. Carteira e comissão

**Sacado aprovado entra na carteira do originador que o descobriu** — criar `vendedor_carteira` (papel `originacao`) para ele na data da aprovação, sobrepondo o roteamento por território. Registrar o vínculo com `origem = 'prospeccao_fluxo'` para auditoria. A partir daí a comissão segue o motor do 04k normalmente.

## 8. Settings (Antecipação → Sacados por NF, `webOnly`)

`janela_emissao_dias` (30) · `janela_recorrencia_meses` (6) · `corte_volume` (R$ 30k) · `margem_prazo_dias` (10) · `max_cards_por_originador` · motivos de descarte · templates de abordagem ao fornecedor.

## 9. Eventos, tools e entregáveis

**Eventos**: `sacado_prospeccao.identificado`, `sacado_prospeccao.estagio_alterado`, `sacado_prospeccao.analise_solicitada`, `sacado_prospeccao.aprovado`, `sacado_prospeccao.recusado`, `sacado_prospeccao.enriquecido`.
**Notificações**: novo sacado com `valor_esperado_mensal` acima de limiar → originador (push); análise decidida → originador.
**Tools**: `prospeccao.meus_sacados` (read), `prospeccao.detalhe_sacado` (read — inclui a quebra por fornecedor), `prospeccao.solicitar_analise` (mutates), `prospeccao.enriquecer` (mutates — respeita teto).
**Worker**: `prospeccao/atualizar-sacados` (após sync de NF), `prospeccao/sincronizar-seguidos` (diário, espelha titularidades do 04k).
**Core**: agregador sacado × fornecedor, cálculo de valor operável e de recorrência, cálculo do valor esperado — com testes (NF sem prazo suficiente, fornecedor que deixou de ser seguido, sacado que vira cliente no meio, múltiplos fornecedores).
**Web + Mobile**: kanban e card completos nos dois (o originador trabalha em campo); settings = `webOnly`.
**Docs**: README — o que é valor operável e por que ele difere do volume, como a recorrência é medida, o guardrail de relacionamento e o efeito no `grafo_sefaz`.

## 10. Fora de escopo

Abordagem direta ao sacado sem ponte do fornecedor · campanhas em massa para esta lista (05B, se um dia fizer sentido) · ingestão completa do grafo SEFAZ (o 02.5 segue existindo; esta feature entrega a fatia operacional dele).
