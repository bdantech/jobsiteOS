# JOBSITEOS — Claude Code Prompt 04f: Perfil de Quem Opera
## Feedback loop: características de sacados que operam e fornecedores que convertem → sugestões de ajuste de regras em um clique

> Builds on Prompts 01–04e. Reuse pesado: catálogo de variáveis do filter engine, `camada_regras` e `faixa_regras` (editores versionados com preview), `clientes_onepay` + snapshots, `antecipacoes`, `notas_fiscais`, `protestos_atual`, `empresa_metricas`, certificados, worker. UI pt-BR, code English. Migrations via Supabase MCP.
> **Princípio de UX inegociável: tudo legível por não-analista.** Cada achado é uma frase em português + um número + uma barra. Nada de jargão estatístico na superfície (os detalhes ficam num "ver como calculamos" expansível).

---

## 1. Conceito

Duas perguntas, duas trilhas:
- **Trilha SACADOS** — "como são as construtoras que mais operam?" → alimenta ajustes das **regras de camada** (pirâmide TAM/SAM/SOM).
- **Trilha FORNECEDORES** — "como são os fornecedores cujas NFs convertem?" → alimenta ajustes das **regras de faixa** (alta/boa/média do funil).

O sistema **recomenda com evidência; nunca aplica sozinho**. Toda sugestão vira nova versão de regra pelo editor que já existe (preview de impacto + ativação humana).

## 2. Coortes (recalculadas pelo job; definições em config `perfil_config`)

**Sacados** (base: `clientes_onepay` + snapshots + `antecipacoes` como sacado):
- `pesados`: consumed_pct_2m ≥ 0.6 OU antecipations_last_2m ≥ 6 (config)
- `medios`: atividade entre os cortes
- `dormentes`: days_without_anticipation ≥ 30 (config)
- Controle para camadas: empresas SOM/SAM não-clientes (mesma régua de variáveis)

**Fornecedores** (base: `antecipacoes` como contracted + `notas_fiscais`):
- `conversores`: ≥ 1 antecipação com status conversor nos últimos 90 dias
- `expostos_nao_conversores`: tiveram NF em faixa (alta/boa/média) no período e não converteram — **este é o controle principal** (mesma população exposta → menos viés)

Comparações-chave (pré-definidas, não configuráveis pelo usuário para manter simplicidade): pesados × dormentes · clientes × SOM não-cliente · conversores × expostos não-conversores.

## 3. Variáveis analisadas (usar TODAS as disponíveis; pular silenciosamente as sem dado suficiente)

**Empresa (ambas as trilhas)**: uf, municipio (top-N), tipo (construtora/incorporadora/fornecedor/subempreiteiro), **natureza jurídica** — derivar categoria simples `LTDA | S.A. | EIRELI/SLU | outras` com helper em `packages/core` a partir do código —, idade_anos (em faixas), capital_social (faixas), porte_rfb, **regime tributário** (simples | saiu do simples | presumido | desconhecido), qtd_filiais, grupo_spes_total e grupo_spes_24m, obras_ativas, m2_em_execucao, obras_iniciadas_24m, erp_conhecido, erp_atual (top-N), erp_mrr (faixas), qtd_usuarios_erp, funcionarios (faixas), funcionarios_crescimento_12m, faturamento_estimado (faixas), **tem_protesto**, valor_protestos relativizado (faixas de ratio), protesto_recente (<90d), certificado_ativo, score_credito (faixas), tipagem_antecipacao.

**NF (trilha fornecedores, além das da empresa)**: dias_para_vencimento na emissão (faixas), valor da NF (faixas), tipo (NFe/NFSe), sacado_credito_status, sacado_limite_cobre_nota, faixa atribuída, qtd de NFs vivas do fornecedor no momento, ticket médio do fornecedor, nº de sacados distintos do fornecedor, receita_esperada (faixas).

## 4. O cálculo (job `perfil/recalcular` — mensal + botão manual)

Para cada variável × comparação: distribuição nas duas coortes + **lift** (razão de prevalência) + N de cada lado. Regras de honestidade:
- N < mínimo (config, default 15 por lado na célula) → achado marcado `indicativo` (badge cinza "poucos dados") e nunca vira sugestão automática.
- Cobertura da variável (% da coorte com dado) exibida; < 40% → achado suprimido do painel principal (visível em "ver tudo").
- Snapshot completo do resultado em `perfil_snapshots` (id, trilha, comparacao, resultados jsonb, calculado_em, versao_regras_vigentes) — a evolução do perfil no tempo é sinal estratégico; gráfico simples de tendência dos top achados entre snapshots.

## 5. Auditoria das regras vigentes (a parte que morde)

Rodar as coortes ATRAVÉS das regras ativas (compilador de filtros existente):
- **Camadas**: "X% dos sacados pesados NÃO passariam na regra de SOM vigente" + lista de quais condições os barram (contagem por condição — ex.: "idade ≥ 6 barra 12 deles; capital ≥ 1M barra 5").
- **Faixas**: taxa de conversão real por faixa e por versão de regra ("faixa alta converteu 34%, boa 11%, média 4% nos últimos 90 dias") + "X% das NFs que converteram estavam FORA de qualquer faixa quando convertidas".

## 6. Motor de sugestões (o um-clique)

Gerador de sugestões a partir de dois padrões, cada uma com evidência anexada:
1. **Afrouxar condição que barra operadores**: condição da regra vigente que exclui ≥ Y% (config, default 10%) da coorte operadora → sugerir o ajuste mínimo que os incluiria (ex.: `idade_anos ≥ 6` → `≥ 3`).
2. **Adicionar sinal com lift alto**: variável com lift ≥ Z (config, default 2.0) e N suficiente que não está na regra → sugerir como novo termo do OR de sinais (camadas) ou condição de faixa (NFs).

Cada card de sugestão mostra, nesta ordem: frase simples ("Fornecedores com NF vencendo em 30–60 dias convertem 3,2× mais"), evidência (números + barras das duas coortes), impacto simulado via dry-run do compilador ("aplicar adiciona ~2.400 empresas ao SOM" / "move ~180 NFs para faixa alta"), e o botão **"Criar nova versão com este ajuste"** → abre o editor da regra correspondente (`camada_regras` ou `faixa_regras`) com a alteração JÁ APLICADA no rascunho, seguindo o fluxo normal: preview de impacto → ativar. Nada é ativado direto do card.

```sql
create table perfil_snapshots (
  id uuid primary key default gen_random_uuid(),
  trilha text not null,             -- 'sacados' | 'fornecedores'
  comparacao text not null,
  resultados jsonb not null,        -- por variável: distribuições, lift, n, cobertura
  auditoria jsonb,                  -- resultados do §5
  sugestoes jsonb,                  -- geradas neste cálculo
  versao_regras jsonb,              -- versões vigentes de camadas/faixas no momento
  calculado_em timestamptz default now()
);
create table perfil_sugestoes_log ( -- rastreabilidade do um-clique
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid references perfil_snapshots(id),
  sugestao jsonb not null,
  acao text,                        -- 'aceita' | 'descartada'
  regra_tipo text, regra_versao_criada int,
  usuario_id uuid references usuarios(id),
  em timestamptz default now()
);
```

## 7. UI — painel "Perfil de Quem Opera" (módulo Mercado; webOnly exceto leitura)

Duas abas no topo: **Sacados** e **Fornecedores**. Cada aba, de cima pra baixo:
1. **Resumo em uma frase** ("Seus operadores pesados típicos: incorporadora LTDA de SP/SC, 5–15 anos, 2+ SPEs recentes, sem protesto") — gerada por template a partir dos top lifts, não por IA.
2. **Top achados** (cards com frase + barras das duas coortes + lift; badge de confiança; "ver como calculamos" expansível). Botão "ver todas as variáveis" abre a tabela completa.
3. **Auditoria das regras** (§5) com as frases de mordida.
4. **Sugestões** (§6) com o botão de um clique. Sugestões descartadas somem (log preserva).
5. Rodapé fixo com o aviso de viés, em linguagem simples: "Este perfil descreve quem já chegou até nós — ele pode refletir onde historicamente prospectamos, não só quem é bom. Use como evidência, não como verdade."
6. **Botão "Recalcular agora"** no topo (dispara o job; mostra progresso; desabilitado enquanto roda). Job também agendado mensal, encadeado após as calibrações do 04c/04d.

**Mobile**: leitura das duas abas (resumo, top achados, auditoria). Sugestões e recálculo = webOnly.

## 8. Tools de IA e eventos

- `perfil.resumo` (read): resumo e top achados por trilha em linguagem natural.
- `perfil.sugestoes_pendentes` (read).
- `perfil.recalcular` (mutates): dispara o job.
Eventos: `perfil.recalculado`, `perfil.sugestao_aceita` (payload: regra e versão criada), `perfil.sugestao_descartada`. Seed `notificacao_regras`: `perfil.recalculado` → Admin.

## 9. Entregáveis

**Worker**: `perfil/recalcular` (coortes → contrastes → auditoria → sugestões → snapshot). **Core**: helper de categoria de natureza jurídica; cálculo de lift/cobertura com testes (incluindo N mínimo e supressão por cobertura). **Web/Mobile**: conforme §7. **Docs**: README — como ler lift, por que existe o aviso de viés, fluxo sugestão→versão de regra.

## 10. Fora de escopo

Score de semelhança individual por empresa (fase 2), aplicação automática de regras, modelos estatísticos além de contraste/lift (regressões/ML ficam para quando houver mais histórico).
