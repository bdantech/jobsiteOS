# JOBSITEOS — Claude Code Prompt 04d: Crédito Potencial, Scorecard & Esteira de Análise
## Limite/receita previstos por sacado, scorecard transparente de chance de concessão, esteira de análise com Atradius

> Builds on Prompts 01–04c. Reuse: filter engine, `clientes_onepay` + temperature report, `credito_snapshots`, `protestos_consultas`, estimador de faturamento (04c: `empresa_metricas`, calibração versionada), certificados (04b), grupos/SPEs/CNO (02), event log, `notify()`, Supabase Storage. UI pt-BR, code English. Migrations via Supabase MCP.
> **Escopo: SACADOS apenas** (`tipo in ('construtora','incorporadora')`). Fornecedor tem outra pergunta (adesão), fora deste prompt.

---

## 1. Settings (`credito_config`)

```jsonc
"economia": {
  "taxa_padrao_am": 1.9,          // % a.m. — global, aplicada a todas
  "tac": 150.00,                   // R$ por operação
  "valor_medio_nf": 25000.00,      // R$ — converte volume em nº de operações
  "prazo_medio_dias": 45,          // default; botão "calibrar da carteira" usa mediana real (vencimento−emissão das NFs)
  "giro_mensal": null              // volume mensal ÷ limite; null = usar calibrado (§2). Override manual possível
},
"limite": {
  "ratio_limite_manual": null,     // null = usar calibrado (§2)
  "cap_absoluto": 5000000,         // teto de sanidade do limite potencial
  "cap_pct_faturamento": 0.15      // limite nunca > 15% do faturamento estimado
},
"scorecard": {
  "corte_concessao": 40,
  "completude_minima": 0.5,        // abaixo → "dados insuficientes", sem score exibido
  "recencia_protesto_dias": 90,
  "knockout_negada_meses": 6
}
```

## 2. Limite potencial e receita prevista (por sacado)

### 2.1 Calibração (job mensal `credito/calibrar`, versionada como no 04c)
Dos clientes atuais (`clientes_onepay` × faturamento declarado do 04c), por tipo com fallback global:
- `ratio_limite[tipo]` = mediana de `credit_limit / faturamento_anual_declarado`
- `giro_mensal` = mediana de `(gross_value_last_2m / 2) / credit_limit` (carteira real, não chute)

### 2.2 Cálculo (job `credito/estimar-potencial`, roda após o estimador de faturamento)
```
limite_potencial      = min(faturamento_estimado × ratio_limite[tipo],
                            cap_absoluto, faturamento_estimado × cap_pct_faturamento)
volume_mensal         = limite_potencial × giro_mensal
receita_financeira    = volume_mensal × (taxa_padrao_am/100) × (prazo_medio_dias/30)
receita_tac           = (volume_mensal / valor_medio_nf) × tac
receita_mensal_prevista = receita_financeira + receita_tac
valor_esperado_mensal = receita_mensal_prevista × chance_concessao (§3; sem score → usar 0.5 com flag)
```
Confiança do limite **herda** a confiança do faturamento (propaga, não esconde). Cache em `empresas`: `limite_potencial`, `receita_mensal_prevista`, `valor_esperado_mensal` + confiança e `calculado_em`; histórico em `empresa_metricas` (novas métricas: `limite_potencial`, `receita_prevista`) com a mesma regra de variação mínima do 04c.

## 3. Scorecard de chance de concessão

### 3.1 Estrutura (versionada e editável)
```sql
create table scorecard_versoes (
  id uuid primary key default gen_random_uuid(),
  versao int unique not null,
  definicao jsonb not null,        -- fatores: peso, faixas→pontos, tratamento de nulo
  ativa boolean default false,
  criada_por uuid references usuarios(id),
  criada_em timestamptz default now()
);
create table empresa_scores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id),
  cnpj text not null,
  score numeric(5,2),              -- 0–100, null se completude < mínima
  completude numeric(4,3),         -- % dos pesos avaliáveis
  faixa text,                      -- alta | media | improvavel | dados_insuficientes
  knockout text,                   -- null | 'situacao_irregular' | 'negada_recente'
  breakdown jsonb not null,        -- por fator: valor observado, faixa, pontos, peso
  scorecard_versao int,
  calculado_em timestamptz default now()
);
create index on empresa_scores (cnpj, calculado_em desc);
```
Cache em `empresas`: `chance_concessao numeric(4,3)` (mapeamento faixa→probabilidade, config: alta=0.8, media=0.5, improvavel=0.1), `score_credito`, `score_completude`.

### 3.2 Cálculo
`score = Σ pontos obtidos ÷ Σ pontos possíveis dos fatores AVALIÁVEIS × 100` — fator sem dado sai do numerador E do denominador (renormalização), e reduz `completude`. Completude < `completude_minima` → `faixa = 'dados_insuficientes'`, sem número exibido.

**Knockouts** (ignoram a soma):
- `situacao_cadastral != 'ativa'` → score 0, faixa improvável.
- Análise **negada** (Atradius/interna) nos últimos `knockout_negada_meses` → score travado em `min(score, corte_concessao − 10)`.

**Faixas**: score ≥ 65 → alta; ≥ `corte_concessao` → média; abaixo → improvável ("crédito provavelmente não será concedido").

### 3.3 Fatores seed (versão 1 — pesos sobre 100)
| Fator | Peso | Faixas → pontos |
|---|---|---|
| **Protestos (relativizado + recência)** | 25 | ratio = valor_protestos ÷ faturamento_estimado (fallback: ÷ capital_social; sem ambos: faixas absolutas, marcar no breakdown). Sem protesto=25 · ratio<0,5%=15 · 0,5–2%=5 · >2%=0. **Protesto mais recente < `recencia_protesto_dias` → pontos ÷ 2.** Sem consulta de protesto = fator não avaliável |
| **Faturamento/porte** | 15 | >50M=15 · 10–50M=12 · 4,8–10M=8 · 1–4,8M=5 · <1M=2 · sem estimativa = não avaliável |
| **Atividade do grupo** | 15 | (SPEs 24m ≥2 OU obras_ativas ≥2 OU m²≥10k)=15 · (≥1 de qualquer)=8 · grupo/CNO conhecidos e zerados=3 · sem dado = não avaliável |
| **Idade** | 10 | ≥10a=10 · 5–10=7 · 2–5=4 · <2=0 |
| **Regularidade fina** | 10 | ativa sem situação especial e sem motivo de suspensão histórico=10 · com histórico de suspensão/inapta reativada=4 |
| **Histórico de análises** | 10 | aprovada vigente=10 · aprovada expirada=7 · nunca analisada=5 (neutro) · aprovada parcial=4 · (negada recente → knockout) |
| **Crescimento headcount 12m** | 5 | >+15%=5 · estável=3 · queda >15%=0 · sem série = não avaliável |
| **Capital social** | 5 | ≥5M=5 · 1–5M=3 · <1M=1 |
| **Certificado digital ativo** | 5 | ativo=5 · vencido=2 · nunca teve=0 (proxy de conexão à infra) |

UI de edição (webOnly, padrão pirâmide): editar faixas/pontos/pesos, **preview de impacto** (distribuição de scores antes/depois, quantas empresas mudam de faixa), salvar como nova versão, histórico. Job `credito/recalcular-scores` roda após: nova versão ativada, novo lote de protestos, reestimativa de faturamento, decisão de análise.

**Company 360**: card "Crédito" — score com barra, faixa, completude, breakdown fator a fator ("Sem protestos +25 · 12 anos +10 · ..."), limite potencial, receita prevista, valor esperado, botão **Solicitar análise** (§4). Web e mobile.

## 4. Esteira de análise de crédito

### 4.1 Modelo
```sql
create table analises_credito (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id),
  cnpj text not null,
  estagio text not null default 'rascunho',
    -- rascunho | solicitada | docs_pendentes | enviada_seguradora | em_analise
    -- | aprovada | aprovada_parcial | negada | expirada | cancelada
  limite_solicitado numeric(14,2),
  limite_aprovado numeric(14,2),
  moeda text default 'BRL',
  seguradora text default 'atradius',
  atradius_buyer_id text,
  atradius_case_id text,           -- id do pedido/decisão no Cover API
  rating_seguradora text,          -- rating do buyer retornado
  decidida_em timestamptz,
  expira_em date,
  motivo text,                     -- da negativa/parcial, quando fornecido
  origem text default 'jobsiteos', -- jobsiteos | atradius_backfill
  solicitada_por uuid references usuarios(id),
  criada_em timestamptz default now(),
  atualizada_em timestamptz default now()
);
create index on analises_credito (cnpj, criada_em desc);
create index on analises_credito (estagio);

create table analise_docs (
  id uuid primary key default gen_random_uuid(),
  analise_id uuid references analises_credito(id) on delete cascade,
  tipo text not null,              -- balanco | dre | faturamento_declarado | contrato_social | outros (configurável)
  arquivo_url text not null,       -- Supabase Storage (bucket privado, RLS)
  nome_arquivo text,
  enviado_por uuid references usuarios(id),
  enviado_em timestamptz default now()
);
```

### 4.2 Fluxo
1. **Solicitar** (Company 360 ou lista da esteira; web e mobile): limite solicitado (pré-preenchido com `limite_potencial`), observações → `solicitada`. Checklist de docs (tipos configuráveis em settings) → enquanto faltar obrigatório, `docs_pendentes`; upload direto na tela (mobile: câmera/arquivos).
2. **Enviar à seguradora** (ação explícita, perfil Crédito): worker resolve o buyer no **Atradius Buyer API** (busca por identificador nacional = CNPJ; guarda `atradius_buyer_id` e rating) e submete o pedido de cobertura no **Cover API** → `enviada_seguradora` → `em_analise`. **A resolução de buyer só acontece neste momento — nunca em lote, nunca especulativa** (consultas de buyer podem ser cobradas). Ler a documentação oficial em `https://api.atradius.com/developers` (Buyer e Cover handbooks) para autenticação (OAuth2) e contratos exatos; implementar como **provedor plugável** (`seguradoras/atradius.ts` atrás de interface — outra seguradora entra sem refatorar).
3. **Decisão**: polling do worker (intervalo config; webhook se o Cover API oferecer callback) → `aprovada` (limite, validade) | `aprovada_parcial` | `negada` (motivo quando disponível). Toda decisão: insere em `credito_snapshots` (origem `atradius`), recalcula score da empresa (fator histórico/knockout), evento + notificação.
4. **Expiração**: job diário marca `expirada` quando `expira_em` passa; evento (candidata a renovação).

### 4.3 Backfill do histórico ("histórico impecável")

**⚠️ Restrição de custo — leia antes de implementar**: consultas de buyer na Atradius podem ser cobradas. O backfill NUNCA descobre ou varre buyers novos — ele recupera exclusivamente o que **já existe na apólice**: limites vigentes, decisões pendentes e o histórico de decisões passadas (buyers que já foram consultados/cobertos no passado). Usar os endpoints de listagem do portfólio/decisões da apólice no Cover API; o Buyer API só é chamado para detalhar buyers **que já vieram nessas listas** (resolver identificador→CNPJ), jamais para busca aberta.

Job único `credito/backfill-atradius`: pagina limites e decisões existentes da apólice e insere tudo em `analises_credito` com `origem = 'atradius_backfill'` (casando buyer→CNPJ pelo identificador nacional retornado; sem match → fila de revisão manual). A partir daí o sync incremental (diário) mantém **apenas o que já está na apólice**: novas decisões, alterações e cancelamentos de limite pela seguradora viram atualizações + eventos (`analise.limite_reduzido` é sinal de risco de primeira grandeza). Buyers novos só entram na Atradius pelo fluxo de solicitação da esteira (§4.2), que é ação humana explícita e consciente do custo.

### 4.4 UI da esteira
**Web**: kanban por estágio (padrão do funil de NFs) + tabela; detalhe da análise com docs, timeline, dados Atradius. **Mobile**: lista por estágio, solicitar análise, upload de docs, acompanhar; aprovações/decisões chegam por push.

## 5. Valor esperado em toda parte

- Novas variáveis no catálogo de filtros: `limite_potencial`, `receita_mensal_prevista`, `valor_esperado_mensal`, `score_credito`, `chance_concessao`, `faixa_score`, `tem_analise_vigente`, `analise_estagio`.
- **Explorador e SOM**: ordenação default por `valor_esperado_mensal` (a régua de R$ esperados/mês substitui "parece bom").
- Dashboard do módulo: pipeline de valor esperado por camada/faixa de score; funil da esteira (solicitadas → enviadas → aprovadas, com taxas).

## 6. Tools de IA e eventos

- `credito.potencial_empresa` (read): limite, receita prevista, valor esperado + como foi calculado.
- `credito.score_empresa` (read): score, completude, breakdown legível.
- `credito.solicitar_analise` (mutates): cria a solicitação em rascunho (nunca envia à seguradora sozinha).
- `credito.status_esteira` (read): contagens e valores por estágio.

Eventos: `analise.solicitada`, `analise.enviada`, `analise.aprovada`, `analise.aprovada_parcial`, `analise.negada`, `analise.expirada`, `analise.limite_reduzido`, `score.recalculado` (mudança de faixa), `credito.potencial_atualizado`. Seeds `notificacao_regras`: decisões (aprovada/negada/parcial) → solicitante + perfil Crédito; `analise.limite_reduzido` → Admin + Crédito; `analise.expirada` → Crédito.

## 7. Entregáveis

**Worker**: `credito/calibrar`, `credito/estimar-potencial`, `credito/recalcular-scores`, `credito/enviar-atradius`, `credito/poll-decisoes`, `credito/backfill-atradius` (uma vez), `credito/sync-atradius` (diário), `credito/expirar-analises` (diário).
**Web + Mobile**: conforme §3/§4/§5 (editor do scorecard e settings = webOnly).
**Core**: cálculo do score com testes (renormalização por dado faltante, knockouts, recência de protesto, caps do limite); interface de seguradora.
**Env**: `ATRADIUS_CLIENT_ID`, `ATRADIUS_CLIENT_SECRET`, `ATRADIUS_BASE_URL`, `ATRADIUS_POLICY_ID`.
**Docs**: README — como o score é calculado (com exemplo numérico), hierarquia limite→receita→valor esperado, fluxo da esteira, backfill e o mapa buyer↔CNPJ.

## 8. Fora de escopo

Calibração estatística automática dos pesos do scorecard (chega com histórico de decisões acumulado), chance de adesão do fornecedor, declarações de faturamento à seguradora (declarations), sinistros/non-payment cases.
