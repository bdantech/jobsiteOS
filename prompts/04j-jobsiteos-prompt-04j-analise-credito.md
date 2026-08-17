# JOBSITEOS — Claude Code Prompt 04j: Análise de Crédito Proprietária
## Extração de documentos contábeis com IA, cálculo determinístico de limite, parecer narrativo e confronto com a seguradora

> Builds on Prompts 01–04i. Reuse pesado: esteira e scorecard (04d: `analises_credito`, `analise_docs`, `empresa_scores`), estimador de faturamento (04c), protestos e clientes (03), NFs e antecipações (04/04e), Anthropic API (Prompt 01), Supabase Storage. UI pt-BR, code English. Migrations via Supabase MCP.

---

## 1. Princípio arquitetural (não negociar)

Três camadas separadas, com responsabilidades distintas:

1. **Extração — IA lê documentos** e devolve dados estruturados com citação da origem.
2. **Cálculo — determinístico, sem IA**: indicadores e os cinco tetos saem de fórmulas auditáveis e versionadas. Mesma entrada → mesmo resultado, sempre.
3. **Parecer — IA escreve** a narrativa sobre os números já calculados.

**IA lê e escreve; matemática decide; humano aprova.** Nenhuma etapa autoaprova crédito.

**Output obrigatório de toda análise**: uma recomendação binária — **OPERAR / NÃO OPERAR** — e, quando OPERAR, o **limite recomendado** (com três cenários; o cenário base é o número da recomendação).

## 2. Modelo de dados

```sql
create table analises_proprietarias (
  id uuid primary key default gen_random_uuid(),
  analise_credito_id uuid references analises_credito(id), -- vínculo com a esteira (04d)
  empresa_id uuid references empresas(id) not null,
  cnpj text not null,
  tipo text not null default 'inicial',        -- inicial | reanalise
  gatilho text not null,                        -- manual | automatico_envio_atradius
  status text not null default 'processando',   -- processando | aguardando_revisao | concluida | falhou
  -- extração
  dados_extraidos jsonb,                        -- §3 (com citações)
  extracao_revisada_por uuid references usuarios(id),
  extracao_revisada_em timestamptz,
  -- cálculo
  indicadores jsonb,                            -- §4.1
  tetos jsonb,                                  -- §4.2 (cada teto: valor, base de cálculo, aplicável?)
  cenarios jsonb,                               -- { conservador, base, agressivo } com racional
  recomendacao text,                            -- operar | nao_operar
  limite_recomendado numeric(14,2),
  -- parecer
  parecer_markdown text,                        -- memorando gerado pela IA
  parecer_modelo text, parecer_tokens int,
  -- confronto e decisão
  atradius_status text, atradius_limite numeric(14,2),
  quadrante text,                               -- ambos_aprovam | ambos_negam | so_nos | so_seguradora
  decisao_final text,                           -- operar_com_cobertura | operar_sem_cobertura | operar_limite_reduzido | nao_operar
  decisao_limite numeric(14,2),
  decisao_motivo text,                          -- OBRIGATÓRIO quando diverge do quadrante trivial
  decidida_por uuid references usuarios(id), decidida_em timestamptz,
  parametros_versao int not null,
  criada_por uuid references usuarios(id),
  criada_em timestamptz default now(), concluida_em timestamptz
);
create index on analises_proprietarias (cnpj, criada_em desc);

create table analise_parametros (               -- versionado: análise antiga reproduzível
  versao int primary key,
  definicao jsonb not null,                     -- percentuais, tetos, pesos, prompt do parecer
  ativa boolean default false,
  criada_por uuid, criada_em timestamptz default now()
);
```

Estender `analise_docs` (04d) com os tipos contábeis: `balanco_patrimonial`, `dre`, `balancete`, `dfc` (fluxo de caixa), `dmpl`, `notas_explicativas`, `faturamento_declarado`, `relacao_faturamento_mensal`, `contrato_social`, `certidoes` (CND federal/estadual/municipal/FGTS/trabalhista), `imposto_renda_pj`, `sped_ecd`, `parecer_auditoria`, `outros`. Checklist na UI indicando quais são **essenciais** para a análise (balanço + DRE de 2 exercícios, faturamento) e quais são complementares — a análise roda com o que houver, sinalizando lacunas.

## 3. Extração (IA sobre documentos)

Job `credito/extrair-documentos`: para cada doc dos tipos contábeis, extrair texto (PDF nativo → texto; PDF escaneado → enviar as páginas como imagem ao modelo) e chamar a Anthropic API (`claude-sonnet-4-6`) pedindo **JSON estrito** por documento.

Campos-alvo (multi-exercício quando disponível, últimos 3): receita bruta e líquida, CMV/CPV, lucro bruto, EBITDA (ou insumos para calculá-lo), resultado financeiro, lucro líquido; ativo circulante e não circulante, caixa e equivalentes, contas a receber, estoques; passivo circulante e não circulante, empréstimos/financiamentos curto e longo prazo, fornecedores; patrimônio líquido; obras em andamento/estoque de imóveis quando houver.

Regras obrigatórias do prompt de extração:
- Retornar **apenas JSON**, sem preâmbulo; valores numéricos normalizados (sem separador de milhar, ponto decimal), com `moeda` e `exercicio` por bloco.
- **Cada campo acompanha `origem`**: `{ documento_id, pagina, trecho_curto }` — rastreabilidade total.
- Campo ausente → `null` e entrada em `lacunas[]`. **Nunca inferir, estimar ou preencher por analogia.**
- Divergência entre documentos (ex.: receita do DRE ≠ da relação de faturamento) → registrar em `conflitos[]` com os dois valores e suas origens.

**Revisão humana obrigatória** dos campos críticos (receita, PL, dívida, caixa) antes de contarem no cálculo: tela com o valor extraído, o trecho de origem e opção de corrigir. Status fica `aguardando_revisao` até a confirmação. Correção manual sobrescreve e fica logada (`audit_log`).

## 4. Cálculo determinístico

### 4.1 Indicadores (fórmulas fixas, exibidas na UI junto do resultado)
Liquidez corrente e seca · endividamento geral (PT/AT) · dívida líquida/EBITDA · margem EBITDA e líquida · ROE · giro do ativo · prazo médio de recebimento · crescimento de receita (CAGR dos exercícios disponíveis) · cobertura de juros. Cada indicador com faixa de referência para construção (parametrizada) e sinalização verde/amarelo/vermelho.

### 4.2 Os cinco tetos — vale o MENOR entre os aplicáveis
1. **Capacidade financeira**: `% da receita anual comprovada`, ajustado por endividamento e liquidez (parâmetros versionados; ex.: base 10% da receita, penalizado se dívida líquida/EBITDA > 3 ou liquidez corrente < 1).
2. **Capacidade operacional (fluxo de NF-e observado)**: `média mensal de NF-e emitidas/recebidas × fator`. **Aplicável SOMENTE em reanálise de empresa que já opera na plataforma** (dados de `notas_fiscais`/`antecipacoes`). Em análise inicial, marcar explicitamente como **"não aplicável — empresa ainda não opera"** na UI e **excluir do mínimo** (nunca tratar como zero). Em reanálise, destacar como o teto mais confiável (é comportamento observado, não declarado).
3. **Concentração de portfólio**: `% máximo do fundo por sacado` (proteção do FIDC, não do cliente).
4. **Cobertura da seguradora**: limite Atradius vigente, quando houver.
5. **Scorecard (04d)**: banda de limite por faixa de score (parametrizada).

Cada teto na saída traz: valor, fórmula aplicada, insumos usados e se foi o teto vinculante.

### 4.3 Cenários e recomendação
- **Conservador**: menor teto × fator conservador; **Base**: menor teto (= `limite_recomendado`); **Agressivo**: menor teto × fator de expansão, com condicionantes explícitas (ex.: "mediante garantia adicional" / "revisão em 90 dias").
- **NÃO OPERAR** automático quando: knockout do scorecard (situação irregular), indicadores em vermelho crítico (parametrizável — ex.: PL negativo, dívida líquida/EBITDA > limite), ou menor teto abaixo do mínimo operacional configurado. Sempre com o motivo listado.

## 5. Parecer narrativo (IA)

Chamada à Anthropic API recebendo: indicadores calculados, tetos com fórmulas, cenários, scorecard e seu breakdown (04d), protestos e histórico, faturamento estimado (04c) vs. declarado nos documentos, funcionários e crescimento, grupo/SPEs/obras, certificados, lacunas e conflitos da extração, e — em reanálise — comportamento operacional real (volume, pontualidade, concentração de sacados).

Saída em **formato de memorando de comitê** (markdown), seções fixas: (1) Resumo e recomendação · (2) A empresa · (3) Situação financeira · (4) Riscos identificados · (5) Pontos fortes · (6) O que não fecha (lacunas e conflitos, nominalmente) · (7) Perguntas a fazer ao cliente · (8) Sanity check do limite sugerido (a IA critica o número calculado; **não o altera**).

Restrições no prompt do parecer: usar **apenas** os dados fornecidos; nunca inventar número; sempre citar de onde veio cada afirmação relevante; declarar explicitamente quando a base é insuficiente para opinar. O texto é editável pelo analista antes da decisão (versão original preservada).

## 6. Gatilhos

- **Automático**: ao acionar "Enviar à seguradora" na esteira (04d), se não houver análise proprietária concluída para aquela `analise_credito_id`, dispara a análise antes/junto do envio (não bloqueia o envio; roda em paralelo e avisa quando concluir).
- **Manual**: botão "Rodar análise proprietária" disponível nos estágios anteriores ao envio (`solicitada`, `docs_pendentes`, `em_analise`) e na Company 360 de clientes (reanálise). Sob demanda apenas — **nunca em lote automático** (custo de tokens com documentos longos).
- **Reanálise**: sugerida automaticamente (notificação, não execução) quando análise vigente estiver a 60 dias do vencimento ou quando houver evento de risco relevante (protesto novo, limite reduzido pela seguradora, queda de score).

## 7. Confronto com a seguradora e decisão

Tela de comparação lado a lado (nossa análise × Atradius), com o **quadrante** classificado:
- `ambos_aprovam` → operar; limite sugerido = menor dos dois.
- `ambos_negam` → não operar.
- `so_nos` (seguradora nega, nós aprovamos) → decisão de **operar sem cobertura** ou com limite reduzido/garantia adicional; **motivo obrigatório**. É a decisão que só um FIDC com dado próprio pode tomar.
- `so_seguradora` (ela aprova, nós negamos) → alerta de complacência; **motivo obrigatório** para prosseguir.

Decisão final registrada com autor, limite e motivo; aplica-se à `analises_credito` da esteira (04d) e emite evento. **Somente perfil Crédito decide** (nunca automático, nunca pela IA).

## 8. Detalhe do sacado na esteira (§ pedido explicitamente)

Ao abrir um sacado na esteira, painel único com tudo:
- **Scorecard atual (04d)**: score, faixa, completude e breakdown fator a fator.
- **Análise proprietária**: indicadores (com semáforo), os cinco tetos (com "não aplicável" quando for o caso), três cenários, recomendação e limite.
- **Parecer** (memorando renderizado, colapsável, editável).
- **Atradius**: status, limite, rating, validade, histórico de decisões.
- **Contexto**: protestos com histórico, faturamento estimado × declarado, funcionários e crescimento, grupo/SPEs/obras, certificados, e — se cliente — comportamento operacional.
- **Documentos**: checklist com o que falta, upload, e os valores extraídos com link para o trecho de origem.

## 9. Registry, tools e eventos

Tools: `credito.analise_proprietaria` (read: resultado consolidado de um CNPJ), `credito.rodar_analise` (mutates: dispara análise — nunca decide), `credito.comparar_seguradora` (read: quadrante e divergências do período).
Eventos: `analise_propria.iniciada`, `analise_propria.aguardando_revisao`, `analise_propria.concluida`, `analise_propria.divergencia_seguradora`, `credito.decisao_registrada`, `reanalise.sugerida`.
Notificações: `aguardando_revisao` → solicitante + Crédito; `divergencia_seguradora` → Crédito + Admin; `reanalise.sugerida` → Crédito.

## 10. Entregáveis

**Worker**: `credito/extrair-documentos`, `credito/calcular-analise`, `credito/gerar-parecer`, `credito/sugerir-reanalises` (diário). Falha em qualquer etapa → status `falhou` com erro legível e retry manual; nunca resultado parcial silencioso.
**Web**: painel do sacado (§8), tela de revisão de extração, tela de confronto e decisão, editor de parâmetros versionados (webOnly, com preview do impacto nos tetos de uma análise exemplo).
**Mobile**: leitura do painel (indicadores, cenários, parecer) e **decisão** (aprovar/registrar decisão com motivo) — decisão de crédito no celular é caso de uso real; upload de documentos pela câmera.
**Core**: cálculo de indicadores e tetos em `packages/core` com testes (cada fórmula, teto não aplicável excluído do mínimo, knockouts, cenários).
**Segurança**: documentos em bucket privado com RLS restrita ao perfil Crédito; texto extraído e payloads de IA não logados em claro; política de retenção documentada.
**Docs**: README — o que a IA faz e o que não faz, fórmulas dos tetos, como versionar parâmetros, como interpretar os quadrantes.

## 11. Fora de escopo

Autoaprovação, precificação dinâmica de taxa por risco, calibração estatística das fórmulas contra inadimplência observada (fase futura, quando houver histórico), integração com bureaus de score.
