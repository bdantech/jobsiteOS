# JOBSITEOS — Claude Code Prompt 04n: API de Crédito para a Plataforma de Produção
## Endpoint de entrada (criar análise + documentos) e webhook de saída (mudanças de estágio)

> Builds on Prompts 01–04m, especialmente **04d** (esteira: `analises_credito`, `analise_docs`, estágios) e **04j** (análise proprietária, scorecard, decisão). Reuse: Supabase Storage (bucket privado de documentos), `empresas`, `cnpj_lookup_fila`, event log, `notify()`, worker. UI pt-BR, code English. Migrations via Supabase MCP.
>
> **Contexto**: a plataforma de produção da ONE OS (onde os clientes se cadastram e enviam documentação) precisa (a) **criar análises de crédito** na esteira do JobsiteOS e (b) **ser notificada** sempre que o estágio dessa análise mudar. Este prompt implementa os dois lados e produz a documentação de integração para o time de produção.

---

## 1. Autenticação e princípios

- **API key por integração** (não usuário), enviada em `Authorization: Bearer {key}`. Chaves geradas na UI, **armazenadas apenas como hash** (nunca reexibidas — mostra uma vez na criação), com escopo, status ativo/revogada e registro de último uso.
- **Idempotência obrigatória** na criação: header `Idempotency-Key`. Mesma chave → mesma análise, nunca duplica.
- **Rate limit** por API key (config, default 60 req/min) e payload máximo configurável.
- Toda requisição e todo webhook ficam registrados (§5) — integração sem trilha de auditoria é impossível de depurar.
- **Nunca confiar no payload para decisões**: os dados recebidos são insumo; o estágio e o limite continuam sendo governados pela esteira e pelo perfil Crédito.

```sql
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  nome text not null,                    -- 'plataforma-producao'
  key_hash text not null unique,
  prefixo text not null,                 -- primeiros 8 chars, para identificar na UI
  escopos text[] not null default '{credito:write,credito:read}',
  ativa boolean default true,
  ultimo_uso_em timestamptz,
  criada_por uuid references usuarios(id),
  criada_em timestamptz default now(),
  revogada_em timestamptz
);
```

## 2. Endpoint de entrada — criar/atualizar análise

### `POST /api/v1/credito/analises`

```jsonc
{
  "external_id": "prod-2026-00123",          // id da análise no sistema de produção (único)
  "cnpj": "12345678000190",                  // obrigatório, 14 dígitos (aceita com máscara)
  "razao_social": "CONSTRUTORA EXEMPLO LTDA",
  "papel": "sacado",                          // sacado (único suportado nesta versão)
  "limite_solicitado": 500000.00,
  "origem": "cadastro_plataforma",            // cadastro_plataforma | solicitacao_cliente | renovacao
  "contato": { "nome": "Maria Silva", "email": "maria@exemplo.com", "telefone": "11999990000" },
  "observacoes": "Cliente indicado pelo fornecedor X",
  "documentos": [                             // opcional na criação; pode vir depois (§2.2)
    { "tipo": "balanco_patrimonial", "nome_arquivo": "balanco_2025.pdf",
      "url": "https://...", "exercicio": 2025 }
  ]
}
```

**Processamento:**
1. Valida payload com zod (CNPJ com dígito verificador, tipos de documento contra a lista do 04j).
2. Resolve a empresa por CNPJ: existe → usa; não existe → cria (`tipo` default `construtora`, `estagio` conforme regra atual) e enfileira em `cnpj_lookup_fila` para enriquecimento cadastral gratuito.
3. Cria `analises_credito` com `estagio = 'solicitada'` (ou `docs_pendentes` se faltar documento essencial), `origem_externa = 'plataforma_producao'`, `external_id`.
4. **Dispara automaticamente o enriquecimento gratuito** já existente (cadastral, domínio, faturamento estimado 04c, scorecard 04d) para que a análise nasça com dossiê.
5. Retorna **201** com o recurso criado.

```jsonc
// 201
{ "analise_id": "uuid", "external_id": "prod-2026-00123", "cnpj": "12345678000190",
  "estagio": "docs_pendentes", "documentos_faltantes": ["dre"],
  "criada_em": "2026-09-02T13:45:00Z" }
```

Reenvio com a mesma `Idempotency-Key` (ou mesmo `external_id`) retorna **200** com o recurso existente, sem duplicar.

### 2.1 Migrações

```sql
alter table analises_credito add column external_id text unique;
alter table analises_credito add column origem_externa text;
alter table analises_credito add column contato_externo jsonb;
alter table analise_docs add column origem text default 'jobsiteos';  -- jobsiteos | plataforma_producao
alter table analise_docs add column exercicio int;
alter table analise_docs add column external_id text;
```

### 2.2 Documentos — dois caminhos

- **`POST /api/v1/credito/analises/{id}/documentos`** (multipart) — upload direto de arquivo. Valida tipo MIME (pdf, jpg, png, xlsx), tamanho máximo configurável, grava no bucket privado, cria `analise_docs`.
- **Mesmo endpoint com JSON contendo `url`** — o JobsiteOS **baixa** o arquivo (worker, com timeout e validação de tipo/tamanho) e o armazena no próprio bucket. Nunca depender de URL externa a longo prazo: o documento tem que viver conosco.

Ao completar o checklist de documentos essenciais, a análise sai de `docs_pendentes` automaticamente → **dispara webhook** (§3).

### 2.3 Consulta

- **`GET /api/v1/credito/analises/{id}`** e **`GET /api/v1/credito/analises?external_id=`** — retornam o mesmo payload do webhook (§3.2), para reconciliação e polling de emergência.

## 3. Webhook de saída — mudanças de estágio

### 3.1 Configuração (Settings → Crédito → Integrações; `webOnly`)
```sql
create table webhooks_saida (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  url text not null,
  secret text not null,                  -- para assinatura HMAC
  eventos text[] not null,               -- quais eventos enviar
  ativo boolean default true,
  criado_por uuid references usuarios(id),
  criado_em timestamptz default now()
);
```
UI: cadastrar URL, gerar/rotacionar secret, escolher eventos, **botão "Enviar evento de teste"**, e log das últimas entregas com status e resposta.

### 3.2 Payload (completo — o consumidor não deve precisar de segunda chamada)

Evento: `credito.estagio_alterado` (e demais de §3.3).

```jsonc
{
  "evento": "credito.estagio_alterado",
  "evento_id": "uuid",                       // idempotência do lado deles
  "ocorrido_em": "2026-09-02T14:10:00Z",
  "analise": {
    "analise_id": "uuid", "external_id": "prod-2026-00123",
    "estagio_anterior": "em_analise", "estagio_atual": "aprovada",
    "limite_solicitado": 500000.00,
    "limite_aprovado": 350000.00,
    "validade": "2027-03-01",
    "motivo": null,                          // preenchido em negada/parcial quando houver
    "decisao_final": "operar_com_cobertura", // do 04j, quando registrada
    "atualizada_em": "2026-09-02T14:10:00Z"
  },
  "empresa": {
    "cnpj": "12345678000190", "razao_social": "CONSTRUTORA EXEMPLO LTDA",
    "tipo": "construtora", "uf": "SP", "municipio": "São Paulo",
    "situacao_cadastral": "ativa", "porte": "DEMAIS",
    "faturamento_estimado": 28000000.00, "faturamento_origem": "modelo"
  },
  "credito": {
    "score": 72.5, "faixa": "alta", "completude": 0.86,
    "chance_concessao": 0.8,
    "limite_potencial": 380000.00,
    "tem_protesto": false,
    "analise_proprietaria": {                // do 04j, quando existir
      "recomendacao": "operar", "limite_recomendado": 350000.00,
      "cenarios": { "conservador": 250000.00, "base": 350000.00, "agressivo": 420000.00 }
    },
    "seguradora": { "nome": "atradius", "status": "approved",
                    "limite": 400000.00, "expira_em": "2027-03-01" }
  },
  "documentos": { "recebidos": ["balanco_patrimonial","dre"], "faltantes": [] }
}
```

Campos ausentes vão como `null` — **nunca omitir a chave** (contrato estável).

### 3.3 Eventos enviados
`credito.analise_criada` · `credito.estagio_alterado` (o principal — dispara em **toda** transição da esteira: solicitada, docs_pendentes, enviada_seguradora, em_analise, aprovada, aprovada_parcial, negada, expirada, cancelada) · `credito.documento_recebido` · `credito.limite_alterado` (inclui redução pela seguradora — sinal de risco) · `credito.decisao_registrada` (decisão final do 04j).

### 3.4 Entrega confiável
- **Assinatura HMAC-SHA256** do corpo com o `secret`, no header `X-JobsiteOS-Signature`, mais `X-JobsiteOS-Event-Id` e `X-JobsiteOS-Timestamp` (proteção contra replay — recomendar rejeição acima de 5 min).
- **Retry com backoff exponencial**: 6 tentativas (1min, 5min, 15min, 1h, 6h, 24h). Considera sucesso `2xx`.
- **Fila persistente** com log de cada tentativa; após esgotar, evento `webhook.falhou` → notificação aos admins e possibilidade de **reenvio manual** pela UI.
- Timeout de 10s por tentativa; entrega assíncrona (nunca bloquear a transação que mudou o estágio).

```sql
create table webhook_entregas (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid references webhooks_saida(id),
  evento text not null, evento_id uuid not null,
  payload jsonb not null,
  tentativas int default 0,
  status text default 'pendente',        -- pendente | entregue | falhou
  ultimo_status_http int, ultima_resposta text, ultimo_erro text,
  proxima_tentativa_em timestamptz,
  criado_em timestamptz default now(), entregue_em timestamptz
);
create index on webhook_entregas (status, proxima_tentativa_em);
```

## 4. UI

Settings → Crédito → **Integrações** (`webOnly`): gestão de API keys (criar, revogar, ver prefixo e último uso), configuração do webhook (URL, secret, eventos, teste), e **log de entregas** com filtro por status, payload expandível e botão de reenvio.
Na esteira, badge "origem: plataforma de produção" nas análises criadas pela API, com o `external_id` visível.

## 5. Observabilidade

`api_requests_log` (api_key, rota, status, duração, idempotency key, erro) com retenção configurável. Painel simples: volume por dia, taxa de erro, latência média, últimas falhas — é o que permite responder "a integração está de pé?" sem abrir o banco.

## 6. Documentação para o time de produção (entregável obrigatório)

Gerar **`/docs/integracao-credito-plataforma-producao.md`** — documento autocontido, em **português**, escrito para um desenvolvedor que não conhece o JobsiteOS. Deve conter:

1. Visão geral do fluxo (diagrama em texto: produção → cria análise → JobsiteOS processa → webhooks de volta).
2. Como obter e usar a API key; ambientes e URLs base.
3. **Referência completa de cada endpoint**: método, URL, headers, schema do corpo, todos os códigos de resposta (200, 201, 400, 401, 409, 422, 429, 500) com exemplos de erro reais.
4. Uso da `Idempotency-Key` — com exemplo do que acontece no reenvio.
5. Envio de documentos pelos dois caminhos (multipart e URL), tipos aceitos e limites.
6. **Recepção de webhook**: exemplo de endpoint receptor, **como validar a assinatura HMAC** (com snippet em Node e em Python), política de retry, idempotência por `evento_id`, e a recomendação de responder `2xx` rapidamente e processar de forma assíncrona.
7. Payload completo de cada evento, com **tabela de campos** (nome, tipo, sempre presente?, descrição).
8. Glossário dos estágios da esteira e o que cada um significa para o negócio.
9. Exemplos prontos em `curl` para todas as chamadas.
10. Checklist de homologação (criar análise de teste, enviar documento, receber webhook de teste, validar assinatura, simular retry).

## 7. Entregáveis

**API**: rotas versionadas em `/api/v1/credito/*` com auth por API key, zod em tudo, idempotência, rate limit.
**Worker**: `webhooks/entregar` (fila com backoff), `credito/baixar-documento-externo`.
**Core**: assinatura HMAC, validador de CNPJ (reuso), mapeamento estágio→payload em um único lugar (o mesmo builder serve webhook e `GET`, para nunca divergirem) — com testes.
**Segurança**: keys em hash; documentos em bucket privado com RLS; secret do webhook não reexibido; logs sem conteúdo sensível.
**Testes**: idempotência, assinatura, retry, payload completo com campos nulos, criação de empresa inexistente.
**Docs**: o arquivo do §6 mais a seção no README interno.

## 8. Fora de escopo

Criação de análises de cedente (só sacado nesta versão) · webhooks de outros módulos (o mecanismo fica genérico, mas só o crédito publica agora) · autenticação OAuth · portal do cliente.
