# Requisição — Títulos e liquidação: Plataforma de Produção → JobsiteOS

> **Atendida em 28/09/2026** com `GET /api/v1/anticipation-settlements` (forma A). O
> JobsiteOS passou a ler `titulos` desse endpoint na migração 0273; ver
> [`cobranca.md`](cobranca.md#a-lacuna-de-dados-da-produção). O restante deste documento
> é o pedido original, mantido como registro.

Documento para o time que mantém a API da plataforma de produção. Não pressupõe nenhum
conhecimento do JobsiteOS. É um **pedido**: descreve o que precisamos ler de vocês, por
que cada campo importa e o que fazemos enquanto ele não existe.

Mesmo formato e mesma autenticação do que já consumimos hoje (`/api/v1/anticipations`,
`/api/v1/invoices`); a contrapartida — o que nós expomos a vocês — está em
[`integracao-credito-plataforma-producao.md`](integracao-credito-plataforma-producao.md).

---

## 1. Visão geral

Cada antecipação que vocês operam gera, do nosso lado, um **título cedido**: o recebível
que a cessionária comprou do fornecedor (cedente) e que a construtora (sacado) tem de
pagar no vencimento. Esses títulos estão segurados pela apólice de crédito Atradius
**9000373_SUSEP**, e a apólice conta prazos **sobre o vencimento e sobre o pagamento de
cada título**:

```
  vencimento original (D)
        │
        ├── D+60   parada automática de cobertura do sacado      (cl. 17700.20 a)
        ├── D+90   prazo final para avisar a seguradora            (cl. 18500.01)
        │          perdê-lo = perder o direito à indenização      (cl. 28509.01 iv)
        ├── D+180  Data da Perda                                   (cl. 00500.00)
        └── D+360  prazo final do sinistro                          (cl. 22100.20 §1)

  pagamento pelo sacado
        └── decide QUANDO a cobertura volta, e se volta com efeito retroativo
```

Hoje o JobsiteOS **infere** o título a partir de `/api/v1/anticipations`, e isso não
basta: a antecipação conta o ciclo da **operação** (pedido, aprovação, desembolso,
conclusão), não a vida do **título** depois do desembolso. O que precisamos é saber, por
título, **se e quando o sacado pagou, quanto, e contra qual limite**.

Três regras para tudo abaixo:

1. **Leitura apenas.** Não pedimos para escrever nada do lado de vocês.
2. **Fato, não interpretação.** Se um campo não é conhecido, mandem `null`. Nós
   degradamos a tela e avisamos; um valor presumido do lado de vocês vira um prazo de
   apólice contado errado do nosso.
3. **O vencimento original nunca muda.** Prorrogação vai num campo separado (§3.2).

---

## 2. Autenticação, ambientes e URLs

A mesma chave de serviço que o worker do JobsiteOS já usa em `/api/v1/anticipations`
(header `Authorization: Bearer …`), no mesmo host de produção e de homologação. Nada novo
a emitir.

### Volume e ritmo

- A ordem de grandeza hoje é de **1.300 antecipações** projetadas como título; o
  crescimento acompanha as antecipações.
- Consultamos **a cada sync de antecipações** (hoje, algumas vezes por dia), sempre
  **incremental** por `updatedAt` (§4). Uma carga completa só na primeira vez e em
  reconciliação manual.
- Respeitamos o limite de taxa que vocês definirem; o cliente faz backoff em 429.

---

## 3. O que pedimos

Duas formas aceitáveis — escolham a que custa menos do lado de vocês:

- **(A) Endpoint novo**: `GET /api/v1/titles` (ou o nome da casa), um item por título
  cedido — uma antecipação parcelada em três boletos são **três** títulos.
- **(B) Campos novos em `/api/v1/anticipations`**, dentro de cada item, num bloco
  `settlement` (quando a antecipação é de um título só) ou `titles[]` (quando são vários).

### 3.1 Formato de um título

```json
{
  "id": "tt_01J9ZK…",
  "anticipationId": 186715,
  "documentNumber": "000123/1",
  "invoiceAccessKey": "35260912345678000190550010000001231000001234",
  "contractor": {
    "taxId": "12345678000290",
    "headquartersTaxId": "12345678000109",
    "name": "SPE OBRA ALFA LTDA"
  },
  "contracted": { "taxId": "98765432000110", "headquartersTaxId": "98765432000110", "name": "FORNECEDOR BETA LTDA" },
  "grossValue": 48500.00,
  "netValue": 46210.33,
  "originalDueDate": "2026-08-14",
  "currentDueDate": "2026-08-14",
  "overdue": { "isOverdue": true, "daysOverdue": 43 },
  "settlement": {
    "status": "OPEN",
    "paidAt": null,
    "paidAmount": null,
    "payments": []
  },
  "drawee": { "creditLimit": 1500000.00, "creditLimitUpdatedAt": "2026-09-01T10:12:00-03:00" },
  "updatedAt": "2026-09-26T08:03:11-03:00"
}
```

### 3.2 Tabela de campos, e por que cada um importa

| Campo | Tipo | Por que precisamos |
| --- | --- | --- |
| `id` | string | Chave estável do título. Hoje usamos o id da antecipação, que não distingue parcelas. |
| `anticipationId` | number | O elo com a antecipação que já sincronizamos. |
| `documentNumber` | string | Vai na notificação extrajudicial e na remessa de protesto; é o que o devedor reconhece. |
| `invoiceAccessKey` | string \| null | A chave da NF-e. É o item (c) do dossiê de sinistro (faturas) e o que liga o título ao XML. |
| `contractor.taxId` | string (14 dígitos) | Quem deve — pode ser uma SPE ou filial. |
| **`contractor.headquartersTaxId`** | string \| null | **A matriz do devedor.** A apólice trata o grupo como um Comprador só: a franquia é por Comprador (cl. 26100.00) e a notificação vai à matriz com todos os títulos do grupo. Hoje resolvemos a matriz por heurística (raiz do CNPJ, holding cadastrada); SPE de outra raiz escapa. |
| `contracted.taxId` / `headquartersTaxId` | string | O cedente e a matriz dele, pelo mesmo motivo — a notificação ao cedente segue a mesma regra matriz/filial. |
| `grossValue` | number | Valor de face — a base de toda cobrança. |
| **`netValue`** | number \| null | **O que foi efetivamente pago ao cedente.** A indenização é limitada a esse valor (cl. 22100.20 §3). Sem ele, o teto da indenização é uma estimativa. |
| **`originalDueDate`** | date | **O vencimento original, imutável.** Todo prazo da apólice conta dele (cl. 16900.20: prorrogação não desloca a data de referência). |
| `currentDueDate` | date | O vencimento vigente, se houve prorrogação. Só para a conversa comercial. |
| `overdue.isOverdue` / `daysOverdue` | boolean / number | O que a plataforma considera vencido, para conferirmos com a nossa conta. |
| **`settlement.status`** | enum | **`OPEN` · `PAID` · `PARTIALLY_PAID` · `BOUGHT_BACK` · `CANCELLED`**. `BOUGHT_BACK` é a recompra pelo cedente: encerra o título para o sacado sem que ele tenha pago, e a apólice trata isso de outro jeito. |
| **`settlement.paidAt`** | date \| null | **Quando o sacado pagou.** Decide se a cobertura volta com efeito retroativo (pago até 30 dias depois do D+60, cl. 17700.20 a) ou só para cessões posteriores ao pagamento. Um dia de diferença aqui muda se uma cessão está coberta. |
| **`settlement.paidAmount`** | number \| null | Quanto foi pago. Pagamento parcial **não** regulariza o sacado, e o saldo é o que continua em cobrança. |
| `settlement.payments[]` | `{ paidAt, amount, method }[]` | Os pagamentos parciais, um a um. Os créditos do devedor são deduzidos da perda segurada (cl. 22100.20 §3). |
| **`drawee.creditLimit`** | number \| null | **O limite de crédito vigente do sacado na data.** A indenização é `percentagem segurada × MIN(perda, limite vigente)`: o limite é teto. Hoje usamos o da última análise, que pode não ser o que vocês consideram vigente. |
| `drawee.creditLimitUpdatedAt` | datetime | Para sabermos de quando é o limite. |
| `updatedAt` | datetime | A base da sincronização incremental (§4). |

Datas **sem hora** em `YYYY-MM-DD`; instantes **com fuso** (`-03:00` ou `Z`). Hoje
`/anticipations` manda instantes sem fuso e nós carimbamos `-03:00` — funciona, mas é uma
suposição que preferimos não fazer.

---

## 4. Paginação e filtros

```
GET /api/v1/titles?updatedFrom=2026-09-25T00:00:00-03:00&page=1&pageSize=200
GET /api/v1/titles?contractorHeadquartersTaxId=12345678000109&status=OPEN
GET /api/v1/titles?anticipationId=186715
```

| Parâmetro | Uso |
| --- | --- |
| `updatedFrom` / `updatedTo` | Sincronização incremental. **Todo** evento que muda um campo da §3.2 precisa mexer em `updatedAt` — inclusive um pagamento registrado com data retroativa. |
| `status` | `OPEN`, `PAID`, … (lista, separada por vírgula). |
| `contractorHeadquartersTaxId` / `contractorTaxId` | "Todos os títulos em aberto deste grupo" — é a primeira tela da cobrança. |
| `dueDateFrom` / `dueDateTo` | Sobre `originalDueDate`. |
| `page` / `pageSize` | Até 200 por página; resposta com `total` e `totalPages`, como `/anticipations`. |

Ordenação estável (por `updatedAt`, depois `id`) — sem ela, uma página pode pular um
título que mudou durante a leitura.

---

## 5. O que o JobsiteOS faz enquanto isso não existe

Nada é inventado. Hoje:

- O título é uma **projeção de `/anticipations`**: cada antecipação em status de cessão
  (`APPROVED`, `PAY_OUT`, `BILLET_SWAPPED`, `CONCLUDED`, …) vira um título, com
  `originalDueDate` gravado uma vez e nunca sobrescrito.
- **`pago_em` vem do `completionDate` da antecipação `CONCLUDED`.** Medimos em 26/09/2026
  que ele cai no dia seguinte ao vencimento em quase todas as linhas — é, na prática, a
  liquidação. Mas não é um campo de liquidação declarado; a tela marca a origem como
  "conclusão na produção", e não "pagamento informado".
- **`BILLET_SWAPPED` com 15 dias ou mais de atraso é ambíguo**: pode ser inadimplência ou
  pagamento ainda não reportado. Não conseguimos distinguir, então os avisos saem
  **agregados por grupo** e dizem exatamente isso.
- `valor_pago`, pagamento parcial e recompra ficam **nulos**; o limite vigente vem da
  nossa última análise; a matriz vem de heurística. As telas mostram esses campos como
  ausentes ou estimados, com aviso — e a conta da perda segurada é mostrada aberta, linha a
  linha, com cada estimativa marcada.

Quando o endpoint existir, a projeção troca a fonte sem mudar o resto do módulo, e a origem
do pagamento passa a "informado pela produção".

---

## 6. Glossário

| Termo | Significado aqui |
| --- | --- |
| Sacado / `contractor` | A construtora que deve o título (pode ser SPE ou filial). |
| Cedente / `contracted` | O fornecedor que antecipou o recebível. |
| Matriz / grupo | O cabeça do grupo econômico do sacado e todas as SPEs/filiais dele. Para a apólice, um Comprador só. |
| Vencimento original | A data de vencimento na cessão. Nunca muda. |
| Liquidação | O pagamento do título pelo sacado — não o desembolso ao cedente. |
| Recompra | O cedente devolve o valor e o título sai da carteira sem pagamento do sacado. |

---

## 7. Checklist de homologação

- [ ] **1. Um item por título** — uma antecipação com três parcelas devolve três títulos,
      cada um com `id` próprio e o mesmo `anticipationId`.
- [ ] **2. Vencimento original imutável** — prorroguem um título em homologação: muda
      `currentDueDate`, **não** `originalDueDate`, e `updatedAt` avança.
- [ ] **3. Matriz** — um título de uma SPE traz `contractor.headquartersTaxId` com o CNPJ
      da matriz do grupo, mesmo quando a raiz do CNPJ é diferente.
- [ ] **4. Pagamento integral** — registrem um pagamento: `settlement.status = PAID`,
      `paidAt` com a data do pagamento (não a do registro), `paidAmount` igual ao pago.
- [ ] **5. Pagamento parcial** — `PARTIALLY_PAID`, `payments[]` com a parcela, e o título
      continua aparecendo em `status=OPEN,PARTIALLY_PAID`.
- [ ] **6. Recompra** — `BOUGHT_BACK`, sem `paidAt` do sacado.
- [ ] **7. Incremental** — `updatedFrom` = agora − 1 h devolve só o que mudou; um
      pagamento lançado com data retroativa também aparece.
- [ ] **8. Nulos honestos** — um título sem limite conhecido traz `drawee.creditLimit:
      null`, não `0`.
- [ ] **9. Fuso** — todo instante vem com `-03:00` ou `Z`.

---

## Suporte

Ao abrir um chamado sobre divergência, mandem o `id` do título, o `anticipationId` e o
`updatedAt` que vocês veem; do nosso lado, a linha correspondente em `titulos` guarda o
`status_producao` cru e o horário da última sincronização, e é por eles que achamos a
leitura exata.
