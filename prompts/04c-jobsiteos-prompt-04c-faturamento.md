# JOBSITEOS — Claude Code Prompt 04c: Faturamento Estimado & Funcionários
## Séries históricas, enriquecimento de headcount via Apollo e estimador composto calibrado nos clientes

> Small focused prompt building on Prompts 01–04b. Reuse: Radar (lotes, `enriquecimentos`, cascata de domínio, Apollo client), filter engine, `clientes_onepay`, event log. UI pt-BR, code English. Migrations via Supabase MCP.

---

## 1. Expansão do `tipo` da empresa

```sql
-- valores passam a ser: construtora | incorporadora | fornecedor | subempreiteiro
-- default permanece 'construtora'
```
Atualizar: formulário/edição da empresa (web e mobile), badge na Company 360, catálogo de filtros (`tipo` com os 4 valores), importador de listas. Não reclassificar dados existentes automaticamente — `construtora` continua válido; a distinção incorporadora/subempreiteiro é refinada manualmente ou por futuras regras.

## 2. Séries históricas: `empresa_metricas`

```sql
create table empresa_metricas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id),
  cnpj text not null,
  metrica text not null,            -- 'faturamento_anual' | 'funcionarios'
  valor numeric(16,2) not null,
  origem text not null,             -- declarado_cliente | apollo | apollo_search | modelo | bracket_simples | lista
  confianca text,                   -- alta | media | baixa
  detalhes jsonb default '{}',      -- ex.: coeficientes usados, ano de referência, quem declarou
  capturado_em timestamptz default now()
);
create index on empresa_metricas (cnpj, metrica, capturado_em desc);
```

**Nunca update — sempre insert** (é série temporal). Cache do valor vigente em `empresas`:
```sql
alter table empresas add column faturamento_anual numeric(16,2);
alter table empresas add column faturamento_origem text;
alter table empresas add column faturamento_confianca text;
alter table empresas add column faturamento_atualizado_em timestamptz;
alter table empresas add column funcionarios int;
alter table empresas add column funcionarios_origem text;
alter table empresas add column funcionarios_atualizado_em timestamptz;
alter table empresas add column regime_tributario text; -- 'simples' | 'presumido' | 'real' | null (manual/futuro)
```

**Hierarquia de origem** (maior vence; estimativa NUNCA sobrescreve declarado):
`declarado_cliente` > `apollo` > `apollo_search` > `lista` > `modelo` > `bracket_simples`.
O cache só é atualizado se a nova leitura tem origem ≥ à vigente, ou mesma origem mais recente.

## 3. Config (`radar_config`, novas chaves)

```jsonc
"faturamento": {
  "teto_simples": 4800000,            // muda por lei — nunca hardcode
  "teto_presumido": 78000000,
  "pct_teto_simples_default": 0.5,    // optante sem outro sinal → 50% do teto
  "variacao_minima_snapshot": 0.10,   // só grava snapshot de modelo se mudou >10%
  "n_minimo_calibracao_por_tipo": 5   // abaixo disso, usa ratio global
},
"funcionarios": {
  "ttl_dias": 180,
  "custo_unitario": 0                 // organizations/enrich não consome créditos de revelação; configurável caso o plano cobre
}
```

## 4. Motor de funcionários (novo tipo de enriquecimento no Radar)

Fonte primária: `GET /api/v1/organizations/enrich?domain={dominio}` → campo `estimated_num_employees` (estimativa Apollo do quadro total). Fallback: `total` do `mixed_people/api_search` (conta perfis indexados — viés para escritório) → `origem = 'apollo_search'`, `confianca = 'baixa'`. **Pré-requisito: domínio resolvido** (cascata do Prompt 03; sem domínio, o item do lote falha com motivo `sem_dominio`).

Três caminhos de entrada:
1. **Backfill retroativo (rodar uma vez, custo zero)**: job `radar/backfill-funcionarios` varre `enriquecimentos.payload` dos enriquecimentos Apollo já feitos, extrai `estimated_num_employees` e insere snapshots em `empresa_metricas` com `capturado_em = executado_em` original.
2. **Carona automática**: todo enriquecimento de contatos (Prompt 03) passa a extrair e snapshotar o headcount do passo `organizations/enrich` — sem chamada nem custo adicional.
3. **Sob demanda**: botão "Atualizar funcionários" na Company 360 (web e mobile) — chama só o `organizations/enrich` daquele domínio; e **lote** pelo fluxo padrão seleção → estimativa → aprovação (`tipo = 'funcionarios'` em `lotes_enriquecimento`), respeitando TTL de 180 dias com toggle de forçar.

Cada leitura = snapshot novo. Registrar também em `enriquecimentos` (tipo `funcionarios`) para TTL/custo/auditoria.

## 5. Dado declarado (clientes)

Na Company 360 de clientes (`e_cliente_onepay = true`), seção "Dados financeiros" com inputs: **faturamento anual declarado** (valor + ano de referência) e **funcionários declarado**. Salvar como snapshot `origem = 'declarado_cliente'`, `confianca = 'alta'`, `detalhes = { ano, declarado_por: usuario_id }`. Editável apenas por perfis com o módulo; toda alteração no `audit_log` + evento `metrica.declarada`.

## 6. Estimador composto (job mensal `radar/estimar-faturamento`)

### 6.1 Calibração (nos clientes com faturamento declarado)
Por **tipo** de empresa (com `n_minimo_calibracao_por_tipo`; abaixo, ratio global):
- `ratio_fat_por_funcionario[tipo]` = mediana de `faturamento_declarado / funcionarios`
- `pct_mrr_sobre_faturamento[tipo]` = mediana de `erp_mrr × 12 / faturamento_declarado`
- `fat_por_usuario_erp[tipo]` = mediana de `faturamento_declarado / erp_qtd_usuarios`
- **Peso de cada modelo por tipo** = inverso do erro mediano absoluto (em log) do modelo ao prever os próprios clientes declarados. Modelo que erra mais pesa menos — o sistema descobre qual sinal funciona para qual tipo.

Coeficientes e pesos são **versionados** (tabela `estimador_versoes`: versao, coeficientes jsonb, calibrado_em, n_amostras_por_tipo) — mesmo padrão das regras da pirâmide.

### 6.2 Estimativa (todas as empresas com pelo menos um sinal)
1. Calcula cada modelo disponível: funcionários × ratio; `erp_mrr × 12 / pct`; usuários × fat_por_usuario.
2. Combina por **média geométrica ponderada** (faturamento é log-normal; média aritmética infla com outlier).
3. Aplica **restrições** na ordem:
   - `opcao_simples = true` → cap no `teto_simples`; **sem nenhum modelo disponível** → estimativa = `teto_simples × pct_teto_simples_default`, `origem = 'bracket_simples'`, `confianca = 'baixa'`.
   - `saiu_simples` em data conhecida → `teto_simples` vira **piso**.
   - `regime_tributario = 'presumido'` → cap no `teto_presumido` (não inferir valor a partir do regime; só limitar).
4. Confiança: `alta` = 2+ modelos concordando dentro de 2×; `media` = 1 modelo ou modelos divergentes; `baixa` = só bracket.
5. Grava snapshot `origem = 'modelo'` **somente se** variação > `variacao_minima_snapshot` vs. último snapshot de modelo. Atualiza cache respeitando a hierarquia (§2).

## 7. Catálogo de filtros (novas variáveis)

`faturamento_estimado`, `faturamento_origem`, `faturamento_confianca`, `funcionarios`, `funcionarios_origem`, `funcionarios_crescimento_12m` (variação % entre o snapshot mais recente e o mais próximo de 12 meses atrás; null com <2 pontos), `regime_tributario`, `tipo` (4 valores).

## 8. UI

**Company 360 (web e mobile)**: card "Faturamento & Equipe" — valor vigente de cada métrica com badge de origem e confiança, data, mini-sparkline da série histórica (tap/click abre histórico completo com origem por ponto), botão "Atualizar funcionários", inputs de declaração quando cliente (§5).
**Radar**: tipo de lote `funcionarios` no construtor; painel do Radar ganha cobertura de headcount por camada.
**Settings**: chaves novas de config editáveis (tetos, %, TTL); página "Estimador" (webOnly) mostrando a versão vigente dos coeficientes, n de calibração por tipo, erro mediano por modelo — e botão "Recalibrar agora".

## 9. Tools de IA e eventos

- `radar.faturamento_empresa` (read): valor vigente + como foi estimado (modelos, coeficientes, restrições aplicadas) + histórico resumido.
- `radar.atualizar_funcionarios` (mutates): dispara a consulta sob demanda de uma empresa.
- Eventos: `metrica.declarada`, `funcionarios.atualizado`, `faturamento.reestimado` (payload: de → para, origem), `estimador.recalibrado`.

## 10. Entregáveis

**Worker**: `radar/backfill-funcionarios` (uma vez), extração de headcount na carona do enriquecimento de contatos, `radar/funcionarios-lote`, `radar/estimar-faturamento` (mensal, encadeado após a calibração), `radar/calibrar-estimador` (mensal).
**Web + Mobile**: conforme §8 (estimador e settings = webOnly).
**Core**: modelos e combinação geométrica em `packages/core` com testes unitários (incluindo casos: um modelo só, divergência, caps do Simples/presumido, piso do saiu-Simples).
**Docs**: README — hierarquia de origens, como a calibração funciona, como interpretar confiança, e o aviso honesto: fontes tipo Apollo subcontam mão de obra de canteiro; a calibração absorve o viés desde que clientes e prospects sejam medidos pela mesma régua.

## 11. Fora de escopo

eSocial como fonte de headcount real (futura Carteira), faturamento observado via grafo NF-e, inferência de regime tributário.
