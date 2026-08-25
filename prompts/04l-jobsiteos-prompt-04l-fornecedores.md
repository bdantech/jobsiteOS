# JOBSITEOS — Claude Code Prompt 04l: Funil de Cadastro de Fornecedores
## Funil por originador, cascata de descoberta de contato e pedido de apresentação ao sacado

> Builds on Prompts 01–04k. Reuse pesado: `notas_fiscais` + `raw_xml` (04), Radar (cascata de domínio, Apollo, lotes/orçamento — 03), `contatos` + ponto focal (04), supressão soft/eterna (04), `vendedor_carteira` e settings de originador (04g/04k), Anthropic API com web search, event log. UI pt-BR, code English. Migrations via Supabase MCP.
> **Localização**: menu **Comercial → Cadastro de Fornecedores**.

---

## 1. Conceito

Fornecedores que emitem NF contra nossos sacados e **não estão cadastrados na plataforma** são demanda latente de antecipação. Hoje são uma lista morta; aqui viram funil com dono, munição de abordagem e motor de descoberta de contato.

**Atribuição**: o originador vê os fornecedores que faturaram contra os **sacados vinculados a ele** (carteira de originação das settings "Vendedores e territórios"). Gestores veem tudo; fornecedor cujo sacado não tem originador titular vai para a fila sem dono.

## 2. Modelo

```sql
create table fornecedores_funil (
  id uuid primary key default gen_random_uuid(),
  fornecedor_cnpj text unique not null,
  originador_id uuid references vendedores(id),      -- derivado do sacado; reatribuível pelo gestor
  estagio text not null default 'a_cadastrar',
    -- a_cadastrar | em_prospeccao | aguardando_retorno | sem_contato | sem_interesse | cadastrado
  sem_interesse_motivo text,
  -- munição (recalculada pelo job)
  volume_90d numeric(14,2), qtd_nfs_90d int, prazo_medio_dias int,
  sacados_principais jsonb,                          -- [{cnpj, nome, valor}]
  potencial_mensal numeric(14,2),                    -- estimativa de antecipação/mês
  ultima_nf_em date,
  -- contato
  contatos_encontrados int default 0,
  melhor_confianca text,                             -- alta | media | baixa | null
  ultima_busca_em timestamptz,
  entrou_em timestamptz default now(),
  atualizado_em timestamptz default now()
);
create index on fornecedores_funil (originador_id, estagio);
create index on fornecedores_funil (potencial_mensal desc);

create table contatos_descobertos (
  id uuid primary key default gen_random_uuid(),
  fornecedor_cnpj text not null,
  tipo text not null,                -- telefone | email | whatsapp | site | instagram
  valor text not null,
  nome_pessoa text, cargo text,
  fonte text not null,               -- xml_nfe | receita | google_places | site_empresa | apollo | novavida | claude_busca | sacado
  confianca text not null,           -- alta | media | baixa
  evidencia text,                    -- URL, nº da NF, trecho
  frequencia int default 1,          -- quantas vezes a mesma info apareceu (XMLs repetidos)
  ultima_vez_visto date,
  validado jsonb default '{}',       -- { tem_whatsapp: bool, mx_valido: bool, verificado_em }
  promovido_contato_id uuid references contatos(id),  -- quando vira contato oficial
  descoberto_em timestamptz default now(),
  unique (fornecedor_cnpj, tipo, valor)
);

create table pedidos_apresentacao (
  id uuid primary key default gen_random_uuid(),
  fornecedor_cnpj text not null,
  sacado_cnpj text not null,
  contato_sacado_id uuid references contatos(id),
  mensagem text,
  status text default 'rascunho',    -- rascunho | enviado | respondido | sem_resposta
  solicitado_por uuid references usuarios(id),
  criado_em timestamptz default now(), respondido_em timestamptz
);
```

## 3. Alimentação do funil (job `fornecedores/atualizar-funil`, após cada sync de NF)

- Entram fornecedores com `fornecedor_cadastrado = false` em NFs dos últimos 180 dias, cujo **volume 90d ≥ `fornecedores_config.corte_volume`** (config, default R$ 50.000) — entrada automática, sem curadoria manual.
- Recalcula munição: volume 90d, qtd de NFs, prazo médio, sacados principais, `potencial_mensal` (volume 90d ÷ 3), última NF.
- **Ordenação default do funil: `potencial_mensal` desc** (apenas volume do fornecedor — limite do sacado não entra na ordenação).
- **Saída automática**: fornecedor que passa a `fornecedor_cadastrado = true` no sync → `estagio = 'cadastrado'`, some da lista ativa, evento `fornecedor.cadastrado`; suas NFs seguem o fluxo normal do funil de antecipação e o originador titular é atribuído conforme o 04k.
- **Supressão**: "sem interesse" reutiliza a supressão existente (soft 90 dias → volta ao funil; eterna → não volta). Estágio `sem_interesse` com motivo.

## 4. Cascata de descoberta de contato

### 4.1 Camada 0+1 — AUTOMÁTICA, gratuita/barata (roda no job, sem ação do originador)

1. **XML da NF-e** (a melhor fonte para PME): parsear `raw_xml` de todas as NFs do fornecedor e extrair `emit/enderEmit/fone`, `emit/email` quando presente, e varrer `infAdic/infCpl` e `obsCont` por padrões de e-mail/telefone. **Agregar por fornecedor**: mesma informação repetida em N notas aumenta `frequencia` e a confiança; priorizar o que aparece mais e mais recentemente. Fonte `xml_nfe`, confiança **alta**.
2. **Cadastral da Receita**: `email_rfb`, `telefone1_rfb`, `telefone2_rfb` (via `mercado_universo`/lookup). Fonte `receita`, confiança **média**.
3. **Contatos existentes** no mesmo domínio ou grupo econômico. Fonte `site_empresa`/`apollo` conforme origem.
4. **Cascata de domínio** (etapas 1–4 do Prompt 03) + leitura da **página de contato** do site quando o domínio resolver (buscar telefone/e-mail/WhatsApp no HTML de `/contato`, `/fale-conosco`, rodapé). Fonte `site_empresa`.
5. **Google Places** (novo provedor — cobertura excelente para PME local de construção): buscar por razão social + município; extrair telefone, site e nome comercial. Custo baixo por consulta; parâmetro `custo_google_places` em config, incluído no orçamento automático mensal (`fornecedores_config.orcamento_automatico_mensal`, com bloqueio e alerta como no Radar). Fonte `google_places`, confiança **alta** quando o endereço bate com o cadastral.

### 4.2 Camadas 2+4 — UM CLIQUE do originador ("Buscar contatos", pago)

Botão único no card que dispara, em sequência, parando quando encontra contato de confiança alta (config `parar_ao_encontrar_alta`, default true):

**a) Nova Vida TI — sócios enriquecidos** (`novavida`):
- Token: `POST https://wsnv.novavidati.com.br/WSLocalizador.asmx/GerarTokenJson`, body `{ "credencial": { "usuario", "senha", "cliente" } }`. Resposta ASMX-JSON pode vir encapsulada em `d` — desembrulhar (`resp.d ?? resp.GerarTokenJsonResult ?? resp.token ?? resp`). **Erros vêm com HTTP 200 em texto puro** — tratar como falha se o retorno casar `/INCORRETO|SEM ACESSO|ATINGIDA|INVALID/i` ou tiver menos de 10 caracteres.
- **Cache do token por 23,5h** em tabela/registro de config (validade real 24h) — nunca gerar token por requisição.
- Consulta: `POST https://wsnv.novavidati.com.br/WSLocalizador.asmx/NVCHECKJson`, body `{ "nvcheck": { "Documento": "<cnpj>" } }`. Mapear telefones/e-mails de sócios para `contatos_descobertos` com `nome_pessoa`, fonte `novavida`, confiança **média**.
- **Credenciais em env**: `NOVAVIDA_USUARIO`, `NOVAVIDA_SENHA`, `NOVAVIDA_CLIENTE`. Nunca em código, nunca logadas.

**b) Apollo** — só se houver domínio resolvido E o porte sugerir estrutura administrativa (`funcionarios >= 10` ou faturamento estimado acima de config); caso contrário, pular e registrar o motivo (para PME sem LinkedIn é gasto sem retorno).

**c) Claude com web search** — `claude-sonnet-4-6` com a ferramenta `web_search` **obrigatoriamente habilitada**. Prompt: razão social, nome fantasia, CNPJ, município, UF, sacados principais. Instruir a procurar: site oficial, **Instagram e Facebook comercial** (muita PME de construção só existe nessas redes), Google Maps, listas locais e sindicatos/associações do setor. Retorno **apenas JSON**:
```json
{ "contatos": [ { "tipo": "telefone|email|whatsapp|instagram|site",
  "valor": "...", "nome_pessoa": null, "cargo": null,
  "confianca": "alta|media|baixa", "evidencia": "URL onde encontrou" } ] }
```
Nunca aceitar sem evidência; contato sem URL de origem é descartado.

**Antes de executar**, o botão mostra o **custo estimado do clique** (soma dos provedores que serão acionados) e o saldo do orçamento do originador no mês (`fornecedores_config.teto_mensal_por_originador`) — originador aciona sozinho, dentro do teto; estourou, precisa de liberação do gestor.

### 4.3 Camada 3 — SEMPRE APARTADA: "Pedir apresentação ao sacado"

Botão próprio no card (não faz parte do clique de busca). Fluxo: escolhe o sacado (dos `sacados_principais`, priorizando os que têm ponto focal conhecido) → sistema gera a mensagem (template configurável, com variáveis do fornecedor e do volume) → registra em `pedidos_apresentacao`. Nesta fase o texto é **copiável** e o envio real fica para o Prompt 05 (quando houver canal); marcar como enviado manualmente. Maior taxa de conversão do conjunto: transforma cold call em introdução quente.

### 4.4 Validação (sempre, em qualquer fonte)
Telefone: normalizar E.164 BR, checar se tem WhatsApp (quando o provedor permitir) · E-mail: sintaxe + registro MX do domínio · Deduplicar por (cnpj, tipo, valor) somando `frequencia`. Resultado em `contatos_descobertos.validado`. Contato inválido não é apagado — fica com confiança rebaixada e marcado.

## 5. UI (menu Comercial → Cadastro de Fornecedores)

**Funil** (kanban web / lista com swipe mobile) por estágio: a cadastrar · em prospecção · aguardando retorno · sem contato · sem interesse · (cadastrado sai da view; acessível em filtro "concluídos").

**Card do fornecedor = ficha de abordagem** (a munição antes do contato): razão social e CNPJ, **volume 90d, nº de NFs, prazo médio, potencial mensal estimado**, sacados principais com valores, última NF, dados cadastrais (porte, idade, UF), e a lista de contatos descobertos com **fonte, confiança e evidência** visíveis.

Ações no card: **Buscar contatos** (§4.2, com custo estimado) · **Pedir apresentação ao sacado** (§4.3) · mover estágio · **marcar sem interesse** (90 dias ou eterna, com motivo) · ligar/WhatsApp/e-mail em um toque (mobile, registrando `toque.manual` como no 04) · **"Tornar ponto focal"** — botão de um clique em qualquer contato descoberto: promove para `contatos` oficial da empresa e marca `ponto_focal = true` (desmarcando o anterior), registrando `promovido_contato_id`.

**Painel do originador**: contagem por estágio, potencial total na carteira, gasto do mês em descoberta vs. teto, e ranking dos fornecedores por potencial.

## 6. Aprendizado de fontes (loop 04f)

Registrar, para cada fornecedor que chega a `cadastrado`, **qual contato e qual fonte** levaram ao cadastro (o contato usado no último toque antes da conversão). Painel simples de eficácia por fonte: contatos encontrados, % válidos, % que geraram cadastro, custo por cadastro. Em 3 meses isso reordena a cascata com evidência — e permite desligar provedor que não paga.

## 7. Eventos, tools e entregáveis

**Eventos**: `fornecedor.entrou_funil`, `fornecedor.contatos_encontrados`, `fornecedor.sem_contato`, `fornecedor.sem_interesse`, `fornecedor.cadastrado`, `apresentacao.solicitada`, `orcamento_descoberta.alerta`.
**Tools**: `fornecedores.meu_funil` (read), `fornecedores.buscar_contatos` (mutates — respeita teto), `fornecedores.pedir_apresentacao` (mutates — cria rascunho), `fornecedores.promover_ponto_focal` (mutates).
**Worker**: `fornecedores/atualizar-funil` (após sync de NF), `fornecedores/descoberta-automatica` (camadas 0+1, em lote), `fornecedores/descoberta-sob-demanda` (clique), `fornecedores/validar-contatos` (diário).
**Core**: parser de contatos do XML NFe (reutilizável), normalizador E.164, cliente Nova Vida com cache de token, provedor Google Places — todos com testes; provedores atrás da mesma interface plugável do Radar.
**Web/Mobile**: funil completo nos dois (mobile é onde o originador trabalha em campo); settings do módulo = `webOnly`.
**Env**: `NOVAVIDA_USUARIO`, `NOVAVIDA_SENHA`, `NOVAVIDA_CLIENTE`, `GOOGLE_PLACES_API_KEY` (+ chaves já existentes).
**Docs**: README — ordem da cascata, o que roda automático vs. o que custa, política de tetos, como interpretar confiança e evidência.

## 8. Fora de escopo (Prompt 05+)

Envio real do pedido de apresentação e das mensagens ao fornecedor, cadência automatizada de prospecção de fornecedor, agente autônomo decidindo quem buscar.
