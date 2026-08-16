# JOBSITEOS — Claude Code Prompt 04i: Leads & Formulários
## Formulários embutíveis nas landing pages, tracking por form/UTM, enriquecimento automático na chegada e auto-resposta com agendamento

> Builds on Prompts 01–04h. Reuse pesado: Radar (cascata de domínio, Apollo, lotes/orçamento — 03), estimador e score (04c/04d), funil de SDR e vendedores (04g), `cnpj_lookup_fila` (04), supressão, event log, Resend, Supabase Storage. UI pt-BR, code English. Migrations via Supabase MCP.
> **Localização**: menu **Leads** dentro do módulo **Comercial** (04g).

---

## 1. Modelo

```sql
create table formularios (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,             -- usado na URL/embed (ex.: 'lp-antecipacao-sp')
  nome text not null,                    -- interno
  descricao text,
  -- conteúdo
  titulo text, subtitulo text,
  texto_botao text default 'Enviar',
  mensagem_sucesso text,
  -- estrutura
  campos jsonb not null,                 -- [{ key, label, tipo, obrigatorio, ordem, placeholder, opcoes? }]
  pergunta_intencao jsonb,               -- null = não exibir; ver §3
  consentimento_texto text,              -- LGPD; null = sem checkbox
  consentimento_obrigatorio boolean default true,
  -- comportamento
  vendedor_destino_id uuid references vendedores(id),  -- default de roteamento
  auto_resposta_habilitada boolean default true,
  auto_resposta_assunto text, auto_resposta_corpo text, -- templates com variáveis
  enriquecimento_pago boolean default false,           -- Apollo/protestos automáticos (§5)
  ativo boolean default true,
  criado_por uuid references usuarios(id),
  criado_em timestamptz default now()
);

create table formulario_submissoes (
  id uuid primary key default gen_random_uuid(),
  formulario_id uuid references formularios(id),
  -- payload
  dados jsonb not null,                  -- valores enviados
  campos_snapshot jsonb not null,        -- estrutura do form NO MOMENTO do envio (form editável não quebra análise)
  intencao text,                         -- ver §3
  -- tracking
  utm_source text, utm_medium text, utm_campaign text, utm_term text, utm_content text,
  referrer text, pagina_url text, user_agent text, ip_hash text,
  -- resultado
  cnpj text, empresa_id uuid references empresas(id), contato_id uuid references contatos(id),
  sdr_lead_id uuid references sdr_leads(id),
  status text not null default 'recebida', -- recebida | processada | revisao | descartada_spam | erro
  divergencia_papel boolean default false, -- intenção declarada × diagnóstico do CNPJ (§3)
  consentimento_aceito boolean, consentimento_em timestamptz,
  erro text,
  criada_em timestamptz default now()
);
create index on formulario_submissoes (formulario_id, criada_em desc);
create index on formulario_submissoes (cnpj);

create table formulario_visualizacoes (   -- para taxa de conversão do form
  id bigserial primary key,
  formulario_id uuid references formularios(id),
  utm_source text, utm_campaign text, pagina_url text,
  visto_em timestamptz default now()
);
```

## 2. Construtor (menu Comercial → Leads → Formulários; webOnly)

- Lista de formulários com métricas resumidas (views, submissões, taxa, reuniões geradas, clientes gerados).
- Construtor: escolher campos do **catálogo de empresa** (cnpj**, razão social, uf, municipio, faturamento declarado, erp_atual, tipo) e do **catálogo de contato** (nome, cargo, email, telefone/whatsapp, cargo), marcar obrigatórios, ordenar (drag), textos, consentimento LGPD, vendedor destino, auto-resposta, toggle de enriquecimento pago.
- **CNPJ é sempre obrigatório e sempre presente** (não removível): validação de dígito verificador no cliente + **autocomplete de razão social via BrasilAPI** ao completar 14 dígitos (preenche o campo de razão social, reduz erro e desistência). Microtexto configurável, default: "Usamos seu CNPJ apenas para agilizar seu atendimento."
- Preview ao vivo (claro/escuro) e geração do snippet.

## 3. Pergunta de intenção (papel) — configurável por formulário

`pergunta_intencao` (quando presente) renderiza uma escolha única. Default seedado:
> **"O que você procura?"**
> - `cedente` — "Antecipar notas que emito para meus clientes"
> - `sacado` — "Oferecer antecipação aos meus fornecedores / gerenciar pagamentos"
> - `erp` — "Sistema de gestão para minha empresa"

Rótulos e opções editáveis (a LP do Brik pode omitir a pergunta inteira).

**Cruzamento com o diagnóstico automático do CNPJ**: após resolver o cadastral (§5), comparar a intenção declarada com o perfil inferido (CNAE/porte/grupo → construtora/incorporadora vs. fornecedor/subempreiteiro). Concordam → roteia direto. **Divergem** → `divergencia_papel = true`, o card do SDR exibe alerta ("declarou-se contratante, mas o CNPJ indica prestador de serviço") — divergência costuma ser lead confuso OU lead muito interessante (subempreiteiro grande que também subcontrata). Nunca descartar por divergência.

Roteamento por intenção: `sacado` → funil de SDR (04g) · `cedente` → funil de SDR marcado como oportunidade de fornecedor, e a empresa recebe `tipagem_antecipacao = 'aquisicao'` · `erp` → funil de SDR com tag de produto Brik. Em todos os casos o SDR trabalha; a tag muda o pitch.

## 4. Entrega: embed e página standalone

- **Snippet de uma linha** gerado por form: `<script src="https://{APP_URL}/f/{slug}.js" async></script>` (+ `<div id="jobsiteos-form-{slug}"></div>` opcional para posicionar). Servido por rota do Next com cache curto e CORS liberado.
  - O script injeta o formulário com **os design tokens da plataforma** (zinc + `#1a7a4a`), **detecta tema claro/escuro** pela luminância do fundo do container, é responsivo à largura do container, e isola o CSS (shadow DOM ou classes prefixadas) para não conflitar com o CSS da landing page.
  - **Instrução Framer** (documentar no README e na UI ao copiar o snippet): colar em um componente **Embed** (HTML) na página; funciona em preview e publicado.
- **Página standalone**: `/{APP_URL}/f/{slug}` — mesmo formulário em página própria (bio de redes, QR code em evento, assinatura de e-mail).
- **Tracking automático**: o script registra visualização (`formulario_visualizacoes`) e captura UTMs da URL da página hospedeira, `document.referrer` e a URL completa, enviando junto da submissão.

## 5. Processamento da submissão (endpoint público `POST /api/f/{slug}`)

**Proteções** (porta aberta para a internet): rate limit por IP e por CNPJ, **honeypot** (campo oculto) + **tempo mínimo de preenchimento** (< 2s = bot) → `descartada_spam` silenciosamente; validação server-side de CNPJ (dígito) e e-mail; consentimento obrigatório quando configurado (grava aceite + timestamp); IP armazenado apenas como hash. CAPTCHA **não** na v1 (mata conversão) — deixar ponto de extensão caso o spam apareça.

**Pipeline (síncrono o que é rápido; o resto em fila):**
1. Grava `formulario_submissoes` (status `recebida`) com snapshot dos campos e tracking.
2. **Empresa**: dedup por CNPJ normalizado. Existe → **enriquece, nunca duplica** (preenche vazios, registra evento no timeline dela). Não existe → cria e enfileira em `cnpj_lookup_fila`.
3. **Contato**: dedup por e-mail/telefone dentro da empresa; novo contato marcado como **ponto focal** se a empresa ainda não tiver um. `origem = 'formulario:{slug}'`.
4. **Enriquecimento automático GRATUITO, imediato** (roda já, sem aprovação — custo zero): cadastral (minhareceita/BrasilAPI — CNAE, capital social, natureza jurídica, idade, situação, Simples), cascata de domínio (etapas 1–4), estimativa de faturamento (04c), cálculo de score e potencial (04d), verificação de grupo/SPEs e obras CNO se já houver dado.
5. **Enriquecimento automático PAGO** (Apollo/funcionários + contatos; protestos): **somente se `enriquecimento_pago = true` no form** E dentro do teto próprio `comercial_config.orcamento_inbound_mensal` (config, com alerta e bloqueio como no Radar). Executa como lote automático de 1 item (`lotes_enriquecimento`, `criado_por = null`, já aprovado — é política) para manter rastreabilidade e custo contabilizado.
6. **Cria o lead de SDR** (04g) com `origem = 'inbound'`, roteado: SDR com `direcao in|both` por território/carga; `vendedor_destino_id` do form como destino pré-selecionado da futura reunião. Card já nasce com o dossiê preenchido pelos passos 4–5.
7. **Supressão**: CNPJ/e-mail em supressão eterna → NÃO bloquear (a pessoa está pedindo contato); marcar `status = 'revisao'` + notificação para decisão humana.
8. Eventos: `lead.inbound_recebido` (payload: form, utm, intenção) → **push imediato ao SDR** (velocidade de resposta é o fator nº 1 de conversão em inbound), `formulario.submissao_erro` em falhas → fila de revisão (nada se perde em silêncio).

## 6. Auto-resposta ao lead (imediata)

Se `auto_resposta_habilitada`: e-mail via Resend logo após o processamento, do remetente do vendedor destino (fallback: remetente institucional). Template com variáveis (`{nome}`, `{empresa}`, `{vendedor}`) e **link de agendamento** apontando para a disponibilidade do vendedor destino (§7). Registrar o envio em `mensagens_outbox` (canal `email`, status `enviada`) para manter o histórico unificado e o cooldown coerente.
Corpo default (editável): confirmação do recebimento + convite direto para escolher um horário + assinatura do vendedor.
**WhatsApp**: campo e toggle já previstos no formulário, porém **desabilitados nesta fase** (rotulados "disponível no próximo release") — o disparo real vem no Prompt 05.

## 7. Link de agendamento (mínimo viável)

Página pública `/agendar/{token}` por lead: mostra os horários livres do vendedor destino (a partir do calendário interno do 04g), o lead escolhe → cria a reunião, move o `sdr_lead` para `reuniao_agendada`, cria o card em `vendas` (04g) e notifica ambos. Token de uso único com expiração (config, default 7 dias). Sem integração Google nesta fase.

## 8. Dashboard de performance (menu Leads)

Comparativo **por formulário** e **por UTM** (source/medium/campaign), período configurável:
- Funil completo: visualizações → submissões (**taxa de conversão do form**) → leads com fit → reuniões agendadas → reuniões realizadas → clientes → **valor esperado gerado** (soma do `valor_esperado_mensal` das empresas originadas).
- Tabela ordenável e gráfico simples de tendência; drill-down até as submissões cruas.
- Distribuição por intenção declarada e taxa de divergência de papel por form (mede clareza da landing page).
- Aba "Submissões": todas as submissões com status, incluindo `revisao`, `erro` e `descartada_spam` (auditáveis).

## 9. Tools de IA e eventos

Tools: `leads.performance_formularios` (read: métricas comparativas), `leads.submissoes_recentes` (read), `leads.criar_formulario` (mutates: cria rascunho inativo a partir de descrição — nunca publica ativo).
Eventos: `lead.inbound_recebido`, `formulario.submissao_erro`, `formulario.spam_detectado` (agregado diário, não por item), `lead.agendou_pelo_link`.
Seeds `notificacao_regras`: `lead.inbound_recebido` → SDR roteado (push imediato) + gestores; `formulario.submissao_erro` e submissões em `revisao` → gestores.

## 10. Entregáveis

**Web**: menu Leads no Comercial (lista, construtor com preview, dashboard, submissões), rota do script `/f/{slug}.js`, página standalone `/f/{slug}`, página `/agendar/{token}`.
**Mobile**: leads inbound no funil de SDR (já existente) com selo de origem/UTM e dossiê enriquecido; dashboard de formulários em leitura. Construtor = webOnly.
**Worker/API**: endpoint público de submissão com proteções, pipeline de enriquecimento (grátis imediato / pago sob toggle e teto), auto-resposta.
**Core**: validador de CNPJ, normalizador de UTM, motor de roteamento inbound com testes (dedup de empresa existente, divergência de papel, supressão em revisão, spam).
**Docs**: README — como colar no Framer (passo a passo com Embed), o que roda automático e o que custa dinheiro, como interpretar o dashboard.

## 11. Fora de escopo (Prompt 05+)

Auto-resposta e follow-up por WhatsApp, sequências de nutrição multi-toque, integração Google Calendar, A/B test automático de formulários (a comparação hoje é manual via múltiplos forms), CAPTCHA.
