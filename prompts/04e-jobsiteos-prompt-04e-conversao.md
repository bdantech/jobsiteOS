# JOBSITEOS — Claude Code Prompt 04e: Sync de Antecipações & Conversão Automática de NFs
## Fecha o loop do funil: antecipação realizada na plataforma → NF marcada como convertida

> Small focused prompt building on Prompt 04 (funil de NFs). Reuse: worker patterns, `notas_fiscais`, event log, `notify()`, `mercado_ingestoes`. UI pt-BR, code English. Migrations via Supabase MCP.

---

## 1. Fonte

`GET {ONEPAY_BI_URL}/api/v1/anticipations` — paginado (`page`, `pageSize`, `totalPages`), filtro `period` por **data de criação** (`createdAt`). Payload por item:

```json
{ "id": 13859, "status": "APPROVED", "anticipationType": "D0", "documentNumber": "84",
  "requestDate": "2026-08-03", "createdAt": "2026-07-31T15:03:18",
  "originalDueDate": "2026-08-14", "completionDate": null, "anticipationDays": 11,
  "grossValue": 42800.00, "witholdTaxAmount": 4280.00, "discountedAmount": 38520.00,
  "netValue": 37854.40, "totalSpreadAmount": 665.60, "monthlyInterestRate": 2.35,
  "contractor": { "name": "CONSTRUTORA EXEMPLO LTDA", "taxId": "12345678000190" },
  "contracted": { "name": "FORNECEDOR EXEMPLO LTDA", "taxId": "98765432000110" },
  "approvalWithAutomation": false, "invoiceCancelledAt": null }
```

Semântica: `contractor` = **sacado** (construtora) · `contracted` = **fornecedor** (cedente).

## 2. Banco

```sql
create table antecipacoes (
  id_externo int primary key,
  status text not null,
  status_anterior text,
  anticipation_type text,
  document_number text,
  numero_normalizado text,           -- ver §4
  sacado_cnpj text not null,
  fornecedor_cnpj text not null,
  request_date date, created_at_plataforma timestamptz,
  original_due_date date, completion_date timestamptz,
  anticipation_days int,
  gross_value numeric(14,2), withhold_tax numeric(14,2),
  discounted_amount numeric(14,2), net_value numeric(14,2),
  total_spread numeric(14,2), monthly_interest_rate numeric(6,3),
  approval_with_automation boolean,
  invoice_cancelled_at timestamptz,
  -- matching
  access_key_casada text references notas_fiscais(access_key),
  match_confianca text,              -- exata | valor_confirmado | null
  match_em timestamptz,
  match_status text default 'pendente', -- pendente | casada | sem_nf | revisao | ignorada
  raw jsonb,
  sincronizada_em timestamptz default now()
);
create index on antecipacoes (fornecedor_cnpj, sacado_cnpj, numero_normalizado);
create index on antecipacoes (match_status);
create index on antecipacoes (status);
```

## 3. Sync (worker job `antecipacao/sync-antecipacoes`)

- **Agenda**: mesmo cron de 4/4h do sync de NFs, **encadeado logo após** `antecipacao/sync-nfs` (as NFs novas chegam primeiro; o matching roda em cima da base atualizada).
- **Janela**: `period` cobrindo os **últimos 3 dias** por data de criação (uma antecipação criada há 3 dias pode ser aprovada hoje; o filtro do endpoint é por criação, então a janela recaptura mudanças de status).
- **Idempotente por `id_externo`** (upsert). Mudança de `status` → grava `status_anterior`, emite `antecipacao.status_alterado`.
- Normalizar CNPJs (14 dígitos texto). Registrar execução em `mercado_ingestoes` (fonte `onepay_antecipacoes`), política padrão de retry/alerta.

## 4. Matching (o coração — precisão acima de recall)

### 4.1 Normalização do número
Função compartilhada em `packages/core` (com testes), aplicada a `documentNumber` E a `notas_fiscais.numero`:
1. Trim; uppercase.
2. Remover componente de série quando presente como sufixo separado: padrões `8821/1`, `8821-001`, `8821 S1`, `8821 SERIE 1` → núcleo `8821` (a série da NF já existe em campo próprio; no matching, série NÃO participa).
3. Remover separadores não numéricos restantes (`.`, `,`, espaço).
4. **Remover zeros à ESQUERDA** (`0084` → `84`).
5. **NUNCA remover zeros à direita** — `84` e `840` são notas diferentes. Casos onde uma fonte parece ter zeros extras ao final são tratados pelo desempate por valor (§4.2), não pela normalização.

### 4.2 Regras de casamento (nesta ordem, por antecipação com status conversor)
Candidatas = `notas_fiscais` com `fornecedor_cnpj` E `sacado_cnpj` iguais:
1. **Match exato**: `numero_normalizado` igual E única candidata → casa (`match_confianca = 'exata'`).
2. **Match exato com múltiplas candidatas** (raro: mesmo número em séries diferentes): desempata por `gross_value` ≈ `valor` da NF (tolerância 1%); se uma única bate → casa (`valor_confirmado`); senão → `revisao`.
3. **Match fuzzy** (números divergem só por prefixo/sufixo de zeros ou truncamento — ex.: `84` vs `840`, `8821` vs `88210`): só casa se `gross_value` ≈ `valor` (1%) E vencimentos compatíveis (±5 dias entre `originalDueDate` e `vencimento`) → `valor_confirmado`; senão → `revisao`.
4. **Nenhuma candidata** → `match_status = 'sem_nf'` (a NF pode não ter chegado no sync ainda — re-tentar nos próximos ciclos enquanto a antecipação estiver na janela + 7 dias; depois fica `sem_nf` definitivo com evento).

**Nunca converter por palpite**: qualquer ambiguidade → `revisao`, nunca auto-conversão.

### 4.3 Status da antecipação
- **Convertem** (`status` conversor): `APPROVED`, `REVISION`, `PAY_OUT`, `BILLET_SWAPPED`, `PROGRAMED_PAYMENT`, `CONCLUDED`, `EXPIRED_BILL_SWAPPED`, `EXTENDED_BILL_SWAPPED`, `IN_EXTENSION_BILL_SWAPPED`.
- **Não convertem**: `DRAFT`, `REQUESTED`, `REPROVED`, `DENY_BY_CONTRACTED`, `PAYMENT_REPROVED`. Antecipações nesses status são sincronizadas e casadas quando possível (visibilidade), mas NÃO disparam conversão.
- Lista de status conversores em config (`antecipacao_config.status_conversores`) — se a plataforma criar status novo, é edição de settings, não deploy.

### 4.4 Efeitos da conversão
Ao casar antecipação com status conversor:
- NF: `estagio_funil = 'convertida'` (ator = sistema; motivo referenciando `id_externo`), `faixa_motivo` preservado.
- Evento `nf.convertida` (payload: id da antecipação, valores, taxa real) → já alimenta as métricas por faixa do Prompt 04 com conversões REAIS.
- Fornecedor: atualizar `empresas.ultima_antecipacao` e recalcular `tipagem_antecipacao` (vira/permanece `recorrencia`).

### 4.5 Regressões (não reverter silenciosamente)
Se uma antecipação **já casada e convertida** depois: muda para status não-conversor OU ganha `invoice_cancelled_at` → **não reverter o estágio automaticamente**. Emitir `antecipacao.regrediu` (payload: de→para), marcar a NF com flag `conversao_em_disputa = true` (nova coluna), notificar perfis Admin + Comercial. Humano decide o estágio correto — regressão financeira é exceção que merece olho, não automação.

## 5. Calibração com economia real (bônus)

Job mensal `antecipacao/calibrar-economia`: das antecipações concluídas dos últimos 90 dias, calcular medianas reais de `monthly_interest_rate`, `anticipation_days` e ticket (`gross_value`) e exibi-las na tela de settings do módulo ao lado dos valores configurados (`taxa_padrao_am`, `prazo_medio_dias`, `valor_medio_nf`), com botão "Aplicar valores da carteira" (atualiza as configs usadas pela receita esperada do funil e pelo módulo de crédito 04d). Nunca aplicar automaticamente — mostrar e deixar o operador decidir.

## 6. UI

**Web**: aba "Antecipações" no módulo Antecipação — tabela sincronizada (status, valores, match_status), **fila de revisão** (casos `revisao` e `sem_nf` definitivos: mostrar a antecipação + candidatas próximas, ações "casar com esta NF" / "ignorar" com motivo), indicador de taxa de casamento automático. Card da NF no funil ganha selo "Convertida via antecipação #id" com valores.
**Mobile**: NF convertida atualiza no funil normalmente (sem tela nova); push opcional de `nf.convertida` já coberto pelas regras do Prompt 04.

## 7. Eventos e tools

Eventos: `antecipacao.sincronizada` (primeira vez), `antecipacao.status_alterado`, `antecipacao.casada`, `antecipacao.sem_nf`, `antecipacao.regrediu`, `nf.convertida` (já existente — agora com origem automática).
Tools: `antecipacao.status_conversoes` (read: taxa de casamento, conversões do período, pendências de revisão); `antecipacao.casar_manual` (mutates: vincula antecipação a uma NF — usado também pela fila de revisão).

## 8. Entregáveis

**Worker**: `antecipacao/sync-antecipacoes` (4/4h encadeado), re-matching de pendentes a cada ciclo, `antecipacao/calibrar-economia` (mensal). **Core**: normalizador de número de NF + motor de matching com testes cobrindo: zeros à esquerda, série embutida, zeros à direita (NÃO casar sem valor), múltiplas candidatas, tolerância de valor, regressão de status. **Web/Mobile**: conforme §6. **Env**: reutiliza `ONEPAY_BI_URL`/token.

## 9. Fora de escopo

Conversão de estágios intermediários (a antecipação converte direto; estágios de prospecção continuam manuais/via toques), reversão automática de conversão, conciliação financeira de valores pagos.
