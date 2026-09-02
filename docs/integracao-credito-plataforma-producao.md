# Integração de Crédito — Plataforma de Produção ⇄ JobsiteOS

Documento para quem vai escrever o código do lado da plataforma de produção. Não
pressupõe nenhum conhecimento do JobsiteOS.

---

## 1. Visão geral do fluxo

A plataforma de produção **cria** a análise de crédito no JobsiteOS e **recebe de
volta**, por webhook, cada mudança de estágio dela.

```
  PLATAFORMA DE PRODUÇÃO                        JOBSITEOS
  ──────────────────────                        ─────────
  cliente se cadastra
        │
        │  POST /api/v1/credito/analises
        ├─────────────────────────────────────▶ cria/acha a empresa pelo CNPJ
        │                                       cria a análise (solicitada
        │  201 { analise_id, estagio,           ou docs_pendentes)
        │◀────── documentos_faltantes }         dispara enriquecimento grátis
        │
        │  POST /analises/{id}/documentos
        ├─────────────────────────────────────▶ guarda no bucket privado
        │  201/202                              e refaz o checklist
        │◀─────────────────────────────────────
        │                                              │
        │                                              │ checklist completo?
        │                                              ▼
        │                                       docs_pendentes → solicitada
        │                                              │
        │                                       time de Crédito trabalha:
        │                                       envia à seguradora, analisa,
        │                                       aprova/nega
        │                                              │
        │  POST no seu endpoint                        ▼
        │◀──────────────────────────────────────  credito.estagio_alterado
        │   (assinado em HMAC-SHA256)            a CADA transição
        │
        │  2xx rápido
        ├─────────────────────────────────────▶
```

Duas regras que valem para tudo o que vem abaixo:

1. **O que vocês mandam é insumo, nunca decisão.** Estágio, limite aprovado e
   validade são governados pela esteira do JobsiteOS e pelo time de Crédito.
   Nenhum campo do payload de entrada muda isso.
2. **Toda mudança de estágio gera webhook**, inclusive as que vocês não
   provocaram (a seguradora respondeu, o limite caiu, a análise expirou).

---

## 2. Autenticação, ambientes e URLs

### Obter a chave

Um administrador do JobsiteOS cria a chave em **Crédito → Integrações → Criar
chave**. Ela é exibida **uma única vez**, na criação.

Não existe caminho para recuperá-la depois: o JobsiteOS guarda apenas o
SHA-256 dela. Se a chave for perdida, o procedimento é criar outra e revogar a
antiga — as duas convivem durante a troca.

### Usar

```
Authorization: Bearer jos_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

A chave tem **escopos**. Os dois usados aqui:

| Escopo          | Permite                                      |
| --------------- | -------------------------------------------- |
| `credito:write` | criar análise, enviar documento              |
| `credito:read`  | consultar análise                            |

### URLs base

| Ambiente   | Base                                  |
| ---------- | ------------------------------------- |
| Produção   | `https://<dominio-do-jobsiteos>`      |
| Homologação| combinar com o time do JobsiteOS      |

Todos os caminhos abaixo são relativos a essa base.

### Limites

| Limite                     | Padrão   | Onde muda                     |
| -------------------------- | -------- | ----------------------------- |
| Requisições por minuto     | 60       | Crédito → Configurações → `api` |
| Corpo JSON                 | 512 KB   | idem                          |
| Arquivo por documento      | 20 MB    | idem                          |

Estourar o de requisições devolve **429**. Não há header de `Retry-After`:
espere o resto do minuto corrente.

---

## 3. Referência dos endpoints

### 3.1 `POST /api/v1/credito/analises`

Cria a análise. **Requer `Idempotency-Key`.**

**Headers**

| Header            | Obrigatório | Observação                                      |
| ----------------- | ----------- | ----------------------------------------------- |
| `Authorization`   | sim         | `Bearer {chave}`                                |
| `Content-Type`    | sim         | `application/json`                              |
| `Idempotency-Key` | **sim**     | qualquer string única por pedido (use um UUID)  |

**Corpo**

| Campo               | Tipo    | Obrigatório | Descrição                                                       |
| ------------------- | ------- | ----------- | --------------------------------------------------------------- |
| `external_id`       | string  | **sim**     | O id da análise no sistema de vocês. Único; é a segunda porta de idempotência. |
| `cnpj`              | string  | **sim**     | 14 dígitos. Aceita máscara. Dígito verificador é conferido.      |
| `razao_social`      | string  | não         | Usada só se a empresa ainda não existir aqui.                    |
| `papel`             | string  | não         | Só `"sacado"` nesta versão. Default `"sacado"`.                  |
| `limite_solicitado` | número  | não         | Em reais. É o pedido, não o aprovado.                            |
| `origem`            | string  | não         | `cadastro_plataforma` (default), `solicitacao_cliente`, `renovacao`. |
| `contato`           | objeto  | não         | `{ nome, email, telefone }`.                                     |
| `observacoes`       | string  | não         | Texto livre, até 4000 caracteres.                                |
| `documentos`        | array   | não         | Até 50. Ver §4.                                                  |

**Exemplo**

```bash
curl -X POST "$BASE/api/v1/credito/analises" \
  -H "Authorization: Bearer $CHAVE" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 6f1e2a7c-1b2c-4d5e-8f90-1a2b3c4d5e6f" \
  -d '{
    "external_id": "prod-2026-00123",
    "cnpj": "11.222.333/0001-81",
    "razao_social": "CONSTRUTORA EXEMPLO LTDA",
    "limite_solicitado": 500000.00,
    "origem": "cadastro_plataforma",
    "contato": { "nome": "Maria Silva", "email": "maria@exemplo.com", "telefone": "11999990000" },
    "documentos": [
      { "tipo": "balanco_patrimonial", "nome_arquivo": "balanco_2025.pdf",
        "url": "https://arquivos.exemplo.com/b.pdf", "exercicio": 2025 }
    ]
  }'
```

**201 — criada**

```json
{
  "analise_id": "3f7c1e90-5a2b-4c8d-9e01-2b3c4d5e6f70",
  "external_id": "prod-2026-00123",
  "cnpj": "11222333000181",
  "estagio": "docs_pendentes",
  "documentos_faltantes": ["dre", "faturamento_declarado"],
  "criada_em": "2026-09-02T13:45:00.000Z"
}
```

**200 — já existia** (mesma `Idempotency-Key`, ou mesmo `external_id`): corpo
idêntico ao da criação original.

**Códigos de resposta**

| Código | Quando                                     | Exemplo de corpo |
| ------ | ------------------------------------------ | ---------------- |
| 201    | criada                                     | acima |
| 200    | reenvio idempotente                        | acima |
| 400    | sem `Idempotency-Key`, ou JSON inválido    | `{"erro":{"codigo":"sem_idempotency_key","mensagem":"O header Idempotency-Key é obrigatório nesta rota.","detalhes":null}}` |
| 401    | sem chave, chave inválida ou revogada      | `{"erro":{"codigo":"credencial_invalida","mensagem":"Chave inválida ou revogada.","detalhes":null}}` |
| 403    | chave sem o escopo `credito:write`         | `{"erro":{"codigo":"escopo_insuficiente","mensagem":"Esta chave não tem o escopo \"credito:write\".","detalhes":null}}` |
| 413    | corpo acima do limite                      | `{"erro":{"codigo":"payload_grande","mensagem":"Corpo acima de 512 KB.","detalhes":null}}` |
| 422    | payload não passou na validação            | `{"erro":{"codigo":"payload_invalido","mensagem":"O corpo não passou na validação.","detalhes":[{"campo":"cnpj","erro":"CNPJ inválido (dígito verificador não confere)."}]}}` |
| 429    | rate limit                                 | `{"erro":{"codigo":"rate_limit","mensagem":"Limite de 60 requisições por minuto atingido.","detalhes":null}}` |
| 500    | falha nossa                                | `{"erro":{"codigo":"falha_analise","mensagem":"Não foi possível criar a análise.","detalhes":null}}` |

Todo erro tem a **mesma forma**: `{ "erro": { "codigo", "mensagem", "detalhes" } }`.
`codigo` é estável e serve para `switch`; `mensagem` é para humano; `detalhes` é
`null` ou uma lista de problemas por campo.

### 3.2 `GET /api/v1/credito/analises/{id}`

Escopo `credito:read`. Devolve **exatamente o mesmo payload do webhook** (§5).

```bash
curl "$BASE/api/v1/credito/analises/3f7c1e90-5a2b-4c8d-9e01-2b3c4d5e6f70" \
  -H "Authorization: Bearer $CHAVE"
```

| Código | Quando |
| ------ | ------ |
| 200 | achou |
| 400 | id não é UUID |
| 404 | não existe |

### 3.3 `GET /api/v1/credito/analises?external_id=`

Mesmo payload, procurando pelo **id de vocês**. É o caminho de reconciliação
quando se perdeu o `analise_id`.

```bash
curl "$BASE/api/v1/credito/analises?external_id=prod-2026-00123" \
  -H "Authorization: Bearer $CHAVE"
```

---

## 4. Idempotência

### `Idempotency-Key`

Obrigatória na criação. Guarde-a junto do pedido do seu lado e **reenvie a mesma
chave** em qualquer retentativa daquele pedido.

O que acontece no reenvio:

| Situação | Resposta |
| -------- | -------- |
| Primeira chamada | 201, análise criada |
| Reenvio com a **mesma** `Idempotency-Key` | 200, **corpo idêntico** ao da primeira |
| Reenvio com **outra** chave, mesmo `external_id` | 200, com a análise que já existe |

Isto resolve o caso mais comum de integração: sua chamada teve timeout e você não
sabe se ela chegou. Reenvie — não vai duplicar.

**Não reutilize a mesma `Idempotency-Key` para pedidos diferentes.** Você
receberia a resposta do primeiro.

### `evento_id` (do lado de vocês)

Cada webhook traz um `evento_id`. Guardem-no e ignorem repetidos: nós reentregamos
quando não recebemos `2xx`, e um evento pode chegar duas vezes.

---

## 5. Documentos

Dois caminhos, mesmo endpoint: `POST /api/v1/credito/analises/{id}/documentos`.

### 5.1 Upload direto (multipart)

```bash
curl -X POST "$BASE/api/v1/credito/analises/$ANALISE/documentos" \
  -H "Authorization: Bearer $CHAVE" \
  -F "tipo=balanco_patrimonial" \
  -F "exercicio=2025" \
  -F "arquivo=@./balanco_2025.pdf"
```

**201**

```json
{ "documento_id": "…", "analise_id": "…", "documentos_faltantes": ["dre"] }
```

### 5.2 Por URL (JSON)

```bash
curl -X POST "$BASE/api/v1/credito/analises/$ANALISE/documentos" \
  -H "Authorization: Bearer $CHAVE" \
  -H "Content-Type: application/json" \
  -d '{ "tipo": "dre", "nome_arquivo": "dre_2025.pdf",
        "url": "https://arquivos.exemplo.com/dre_2025.pdf", "exercicio": 2025 }'
```

**202** — aceito; o JobsiteOS baixa o arquivo em segundo plano e o guarda no
próprio bucket.

```json
{ "documento_id": "…", "analise_id": "…", "status": "baixando", "documentos_faltantes": [] }
```

A URL precisa estar acessível sem autenticação no momento do download. Nós não
dependemos dela a longo prazo — o arquivo passa a viver conosco, porque ele é a
base de uma decisão de crédito e precisa existir numa auditoria futura.

### Tipos aceitos

**MIME**: `application/pdf`, `image/jpeg`, `image/png`,
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (xlsx),
`application/vnd.ms-excel` (xls). Tamanho máximo 20 MB.

**`tipo` do documento** (a lista completa):
`balanco_patrimonial`, `dre`, `balancete`, `dfc`, `dmpl`, `notas_explicativas`,
`faturamento_declarado`, `relacao_faturamento_mensal`, `contrato_social`,
`certidoes`, `imposto_renda_pj`, `sped_ecd`, `parecer_auditoria`, `outros`.

Os **essenciais** — os que tiram a análise de `docs_pendentes` — são configuráveis
pelo time de Crédito. Hoje: `balanco_patrimonial`, `dre`, `faturamento_declarado`.
Não fixem essa lista no código de vocês: leiam `documentos_faltantes` da resposta.

Quando o último essencial chega, a análise passa sozinha de `docs_pendentes` para
`solicitada` — e vocês recebem `credito.estagio_alterado`.

### Códigos

| Código | Quando |
| ------ | ------ |
| 201 | arquivo recebido e guardado (multipart) |
| 202 | URL aceita, download em andamento (JSON) |
| 404 | análise não existe |
| 413 | arquivo acima de 20 MB |
| 422 | tipo MIME não aceito, ou corpo inválido |

---

## 6. Recepção do webhook

### 6.1 Headers

| Header                   | Conteúdo |
| ------------------------ | -------- |
| `X-JobsiteOS-Signature`  | HMAC-SHA256 do corpo, em hex |
| `X-JobsiteOS-Event-Id`   | o `evento_id`, para deduplicação |
| `X-JobsiteOS-Timestamp`  | epoch em segundos, para proteção contra replay |
| `Content-Type`           | `application/json` |

### 6.2 Como validar a assinatura

Assine **os bytes crus do corpo**, não o objeto reserializado — `JSON.stringify`
do seu lado pode produzir uma string diferente da nossa, e a assinatura não vai
bater.

**Node (Express)**

```js
import crypto from 'node:crypto'
import express from 'express'

const app = express()
const SECRET = process.env.JOBSITEOS_WEBHOOK_SECRET

// `express.raw` preserva os bytes originais. `express.json` já os teria perdido.
app.post('/webhooks/jobsiteos', express.raw({ type: 'application/json' }), (req, res) => {
  const assinatura = req.get('X-JobsiteOS-Signature') ?? ''
  const timestamp = Number(req.get('X-JobsiteOS-Timestamp') ?? 0)

  // Replay: recuse o que é velho demais.
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return res.sendStatus(401)

  const esperada = crypto.createHmac('sha256', SECRET).update(req.body).digest('hex')
  const a = Buffer.from(esperada)
  const b = Buffer.from(assinatura)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401)

  const evento = JSON.parse(req.body.toString('utf8'))

  // Responda 2xx AGORA e processe depois (§6.4).
  res.sendStatus(200)
  processarAssincrono(evento).catch(console.error)
})
```

**Python (Flask)**

```python
import hmac, hashlib, time
from flask import Flask, request, abort

app = Flask(__name__)
SECRET = os.environ["JOBSITEOS_WEBHOOK_SECRET"].encode()

@app.post("/webhooks/jobsiteos")
def receber():
    assinatura = request.headers.get("X-JobsiteOS-Signature", "")
    timestamp = int(request.headers.get("X-JobsiteOS-Timestamp", "0"))

    if abs(time.time() - timestamp) > 300:
        abort(401)

    corpo = request.get_data()  # bytes crus
    esperada = hmac.new(SECRET, corpo, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(esperada, assinatura):
        abort(401)

    evento = request.get_json()
    enfileirar(evento)          # processa fora da requisição
    return "", 200
```

### 6.3 Retry

Consideramos entregue qualquer resposta **2xx**. Qualquer outra coisa (incluindo
timeout de 10s) agenda nova tentativa:

| Tentativa | Espera desde a anterior |
| --------- | ----------------------- |
| 1ª        | imediata                |
| 2ª        | 1 min                   |
| 3ª        | 5 min                   |
| 4ª        | 15 min                  |
| 5ª        | 1 h                     |
| 6ª        | 6 h                     |
| última    | 24 h                    |

Esgotadas as seis, a entrega é marcada como falhada e os administradores do
JobsiteOS são notificados. Ela pode ser **reenviada manualmente** pela tela de
Integrações — com o mesmo `evento_id`.

### 6.4 Recomendações

- **Responda 2xx rápido** e processe de forma assíncrona. Se vocês processarem
  dentro da requisição e demorarem mais de 10s, nós vamos reentregar um evento
  que vocês já trataram.
- **Deduplique por `evento_id`.** É a garantia de que reentrega não vira efeito
  duplicado do lado de vocês.
- **Não confiem na ordem.** Retentativas podem fazer um evento antigo chegar
  depois de um novo. Use `ocorrido_em` e o estágio do payload para decidir.
- **Não deduzam estágio a partir de outros campos**: use `analise.estagio_atual`.

---

## 7. Payload dos eventos

Todos os eventos de crédito têm **a mesma forma**. O que muda é o campo `evento` e
o que motivou o envio. **Nenhuma chave é omitida** — o que não existe vem `null`.

```json
{
  "evento": "credito.estagio_alterado",
  "evento_id": "b3f1c2d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  "ocorrido_em": "2026-09-02T14:10:00.000Z",
  "analise": {
    "analise_id": "3f7c1e90-5a2b-4c8d-9e01-2b3c4d5e6f70",
    "external_id": "prod-2026-00123",
    "estagio_anterior": "em_analise",
    "estagio_atual": "aprovada",
    "limite_solicitado": 500000.00,
    "limite_aprovado": 350000.00,
    "validade": "2027-03-01",
    "motivo": null,
    "decisao_final": "operar_com_cobertura",
    "atualizada_em": "2026-09-02T14:10:00.000Z"
  },
  "empresa": {
    "cnpj": "11222333000181",
    "razao_social": "CONSTRUTORA EXEMPLO LTDA",
    "tipo": "construtora",
    "uf": "SP",
    "municipio": "São Paulo",
    "situacao_cadastral": "ativa",
    "porte": "DEMAIS",
    "faturamento_estimado": 28000000.00,
    "faturamento_origem": "modelo"
  },
  "credito": {
    "score": 72.5,
    "faixa": "alta",
    "completude": 0.86,
    "chance_concessao": 0.8,
    "limite_potencial": 380000.00,
    "tem_protesto": false,
    "analise_proprietaria": {
      "recomendacao": "operar",
      "limite_recomendado": 350000.00,
      "cenarios": { "conservador": 250000.00, "base": 350000.00, "agressivo": 420000.00 }
    },
    "seguradora": {
      "nome": "atradius",
      "status": "approved",
      "limite": 400000.00,
      "expira_em": "2027-03-01"
    }
  },
  "documentos": { "recebidos": ["balanco_patrimonial", "dre"], "faltantes": [] }
}
```

### Tabela de campos

| Campo | Tipo | Sempre presente? | Descrição |
| ----- | ---- | ---------------- | --------- |
| `evento` | string | sim | Qual dos eventos do §7.1 |
| `evento_id` | uuid | sim | Único por evento. Use para deduplicar |
| `ocorrido_em` | ISO-8601 | sim | Quando o fato aconteceu do nosso lado |
| `analise.analise_id` | uuid | sim | Nosso id |
| `analise.external_id` | string \| null | sim (pode ser null) | O id de vocês |
| `analise.estagio_anterior` | string \| null | sim (null na criação) | Estágio de onde saiu |
| `analise.estagio_atual` | string | sim | Ver glossário (§8) |
| `analise.limite_solicitado` | número \| null | sim | O que foi pedido |
| `analise.limite_aprovado` | número \| null | sim | O que a seguradora concedeu |
| `analise.validade` | date \| null | sim | Até quando o limite vale |
| `analise.motivo` | string \| null | sim | Preenchido em negada/parcial |
| `analise.decisao_final` | string \| null | sim | Nossa decisão operacional, quando registrada |
| `analise.atualizada_em` | ISO-8601 \| null | sim | Última escrita na análise |
| `empresa.cnpj` | string | sim | 14 dígitos |
| `empresa.razao_social` | string \| null | sim | |
| `empresa.tipo` | string \| null | sim | `construtora`, `fornecedor` |
| `empresa.uf` / `municipio` | string \| null | sim | |
| `empresa.situacao_cadastral` | string \| null | sim | Da Receita |
| `empresa.porte` | string \| null | sim | |
| `empresa.faturamento_estimado` | número \| null | sim | Pode ser estimado por modelo |
| `empresa.faturamento_origem` | string \| null | sim | `declarado`, `modelo`, `publicado` |
| `credito.score` | número \| null | sim | 0–100 |
| `credito.faixa` | string \| null | sim | `alta`, `media`, `baixa` |
| `credito.completude` | número \| null | sim | 0–1: quanto do dossiê existe |
| `credito.chance_concessao` | número \| null | sim | 0–1 |
| `credito.limite_potencial` | número \| null | sim | Nossa estimativa antes da seguradora |
| `credito.tem_protesto` | booleano \| null | sim | |
| `credito.analise_proprietaria` | objeto \| null | sim | `null` enquanto não roda |
| `credito.seguradora` | objeto \| null | sim | |
| `documentos.recebidos` | string[] | sim | Tipos já entregues |
| `documentos.faltantes` | string[] | sim | Essenciais que faltam |

### 7.1 Eventos

| Evento | Quando dispara |
| ------ | -------------- |
| `credito.analise_criada` | A análise nasceu (por API ou por dentro do JobsiteOS) |
| `credito.estagio_alterado` | **Toda** transição de estágio. É o principal |
| `credito.documento_recebido` | Um documento foi registrado na análise |
| `credito.limite_alterado` | `limite_aprovado` mudou — inclusive **redução** pela seguradora, que é sinal de risco e costuma acontecer sem mudar o estágio |
| `credito.decisao_registrada` | A decisão operacional foi registrada |
| `webhook.teste` | Disparado pelo botão de teste. Payload reduzido, sem análise |

---

## 8. Glossário dos estágios

| Estágio | O que significa para o negócio |
| ------- | ------------------------------ |
| `rascunho` | Aberta internamente, ainda não é um pedido. **Não chega por API.** |
| `solicitada` | Pedido registrado, dossiê completo o bastante para começar |
| `docs_pendentes` | Falta documento essencial. Veja `documentos.faltantes` |
| `enviada_seguradora` | Submetida à seguradora; aguardando o parecer dela |
| `em_analise` | A seguradora está analisando |
| `aprovada` | Limite concedido. Ver `limite_aprovado` e `validade` |
| `aprovada_parcial` | Concedido **menos** que o solicitado. `motivo` costuma explicar |
| `negada` | Recusada. `motivo` traz o que a seguradora disse. Não avança daqui |
| `expirada` | O limite venceu. Precisa de nova análise |
| `cancelada` | Encerrada administrativamente |

A ordem normal é `solicitada → enviada_seguradora → em_analise → aprovada`, com
`docs_pendentes` antes de `solicitada` quando falta documento. **Não presuma essa
ordem**: uma análise pode ir direto de `em_analise` para `negada`, ou de
`aprovada` para `expirada` meses depois.

---

## 9. Exemplos prontos

```bash
export BASE="https://SEU-JOBSITEOS"
export CHAVE="jos_..."
export ANALISE="3f7c1e90-5a2b-4c8d-9e01-2b3c4d5e6f70"

# 1) Criar análise
curl -X POST "$BASE/api/v1/credito/analises" \
  -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"external_id":"prod-2026-00123","cnpj":"11222333000181","limite_solicitado":500000}'

# 2) Enviar documento (arquivo)
curl -X POST "$BASE/api/v1/credito/analises/$ANALISE/documentos" \
  -H "Authorization: Bearer $CHAVE" \
  -F "tipo=dre" -F "exercicio=2025" -F "arquivo=@./dre_2025.pdf"

# 3) Enviar documento (URL)
curl -X POST "$BASE/api/v1/credito/analises/$ANALISE/documentos" \
  -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -d '{"tipo":"balanco_patrimonial","nome_arquivo":"b.pdf","url":"https://exemplo.com/b.pdf"}'

# 4) Consultar por id
curl "$BASE/api/v1/credito/analises/$ANALISE" -H "Authorization: Bearer $CHAVE"

# 5) Consultar pelo id de vocês
curl "$BASE/api/v1/credito/analises?external_id=prod-2026-00123" \
  -H "Authorization: Bearer $CHAVE"

# 6) Conferir a idempotência: repita o passo 1 com a MESMA Idempotency-Key.
#    Deve voltar 200 com o mesmo corpo, e não criar uma segunda análise.
```

---

## 10. Checklist de homologação

Percorram na ordem. Cada item tem um critério objetivo.

- [ ] **1. Chave** — `GET /api/v1/credito/analises?external_id=qualquer` devolve
      401 sem `Authorization`, e 404 (não 401) com a chave certa.
- [ ] **2. Criar análise** — `POST` devolve **201** com `analise_id`. A análise
      aparece na esteira do JobsiteOS com o selo "plataforma de produção" e o
      `external_id` visível.
- [ ] **3. Idempotência** — repita a chamada do item 2 com a **mesma**
      `Idempotency-Key`: deve vir **200**, corpo idêntico, e **nenhuma** segunda
      análise na esteira.
- [ ] **4. Idempotência por `external_id`** — repita com `Idempotency-Key`
      diferente e mesmo `external_id`: deve vir **200** com a análise existente.
- [ ] **5. Validação** — mande um CNPJ com dígito verificador errado: **422**, com
      `detalhes[0].campo === "cnpj"`.
- [ ] **6. Documento por upload** — multipart com PDF: **201**, e
      `documentos_faltantes` encolhe.
- [ ] **7. Documento por URL** — JSON com `url`: **202**. Confirme com o time do
      JobsiteOS que o arquivo chegou ao bucket (a linha some do estado "baixando").
- [ ] **8. Checklist completo** — depois de mandar todos os essenciais, a análise
      sai de `docs_pendentes` sozinha e vocês recebem `credito.estagio_alterado`.
- [ ] **9. Webhook de teste** — peça ao time do JobsiteOS para clicar em "Enviar
      evento de teste". Seu endpoint deve receber `webhook.teste` e responder 2xx.
- [ ] **10. Assinatura** — com o secret **errado**, seu endpoint deve recusar
      (401). Com o certo, aceitar. Testem os dois.
- [ ] **11. Retry** — devolva 500 de propósito num evento. Confirme que ele
      reaparece ~1 min depois com o **mesmo** `evento_id`, e que seu código o
      deduplica quando finalmente responder 200.
- [ ] **12. Reconciliação** — `GET /analises/{id}` devolve o mesmo payload do
      último webhook recebido.

---

## Suporte

Erros da API ficam registrados do nosso lado com a rota, o código e a
`Idempotency-Key`. Ao abrir um chamado, mandem **`external_id` ou `analise_id`, o
horário aproximado e o `evento_id`** quando for sobre webhook — com isso achamos a
requisição exata.
