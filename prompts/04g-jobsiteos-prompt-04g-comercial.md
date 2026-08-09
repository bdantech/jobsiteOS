# JOBSITEOS — Claude Code Prompt 04g: Estrutura Comercial
## Ativo/passivo, vendedores (humanos e IA), roteamento, funis de SDR e closer, comissões e painel do vendedor

> Builds on Prompts 01–04f. Reuse pesado: funil de NFs (04), esteira de crédito (04d), conversões (04e), valor esperado (04d), outbox e contas WhatsApp (04), camadas (02), event log, `notify()`. UI pt-BR, code English. Migrations via Supabase MCP. Painéis de vendedor são **mobile-first** — evolução do modo-rua do Prompt 04.

---

## 1. Gestão de operação do cliente: ativo × passivo (aplica-se a SACADOS)

```sql
alter table empresas add column gestao_operacao text; -- 'prospeccao_ativa' | 'passivo' | null (não-cliente)
alter table empresas add column gestao_definida_por uuid;
alter table empresas add column gestao_definida_em timestamptz;
```
- Definição **manual** (Company 360 e painel de clientes; web e mobile), com **sugestão automática**: job mensal marca candidatos a passivo (sacado cliente cujos fornecedores antecipam com frequência — ≥ N antecipações/2m via 04e — sem nenhum toque nosso registrado no período) → notificação ao gestor com aceitar/recusar. Nunca muda sozinho.
- **Efeitos de passivo** (o toggle visual é o menor deles):
  - Funil de NFs: toggle "Ocultar NFs de sacados passivos" (persistido por usuário, web e mobile).
  - NF cujo **sacado** é passivo: não gera outbox, não entra em carteira de originador, não conta na distribuição. Passivo é passivo de verdade.
  - Empresas passivas entram na **carteira de gestão** de um vendedor (base da comissão dele, §6).
- Evento `cliente.gestao_alterada`.

## 2. Vendedores

```sql
create table vendedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null,                 -- 'sdr' | 'vendedor' | 'originador'
  usuario_id uuid references usuarios(id),  -- null quando IA
  is_ia boolean default false,        -- vendedor de IA com nome próprio (ex.: "Carina")
  whatsapp_conta_id uuid references whatsapp_contas(id),
  email_remetente text,
  settings jsonb default '{}',        -- por tipo, ver abaixo
  ativo boolean default true,
  criado_em timestamptz default now(),
  check (usuario_id is not null or is_ia = true)
);
create table vendedor_territorios (
  vendedor_id uuid references vendedores(id) on delete cascade,
  ufs text[] default '{}',
  faturamento_min numeric(16,2), faturamento_max numeric(16,2),
  primary key (vendedor_id)
);
create table vendedor_carteira (          -- TEMPORAL: quem era dono quando importa p/ comissão
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid references vendedores(id),
  empresa_id uuid references empresas(id),
  papel text not null,                -- 'originacao' | 'gestao_passiva' | 'sdr'
  desde timestamptz default now(),
  ate timestamptz,                    -- null = vigente
  unique (empresa_id, papel, ate)     -- um dono vigente por papel
);
create table vendedor_acessos (           -- visibilidade cruzada de painéis
  vendedor_id uuid references vendedores(id) on delete cascade,
  pode_ver_vendedor_id uuid references vendedores(id) on delete cascade,
  primary key (vendedor_id, pode_ver_vendedor_id)
);
create table motivos_perda (
  id uuid primary key default gen_random_uuid(),
  contexto text not null,             -- 'funil_vendedor' | 'sdr_sem_fit'
  motivo text not null,
  ativo boolean default true
);
```
**Settings por tipo** (jsonb, com UI):
- `sdr`: `direcao: 'in' | 'out' | 'both'`; `vendedor_destino_default: uuid` (para onde vão as reuniões); `empresas_por_semana` (default herdado da config global).
- `originador`: `empresas_escolhidas: uuid[]` (carteira explícita de originação — **só empresas de prospecção ativa**; UI impede adicionar passiva).
- `vendedor`: sem settings específicas na v1 (metas ficam para fase 2 — deixar chave `meta_mensal` prevista no jsonb).

Seeds `motivos_perda` (contexto funil_vendedor): sem interesse, crédito negado, taxa/preço, escolheu concorrente, sem urgência/timing, sem documentação, empresa sem fit, sem retorno (ghosting), outro. (contexto sdr_sem_fit): porte pequeno demais, fora de região, segmento errado, já atendido, dados incorretos, outro.

## 3. Roteamento de NFs para originadores

Precedência, avaliada na classificação de cada NF em faixa (sacado de prospecção ativa apenas):
1. **Carteira explícita**: fornecedor OU sacado na `empresas_escolhidas` de um originador → NF dele.
2. **Território**: UF + faixa de faturamento do sacado casam com `vendedor_territorios` de um originador → dele (empate: o com menos NFs vivas).
3. **Fila sem dono**: visível a gestores (perfil Admin/Comercial) para atribuição manual.
Reatribuição manual sempre possível (gestor); movimentos logados. Campo `notas_fiscais.vendedor_id`.

## 4. Funil de reuniões (SDR) — novo

```sql
create table sdr_leads (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id) not null,
  sdr_id uuid references vendedores(id) not null,
  origem text not null,               -- 'distribuicao' | 'inbound' | 'manual'
  estagio text not null default 'a_contatar',
    -- a_contatar | em_conversa | com_fit | sem_fit | reuniao_agendada | reuniao_realizada
    -- | no_show | qualificada | desqualificada
  sem_fit_motivo uuid references motivos_perda(id),
  reuniao_em timestamptz,
  vendedor_destino_id uuid references vendedores(id),
  distribuido_em timestamptz default now(),
  atualizado_em timestamptz
);
```
- **Fit**: após contato, o SDR marca **com fit** (segue para agendamento) ou **sem fit** (motivo obrigatório da lista; sai do funil, empresa ganha evento — insumo direto do Perfil 04f). Inbound descartado = sem fit com motivo → **metrificado** (taxa de fit por origem no dashboard).
- **Distribuição semanal** (job `comercial/distribuir-sdr`, segunda 07:00 SP): fonte configurável — **`som` | `som_sam` | `som_sam_tam`** (config global `comercial_config.fonte_distribuicao`, default `som`) — ordenada por `valor_esperado_mensal` desc, respeitando: direção do SDR (inbound recebe empresas com evento de resposta/interesse; outbound recebe frios), território, supressão, não redistribuir empresa com lead vivo ou sem_fit recente (< 90d), balanceamento pela carga atual. `empresas_por_semana` default 25 (config global, override por SDR).
- **SLA de apodrecimento**: lead `a_contatar` sem toque em Y dias (config, default 7) → volta ao pool, redistribui, evento `sdr.lead_expirado`.
- **Agendamento**: ao marcar reunião, SDR escolhe o **vendedor destino** (pré-selecionado pelo `vendedor_destino_default`) e enxerga o **calendário do vendedor** (§7) para escolher horário livre. Agendou → cria automaticamente o card no funil do vendedor (§5) em `reuniao_agendada` + evento de calendário para ambos.
- No-show e reagendamento registrados (no-show alimenta §6).

## 5. Funil do vendedor (closer)

```sql
create table vendas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id) not null,
  vendedor_id uuid references vendedores(id) not null,
  sdr_lead_id uuid references sdr_leads(id),      -- proveniência
  estagio text not null default 'reuniao_agendada',
    -- reuniao_agendada | reuniao_reagendada | aguardando_documentacao | em_analise_credito
    -- | proposta_enviada | preparacao_mou | mou_assinado | onboarding | ganho | perdido
  perdido_motivo uuid references motivos_perda(id),
  perdido_em timestamptz,
  analise_credito_id uuid references analises_credito(id),
  criada_em timestamptz default now(),
  atualizada_em timestamptz
);
```
- **Perdido em qualquer estágio**, motivo obrigatório (lista config, seeds acima). Kanban + lista, por vendedor e visão geral por empresa.
- **Integração com a esteira de crédito (04d)**: entrar em `em_analise_credito` sugere criar/vincular a análise; decisão **aprovada** → card avança automaticamente para `proposta_enviada` (evento + push ao vendedor); **negada** → card vira `perdido` com motivo "crédito negado" automaticamente (evento + push). `aprovada_parcial` → notifica e deixa o vendedor decidir.
- `onboarding` concluído → estágio `ganho`: empresa vira `estagio = 'cliente'`, dispara a decisão ativo/passivo (notificação ao gestor) e, se passiva, entra na carteira de gestão de um vendedor.

## 6. Comissões (desenho defensivo)

```sql
create table comissao_regras (
  id uuid primary key default gen_random_uuid(),
  tipo_vendedor text not null,
  vendedor_id uuid references vendedores(id),     -- null = regra padrão do tipo; preenchido = override
  parametros jsonb not null,
  vigente_de date not null, vigente_ate date,     -- vigência: regra muda, histórico não reescreve
  criada_por uuid, criada_em timestamptz default now()
);
create table comissao_lancamentos (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid references vendedores(id) not null,
  competencia date not null,                      -- primeiro dia do mês
  origem_tipo text not null,   -- 'reuniao_agendada' | 'nf_convertida' | 'volume_passivo' | 'estorno'
  origem_id text not null,     -- id rastreável (sdr_lead, antecipacao id_externo, agregado mensal)
  descricao text,
  valor numeric(12,2) not null,                   -- negativo em estornos
  status text not null default 'apurado',         -- apurado | aprovado | pago
  regra_id uuid references comissao_regras(id),
  criado_em timestamptz default now(),
  unique (origem_tipo, origem_id, vendedor_id)
);
```
**Regras seed** (parametros):
- **SDR — por reunião AGENDADA**: `{ valor_por_reuniao: 100 }`. Config `estorno_no_show: false` (desligado por padrão; se ligado, no-show gera lançamento negativo automático).
- **Originador — por NF convertida**: `{ valor_por_milhao: 550 }` → lançamento = `gross_value/1.000.000 × valor_por_milhao` no evento `nf.convertida` (04e) de NF da carteira dele. **Clawback automático**: `antecipacao.regrediu` em antecipação comissionada → lançamento de estorno espelhado, status `apurado` para revisão.
- **Vendedor — por volume de passivas geridas**: `{ valor_por_milhao: 300 }` sobre o volume antecipado no mês (soma de `antecipacoes` conversoras) das empresas na sua carteira `gestao_passiva`.

**Atribuição temporal**: todo lançamento consulta `vendedor_carteira` **na data do evento** — troca de carteira nunca reatribui retroativamente. Job mensal `comercial/apurar-comissoes` (dia 1) fecha a competência anterior; gestor revisa e **aprova antes de pago** (transições logadas). Tela: por vendedor, mês a mês, com drill até o evento de origem de cada linha.

## 7. Painel do vendedor ("Meu Painel") + calendário

- Rota resolve o vendedor pelo usuário logado; **menus montados pelo tipo**: SDR → funil de reuniões, calendário, comissão · Originador → funil de NFs (roteado), comissão · Vendedor → funil próprio, empresas passivas geridas, calendário, comissão. Preferências pessoais (ordenação default, cards visíveis) em jsonb.
- **Acessos cruzados**: seletor de painel para quem tem `vendedor_acessos` (gestor vê tudo; leitura, não ação em nome do outro na v1).
- **Calendário interno** (v1): eventos de reunião dos funis + follow-ups manuais; visões dia/semana; **export .ics** por vendedor (feed assinado por token) para o vendedor assinar no Google/Outlook por conta própria. SDR enxerga o calendário do vendedor destino ao agendar (disponibilidade, não detalhes de eventos de outros). Integração OAuth Google = fase 2, fora deste prompt.
- **Leaderboard** (config liga/desliga, default off): ranking do mês por tipo (reuniões agendadas/realizadas, NFs convertidas, volume).
- **Evento `vendedor.sem_atividade`**: nenhum toque/movimento em Z dias (config, default 5 úteis) → notifica gestor.
- **Mobile-first**: todos os funis com swipe de estágio (padrão do 04), push de: reunião agendada para mim, crédito decidido, comissão fechada, lead distribuído.
- **Company 360** ganha seção "Comercial": donos vigentes por papel, cards vivos nos funis, histórico de donos e de perdas.

## 8. Tools de IA e eventos

Tools: `comercial.meu_resumo` (read: meu funil, minhas pendências, minha comissão do mês — resolve o vendedor pelo usuário), `comercial.agendar_reuniao` (mutates: cria reunião SDR→vendedor), `comercial.mover_estagio_venda` (mutates), `comercial.comissao_vendedor` (read; restrita ao próprio ou acessos).
Eventos: `cliente.gestao_alterada`, `sdr.lead_distribuido`, `sdr.sem_fit`, `sdr.reuniao_agendada`, `sdr.no_show`, `sdr.lead_expirado`, `venda.estagio_alterado`, `venda.perdida`, `venda.ganha`, `comissao.apurada`, `comissao.aprovada`, `vendedor.sem_atividade`.
Seeds `notificacao_regras`: reunião agendada → vendedor destino; crédito decidido → vendedor do card; `vendedor.sem_atividade` e fila sem dono → gestores; `comissao.apurada` → cada vendedor.

## 9. Entregáveis

**Worker**: `comercial/distribuir-sdr` (semanal), `comercial/sla-leads` (diário), `comercial/sugerir-passivos` (mensal), `comercial/apurar-comissoes` (mensal), hooks nos eventos do 04d/04e (avanço de estágio, comissão, clawback).
**Web + Mobile**: painéis por tipo, funis (kanban web / lista+swipe mobile), calendário, telas de comissão, admin de vendedores/territórios/regras/motivos (webOnly), toggle de passivos no funil de NFs.
**Core**: motor de roteamento com testes (precedência, empate, passivo excluído); cálculo de comissão com testes (atribuição temporal, clawback, vigência de regra).
**Docs**: README — roteamento, ciclo de comissão (apurado→aprovado→pago), semântica ativo/passivo, e a ponte para o Prompt 05 (mensagens da outbox atribuídas ao vendedor dono; humano aprova, IA dispara).

## 10. Fora de escopo (Prompt 05+)

Envio real de mensagens pelos vendedores (05), automação do vendedor IA (05), OAuth Google Calendar, metas e forecast, comissão de gestor/override.
