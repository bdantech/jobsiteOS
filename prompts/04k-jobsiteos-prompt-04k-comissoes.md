# JOBSITEOS — Claude Code Prompt 04k: Motor de Comissões v2
## VOP, parâmetros versionados, vínculo automático ao longo do funil e extrato live

> **Substitui integralmente** as regras de comissão implementadas no Prompt 04g (valor fixo por milhão, SDR por reunião agendada). **Reutiliza**: a aba **Comissões** do menu Comercial, as settings **"Vendedores e territórios"** e **"Regras de comissão"**, `vendedores`, `vendedor_carteira`, `vendedor_acessos`, `sdr_leads`, `vendas`, `empresas.gestao_operacao`, e os eventos `nf.convertida` / `antecipacao.regrediu` (04e). UI pt-BR, code English. Migrations via Supabase MCP.

---

## 0. Vocabulário (ATENÇÃO — não inverter)

O sistema usa `empresas.gestao_operacao` com dois valores. Mapeamento canônico:

| `gestao_operacao` | Significado | Chave dos parâmetros |
|---|---|---|
| `prospeccao_ativa` | Só opera com trabalho ativo do originador | `..._prospeccao_ativa` |
| `passivo` | O sacado traz as operações espontaneamente | `..._passivo` |

Nunca introduzir os termos "conta ATIVA/PASSIVA" no código ou na UI — usar sempre os dois valores acima.

## 1. Fato gerador e unidade de cálculo

**Fato gerador = NF CONVERTIDA** (evento `nf.convertida` do 04e — antecipação com status conversor casada à NF). Vendedor e originador **não correm risco de crédito**: a comissão nasce na conversão, não na liquidação.

```
VOP        = valor_cedido × (anticipation_days / dias_referencia_vop)
comissao   = (VOP / 1.000.000) × taxa_brl_por_mm
```
- `valor_cedido` = `grossValue` da antecipação
- `anticipation_days` = campo `anticipationDays` do payload (**usar este; não recalcular por datas**)
- `dias_referencia_vop` = 30 (parâmetro)

**Estornos** (únicos aplicáveis, dado que não há risco de crédito): `antecipacao.regrediu` (status vira não-conversor) ou `invoiceCancelledAt` preenchido → estorno de 100% dos lançamentos daquela cessão, em todos os papéis, na competência corrente. Recompra e inadimplência **não** geram clawback.

## 2. Parâmetros (`commission_params`) — geral + override por vendedor

```sql
create table commission_params (
  id uuid primary key default gen_random_uuid(),
  chave text not null,
  vendedor_id uuid references vendedores(id),   -- NULL = parâmetro geral da empresa
  valor numeric not null,
  unidade text not null,                        -- BRL_PER_MM | BRL | MONTHS | DAYS | PERCENT | BOOL
  vigente_de date not null,
  vigente_ate date,
  criado_por uuid references usuarios(id),
  criado_em timestamptz default now()
);
-- não-sobreposição por (chave, vendedor_id): usar exclusion constraint com daterange
alter table commission_params add constraint commission_params_sem_sobreposicao
  exclude using gist (
    chave with =,
    coalesce(vendedor_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    daterange(vigente_de, coalesce(vigente_ate, 'infinity'::date), '[)') with &&
  );
```
**Resolução**: para um evento na data D, valor = override do vendedor vigente em D → senão parâmetro geral vigente em D. Implementar em `packages/core` como `resolverParametro(chave, vendedorId, data)` **com testes**.

**Valores por vendedor**: taxas (R$/MM e valores de SDR). **Prazos são sempre gerais** (fases, sunset, janelas, dormência) — a UI não oferece override de prazo por vendedor.

### Seeds (vigente_de = data do deploy)
| Chave | Valor | Unidade |
|---|---|---|
| `dias_referencia_vop` | 30 | DAYS |
| `orig_prospeccao_ativa` / `orig_passivo` | 600 / 600 | BRL_PER_MM |
| `vend_prospeccao_ativa_crescimento` | 1000 | BRL_PER_MM |
| `vend_prospeccao_ativa_manutencao` | 600 | BRL_PER_MM |
| `vend_passivo_crescimento` | 400 | BRL_PER_MM |
| `vend_passivo_manutencao` | 200 | BRL_PER_MM |
| `fase_crescimento_prospeccao_ativa_meses` / `fase_crescimento_passivo_meses` | 6 / 6 | MONTHS |
| `sunset_vendedor_prospeccao_ativa_meses` | 24 | MONTHS |
| `sunset_vendedor_passivo_meses` | 18 | MONTHS |
| `sunset_originador_meses` | null (sem sunset) | MONTHS |
| `sdr_valor_reuniao` | 200 | BRL |
| `sdr_valor_conta_fechada` | 1500 | BRL |
| `sdr_sla_recusa_horas` | 48 | DAYS(horas) |
| `janela_atribuicao_sdr_dias` | 180 | DAYS |
| `dormencia_cedente_dias` | 60 | DAYS |
| `alerta_revisao_dias` / `alerta_revisao_percentual` | 45 / 50 | DAYS / PERCENT |
| `premio_transicao_multiplo` | 6 | MULTIPLIER — **flag OFF** |
| `carencia_migracao_dias` | 90 | DAYS — **flag OFF** |
| `reativacao_dormente_dias` | 90 | DAYS — **flag OFF** |

## 3. Ciclo de vida da conta (sacado)

- **Marco de ativação** = data da **primeira NF convertida** do sacado. Contrato assinado não inicia relógio. Campo `empresas.marco_ativacao`.
- **Fase** (idade em meses desde o marco, usando os parâmetros da `gestao_operacao` vigente): `≤ crescimento` → CRESCIMENTO · `> crescimento e ≤ sunset` → MANUTENCAO · `> sunset` → RESIDUAL (vendedor 0; originador segue).
- **Classificação `gestao_operacao`**: manual, só perfil gestor (já existe no 04g). Adicionar **histórico imutável**:
```sql
create table gestao_operacao_historico (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  valor_anterior text, valor_novo text not null,
  motivo text not null,                          -- obrigatório
  alterado_por uuid not null references usuarios(id),
  alterado_em timestamptz not null default now()
);
```
- **Sempre para frente**: cessões já convertidas mantêm a classificação/fase da data da conversão (snapshot no lançamento). Nunca recalcular retroativo. Mudança **não** reinicia o relógio.
- **Alerta de revisão** (sinalizador, nunca automação): sacado `passivo` cujo volume convertido nos últimos `alerta_revisao_dias` esteja abaixo de `alerta_revisao_percentual`% da média dos 3 meses anteriores → destaque no painel de reclassificação + evento `conta.revisao_sugerida`.

## 4. Titularidade automática (`vendedor_carteira`, temporal)

Vínculos criados **automaticamente ao longo do funil**, sem ação manual — mantendo a atribuição manual existente como override do gestor:

| Papel | Entidade | Gatilho automático | Liberação |
|---|---|---|---|
| **SDR** | sacado | Reunião **aceita** (§5) | Fim da janela de 180d sem fechamento |
| **Vendedor** | sacado | `vendas.estagio` → `ganho` (fechamento) | Desligamento (titularidade encerra; não transfere) |
| **Originador** | cedente (fornecedor) | Primeira NF convertida daquele cedente cujo **sacado** está na carteira de originação dele (settings "Vendedores e territórios" → `empresas_escolhidas`) | **Dormência**: cedente sem conversão por `dormencia_cedente_dias` volta ao pool |

Regras: um titular vigente por papel/entidade (split opcional com `share_pct` somando 100). Sacado ou cedente sem titular → aquela parcela **não é paga nem redistribuída**. **Vendedor de IA nunca gera lançamento** (nem para a casa). Cedente inbound/self-service sem toque prévio entra no pool sem titularidade.

## 5. SDR: fila de aceite

Reunião realizada (04g `reuniao_realizada`) entra em fila de aceite do vendedor destino. Aceita explicitamente, ou **expira como aceita** após `sdr_sla_recusa_horas` sem ação. Recusa exige motivo. No-show não gera comissão; reagendamento não duplica evento.
- **Reunião aceita** → lançamento `sdr_valor_reuniao` + vínculo SDR no sacado.
- **Conta fechada** → lançamento `sdr_valor_conta_fechada` na **primeira NF convertida** do sacado, se a reunião aceita ocorreu dentro de `janela_atribuicao_sdr_dias` antes.

## 6. Lançamentos e apuração live

```sql
create table comissao_lancamentos_v2 (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references vendedores(id),
  papel text not null,                    -- VENDEDOR | ORIGINADOR | SDR
  competencia date not null,              -- 1º dia do mês
  origem_tipo text not null,              -- nf_convertida | sdr_reuniao | sdr_conta_fechada | estorno | ajuste_manual
  origem_id text not null,                -- access_key / antecipacao id_externo / sdr_lead id
  empresa_id uuid references empresas(id),
  cedente_cnpj text,
  -- snapshot no momento do fato gerador (auditoria e recálculo determinístico)
  gestao_operacao text, fase text,
  valor_cedido numeric(14,2), anticipation_days int, vop numeric(16,2),
  taxa_brl_por_mm numeric(12,2), share_pct numeric(6,3) default 100,
  valor numeric(12,2) not null,           -- negativo em estorno
  params_snapshot jsonb not null,
  status text not null default 'provisionado',  -- provisionado | fechado | aprovado | pago | estornado
  criado_em timestamptz default now(),
  unique (papel, origem_tipo, origem_id, vendedor_id)
);
```
- **Live**: o handler do evento `nf.convertida` (e dos eventos de SDR) insere o lançamento **na hora**, status `provisionado` — o extrato do mês corrente atualiza em tempo real (Supabase Realtime na tela).
- **Fechamento mensal** (job no último dia útil, 23:59 SP): lançamentos `provisionado` da competência → `fechado`; competência fechada torna-se **imutável** (estorno posterior entra como lançamento negativo na competência corrente, nunca reescreve o passado). Gestor então **aprova** → `aprovado` → marca `pago`.
- **Trava de parâmetro**: a UI impede criar/editar parâmetro com `vigente_de` dentro de competência já fechada.

## 7. UI — aba Comissões (menu Comercial, reutilizar a existente)

**Visibilidade**: cada vendedor vê a própria; quem tem `vendedor_acessos` vê os concedidos; **admin vê todos, com seletor para ver um por vez** e visão consolidada.

1. **Mês corrente (live)**: total acumulado, quebra por papel, contador de cessões, comparativo com o mês anterior, badge "provisionado".
2. **Histórico mês a mês**: série (12 meses) com status de cada competência (fechada/aprovada/paga) e total por papel.
3. **Extrato detalhado** — a tela central: linha a linha, cada centavo rastreável. Colunas: data, origem (NF nº / sacado / cedente ou reunião / empresa), papel, `gestao_operacao`, fase, valor cedido, dias, **VOP**, taxa aplicada (R$/MM), share, **valor**, status. Cada linha expande mostrando o cálculo por extenso (`R$ 500.000 × 45/30 = 750.000 VOP → 0,75 × R$600 = R$450`) e o `params_snapshot`. Exportável em CSV.
4. **Simulador** (gestor): volume, dias, `gestao_operacao`, idade da conta → comissão de cada papel e custo total em R$/MM; permite comparar **parâmetros vigentes × propostos**.
5. **Settings "Regras de comissão"** (reutilizar): edição dos parâmetros com vigência obrigatória, geral e por vendedor (aba de override), com validação de sobreposição e bloqueio de período fechado. Flags §2 desativadas com explicação.
6. **Painel de reclassificação**: sacados com classificação atual, volume 3 meses, idade/fase, sinalizador de revisão, ação de mudança com **motivo obrigatório** e histórico.
7. **Fila de aceite SDR**: reuniões pendentes com contador de SLA e ação aceitar/recusar.

**Mobile**: mês corrente, histórico e extrato (leitura + expandir cálculo); fila de aceite SDR (aceitar/recusar) e aprovação de competência para gestores. Settings, simulador e reclassificação = `webOnly`.

## 8. Casos de borda (implementar explicitamente, com testes)

| Situação | Tratamento |
|---|---|
| Conversão na data da mudança de classificação | Vale a classificação **anterior** (mudança vige no dia seguinte) |
| Conversão após o sunset do vendedor | Taxa do vendedor = 0; originador segue |
| Cedente com mais de um sacado | Comissão do originador por cessão, usando classificação/fase **do sacado daquela cessão** |
| Sacado sem vendedor titular | Parcela não paga nem redistribuída |
| Cedente sem originador titular | Idem |
| Conversão parcial / estorno parcial | Comissão proporcional ao valor efetivamente convertido |
| Colaborador desligado | Lançamentos já criados são devidos; titularidade encerra na data (vendedor_carteira `ate`) |
| Vendedor de IA titular | Nenhum lançamento gerado |

## 9. Migração do 04g

Manter as tabelas antigas (`comissao_regras`, `comissao_lancamentos`) apenas como histórico read-only; toda a UI passa a ler `comissao_lancamentos_v2` e `commission_params`. Se houver lançamentos antigos, **não recalcular** — exibir competências anteriores a partir da tabela antiga, marcadas como "modelo anterior".

## 10. Entregáveis

**Worker/handlers**: handler live de `nf.convertida`, `antecipacao.regrediu`, eventos de SDR; `comissao/fechar-competencia` (mensal); `comissao/liberar-dormentes` (diário); `comissao/alerta-reclassificacao` (semanal); `comissao/expirar-aceites-sdr` (horário).
**Core**: `calcularVOP`, `resolverParametro`, `determinarFase`, motor de lançamento — com testes cobrindo cada caso do §8, resolução de override/vigência e imutabilidade de competência fechada.
**Eventos**: `comissao.lancada`, `comissao.estornada`, `competencia.fechada`, `competencia.aprovada`, `titularidade.atribuida`, `titularidade.liberada`, `conta.revisao_sugerida`, `sdr.aceite_pendente`.
**Docs**: README — fórmula do VOP com exemplo, mapa `gestao_operacao` ↔ taxas, gatilhos de titularidade, ciclo provisionado→fechado→aprovado→pago.

## 11. Fora de escopo

Prêmio de transição, carência de migração e reativação de dormente (flags OFF), pagamento/integração com folha, comissão de gestor/override hierárquico, split automático entre vendedores.
