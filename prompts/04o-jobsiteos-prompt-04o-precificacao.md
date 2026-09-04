# JOBSITEOS — Claude Code Prompt 04o: Motor de Precificação & Publicação das Condições
## Sugestão de taxas por porte/perfil, validação espelhada do contrato de produção e webhook acionável

> Builds on Prompts 04d (esteira), 04j (análise proprietária, scorecard) e **04n** (API e webhook para a plataforma de produção — este prompt **estende** o payload e **atualiza** a documentação já gerada). Reuse: `analises_credito`, `empresa_scores`, faturamento estimado (04c), decisão Atradius, `webhooks_saida`/`webhook_entregas`, `onepay_company_id` (03/04h). UI pt-BR, code English. Migrations via Supabase MCP.

---

## 1. Contexto e mudança de natureza do webhook

Quando uma análise é **aprovada** na esteira, o analista de Crédito precisa definir as **condições comerciais** (taxas, tarifas, limites). Essas condições são publicadas para a plataforma de produção, que as usa para criar a análise de crédito de verdade.

**Consequência crítica**: o webhook do 04n deixa de ser informativo e passa a ser **acionável** — o payload alimenta um `POST /api/backoffice/credit-analyses` do lado deles, validado por Zod. Portanto o JobsiteOS **valida localmente as mesmas regras antes de publicar**; falhou a validação, não dispara webhook e mostra o erro ao analista.

## 2. Modelo

```sql
create table condicoes_comerciais (
  id uuid primary key default gen_random_uuid(),
  analise_credito_id uuid not null references analises_credito(id),
  empresa_id uuid references empresas(id),
  cnpj text not null,
  -- limites
  credit_limit numeric(14,2) not null,
  max_invoice_amount numeric(14,2) not null,      -- 500 a 10.000.000
  max_due_date_days int not null,                 -- 5 a 365
  expires_at date not null,
  -- juros mensais
  monthly_rate_d0 numeric(6,3) not null,
  monthly_rate_d1 numeric(6,3) not null,
  -- tarifas (ver §4 — modelo proporcional)
  fee_d0 numeric(10,2) not null, fee_min_d0 numeric(10,2) not null,
  fee_d1 numeric(10,2) not null, fee_min_d1 numeric(10,2) not null,
  -- acessórios
  commission_percent numeric(6,3) not null,
  extension_rate_percent numeric(6,3) not null,   -- prorrogação
  bill_fine_percent numeric(6,3) not null,        -- multa
  invest_back_limit numeric(14,2) not null default 0,
  invest_back_commission_percent numeric(6,3) not null default 0,
  -- flags
  has_insurance boolean not null,
  has_referral boolean not null default false,
  fidc_ready boolean not null default true,
  -- rastreabilidade
  sugestao jsonb not null,                        -- o que o motor sugeriu
  ajustes jsonb,                                  -- o que o analista mudou, campo a campo
  matriz_versao int not null,
  status text not null default 'rascunho',        -- rascunho | publicada | falha_validacao | substituida
  definida_por uuid references usuarios(id),
  publicada_em timestamptz, erro_validacao text,
  criada_em timestamptz default now()
);
create index on condicoes_comerciais (analise_credito_id, criada_em desc);
```

Nova versão substitui a anterior (`status = 'substituida'`) — histórico preservado, nunca update destrutivo.

## 3. Motor de sugestão (matriz versionada)

```sql
create table precificacao_matriz (
  versao int primary key,
  definicao jsonb not null,      -- faixas globais + células por dimensão
  ativa boolean default false,
  criada_por uuid references usuarios(id), criada_em timestamptz default now()
);
```

**Faixas globais (config, ajustáveis — piso e teto de tudo)**:
```jsonc
{
  "juros": { "d0_min": 1.9, "d0_max": 3.4, "d1_desconto_min": 0.1, "d1_desconto_max": 0.6 },
  "tac":   { "fee_d0_min": 150, "fee_d0_max": 300,
             "fee_min_d0_pct_do_fee": 0.5,        // sugestão do feeMin como % do fee (config)
             "fee_d1_desconto_pct_min": 0.1, "fee_d1_desconto_pct_max": 0.3 },
  "limiar_proporcionalidade_tac": 10000,          // §4
  "comissao": { "min": 1.0, "max": 3.0 },
  "max_invoice_amount_default": 1000000,
  "max_due_date_days_default": 90,
  "validade_meses_default": 12,
  "fixos": { "bill_fine_percent": 2.0, "extension_rate_percent": 12.0,
             "invest_back_limit": 0, "invest_back_commission_percent": 0,
             "has_referral": false, "fidc_ready": true }
}
```

**Dimensão principal: porte/faturamento estimado** (04c), com **ajustes** por: faixa de score (04d), presença de cobertura Atradius, protesto, prazo médio das NFs e ticket médio. Cada célula define **sugerido** para juros D0, comissão, `fee_d0` e limites; o motor deriva D1 e os `feeMin` pelas regras de desconto/percentual da config.

Semente da matriz (editável, 5 faixas de faturamento × 3 faixas de score): empresas maiores e score alto → juros perto de 1,9% e TAC perto de 150; menores e score baixo → perto de 3,4% e 300. Cobertura Atradius reduz; protesto recente aumenta.

**Regras duras de validação (motor e formulário)**:
- `monthly_rate_d0` **>** `monthly_rate_d1` e `fee_d0` **>** `fee_d1` (D0 é o produto mais caro — **o exemplo do contrato de produção está invertido; ignorar o exemplo, seguir esta regra**).
- `fee_min_d0` ≤ `fee_d0` · `fee_min_d1` ≤ `fee_d1` · `invest_back_limit` ≤ `credit_limit`.
- Percentuais ≥ 0 e < 100 · `credit_limit` > 0 · `max_invoice_amount` entre 500 e 10.000.000 · `max_due_date_days` inteiro entre 5 e 365 · `expires_at` no formato AAAA-MM-DD e futuro.
- Valores fora da faixa global da config: permitidos **apenas com justificativa obrigatória** registrada (o analista decide sozinho, mas fica o rastro).

## 4. TAC proporcional (semântica que NÃO pode ser implementada errado)

`fee_min` **não é piso de segurança — é a TAC efetiva das notas pequenas**. A tarifa cresce proporcionalmente ao valor da nota até o limiar (config, default R$ 10.000), onde atinge `fee` e para:

```
TAC = fee_min + (fee − fee_min) × min(valor_nf / limiar, 1)
```
Exemplo com `fee_d0 = 300`, `fee_min_d0 = 150`, limiar 10.000: NF de R$ 10.000+ → R$ 300 · NF de R$ 5.000 → R$ 225 · NF de R$ 1.000 → R$ 165.

Implementar em `packages/core` com testes e **exibir na UI um simulador** mostrando a TAC resultante para NFs de R$ 1k, 5k, 10k e 50k — e a **taxa efetiva combinada** (juros + TAC ÷ valor), porque a tarifa fixa é regressiva e uma taxa "boa" pode ficar cara no ticket pequeno.

## 5. Preenchimento automático

- `has_insurance`: **derivado** da decisão Atradius (04d/04j) — aprovada vigente → true.
- `has_referral`: false (fixo) · `fidc_ready`: true (fixo) · invest back: zerado (fixo) · multa 2% · prorrogação 12% — todos vindos de `fixos` na config, editáveis lá, não no formulário.
- `credit_limit`: pré-preenchido com o limite aprovado da esteira (04d) ou o `limite_recomendado` da análise proprietária (04j).
- `expires_at`: hoje + `validade_meses_default`.
- `role`: sempre **`PAYER`** (esta esteira é só sacado) · `status`: sempre **`APPROVED`**.
- Identificação da empresa: **`companyId`** quando `empresas.onepay_company_id` existir; caso contrário **`document` + `subjectName`** (razão social). Exatamente um dos dois — enviar ambos é erro no contrato deles.

## 6. UI (esteira de crédito)

Ao entrar em `aprovada`, o detalhe da análise ganha a seção **"Condições comerciais"**:
- Formulário com todos os campos **pré-preenchidos pela sugestão**, cada um mostrando a faixa permitida e um indicador de onde a sugestão caiu dentro dela.
- Painel lateral com o **porquê da sugestão**: faturamento estimado, faixa de score, cobertura, protesto — e a célula da matriz aplicada.
- **Simulador** (§4) atualizando em tempo real conforme o analista mexe.
- Validação instantânea das regras do §3; erro impede publicar.
- Botão **"Publicar para a plataforma"** → grava `condicoes_comerciais` como `publicada`, dispara o webhook (§7), mostra o resultado da entrega. Falha de validação → `falha_validacao` com a mensagem exata.
- Histórico de versões das condições.
- **Admin → Precificação** (`webOnly`): editor da matriz e das faixas globais, com preview ("com esta matriz, as 47 análises aprovadas do último trimestre teriam ficado assim"), versionamento e ativação.

**Mobile**: leitura das condições e do simulador; publicar e editar = `webOnly` (decisão de preço merece tela grande).

## 7. Extensão do webhook (04n)

**Novo evento**: `credito.condicoes_definidas`, disparado na publicação. E o bloco abaixo passa a integrar **todos** os eventos do 04n quando houver condições publicadas (ausente = `null`, chave sempre presente):

```jsonc
"condicoes_comerciais": {
  "definidas_em": "2026-09-04T15:20:00Z",
  "versao": 2,
  "payload_producao": {          // pronto para POST /api/backoffice/credit-analyses
    "companyId": 748,            // OU "document" + "subjectName" (exatamente um)
    "role": "PAYER",
    "status": "APPROVED",
    "expiresAt": "2027-09-04",
    "creditLimit": 500000,
    "commissionPercent": 2.5,
    "extensionRatePercent": 12,
    "billFinePercent": 2,
    "monthlyRateD0": 2.9,
    "monthlyRateD1": 2.674,
    "feeD0": 300, "feeMinD0": 150,
    "feeD1": 250, "feeMinD1": 125,
    "maxInvoiceAmount": 1000000,
    "maxDueDateDays": 90,
    "hasInsurance": false,
    "hasReferral": false,
    "fidcReady": true,
    "investBackLimit": 0,
    "investBackCommissionPercent": 0
  }
}
```

O objeto `payload_producao` usa **exatamente** os nomes de campo do contrato deles (camelCase) — o time de produção repassa como está, sem transformação. O builder de payload continua único (mesmo código para webhook e `GET`).

## 8. Atualizar a documentação existente (entregável obrigatório)

**Editar** `/docs/integracao-credito-plataforma-producao.md` (gerado no 04n), acrescentando:
1. Nova seção **"Condições comerciais aprovadas"**: o que são, quando são publicadas, e o fluxo completo (aprovação na esteira → analista define → publicação → webhook → criação da análise em produção).
2. Documentação do evento **`credito.condicoes_definidas`** e do bloco `condicoes_comerciais` presente nos demais eventos.
3. **Tabela de campos de `payload_producao`** — nome, tipo, obrigatório, faixa/validação e descrição de negócio — casada com o contrato Zod de produção, incluindo as três validações cruzadas.
4. Explicação da **TAC proporcional** (§4) com a fórmula e exemplos numéricos — o time de produção precisa entender que `feeMin` é a tarifa das notas pequenas, não um piso de segurança.
5. Nota explícita: **`monthlyRateD0 > monthlyRateD1` e `feeD0 > feeD1`** (o exemplo original do contrato está invertido).
6. Regra de identificação: `companyId` **ou** `document` + `subjectName`, nunca ambos.
7. Exemplo `curl` completo repassando o `payload_producao` recebido para o endpoint deles.
8. Atualizar o checklist de homologação com o teste das condições comerciais.

## 9. Entregáveis

**Core**: motor de sugestão (matriz → condições), calculadora de TAC proporcional, validador espelhando o Zod de produção — todos com testes (incluindo cada validação cruzada e os limites de faixa).
**Web**: seção de condições na esteira com simulador e justificativa para fora-da-faixa; Admin → Precificação com preview e versionamento.
**Worker**: publicação e entrega do webhook (reusa a fila do 04n).
**Eventos**: `condicoes.sugeridas`, `condicoes.publicadas`, `condicoes.falha_validacao`, `precificacao.matriz_ativada`.
**Docs**: atualização do arquivo do §8 + seção no README interno.

## 10. Fora de escopo

Precificação de cedente (`SUPPLIER`), precificação dinâmica por operação, renegociação de condições vigentes, sincronização reversa (produção → JobsiteOS) de alterações de condições.
