-- ============================================================================
-- 0168 — O pitch do SDR: o que dizer nesta ligação, sobre ESTA empresa
--
-- O funil de reuniões entregava um nome, uma UF e um valor esperado. Com isso o
-- SDR abre a ligação perguntando o que a nossa própria base já sabe responder:
-- em que região a empresa atua, que porte tem, se está abrindo SPE e tocando
-- obra, quem já emite nota contra ela, e se esses fornecedores estão apertados.
--
-- Essas respostas estão espalhadas por seis tabelas (`empresas`,
-- `mercado_metricas`, `mercado_obras`, `notas_fiscais`, `protestos_atual`,
-- `contatos`) e ninguém as junta antes de discar. O pitch é essa junção, escrita
-- em português por um modelo, e guardada aqui.
--
-- ─── POR QUE UMA TABELA, E NÃO UM CAMPO EM `sdr_leads` ──────────────────────
-- O pitch é caro (uma chamada ao modelo), tem procedência (modelo, tokens,
-- quando) e é DESCARTÁVEL: regerar é sempre legítimo. Um punhado de colunas de
-- texto em `sdr_leads` misturaria um artefato de IA com o registro do que
-- aconteceu no funil — e o registro do funil não pode ser regerado.
--
-- ─── `fatos` NÃO É DECORAÇÃO ────────────────────────────────────────────────
-- Guarda o dossiê exato que foi enviado ao modelo. Quando o SDR disser "isso
-- está errado", a pergunta seguinte é "o modelo inventou ou a base está
-- errada?", e sem o dossiê as duas respostas são igualmente plausíveis. Também é
-- o que permite conferir se um pitch velho ainda descreve a empresa de hoje.
--
-- ─── SEM ESCRITA PARA `authenticated` ───────────────────────────────────────
-- Quem grava é o worker (service_role), que é quem tem a chave da Anthropic. Um
-- `insert` pela web permitiria um pitch escrito à mão passando por gerado —
-- exatamente a confusão que `modelo`/`tokens` existem para evitar.
-- ============================================================================

create table public.sdr_lead_pitches (
  lead_id uuid primary key references public.sdr_leads(id) on delete cascade,
  -- Redundante com o lead de propósito: é por empresa que se pergunta "já temos
  -- pitch?" quando o lead anterior morreu e um novo nasceu.
  empresa_id uuid not null references public.empresas(id) on delete cascade,

  -- As duas primeiras frases da ligação, prontas para ler em voz alta.
  abertura text not null,
  -- Quem é a empresa: região, porte, momento de vida.
  contexto text not null,
  -- Por que o produto interessa a ELA — alongar prazo, destravar fornecedor.
  angulo text not null,
  -- Com quem se fala e como esse cargo pensa. Null quando não há contato na base.
  persona text,
  -- Os pontos a levantar durante a ligação. Array de strings.
  pontos jsonb not null default '[]'::jsonb,
  -- Expressões da região/segmento, para não soar de fora. Array de strings.
  jargoes jsonb not null default '[]'::jsonb,
  -- O dossiê que gerou o texto. Ver a nota acima.
  fatos jsonb not null default '{}'::jsonb,

  modelo text,
  tokens integer,
  gerado_em timestamptz not null default now(),
  gerado_por uuid references public.usuarios(id) on delete set null
);

create index sdr_lead_pitches_empresa_idx on public.sdr_lead_pitches (empresa_id);

comment on table public.sdr_lead_pitches is
  'O pitch gerado por IA para o SDR ligar: um por lead do funil de reuniões. '
  'Escrito pelo worker (service_role); a web só lê. `fatos` guarda o dossiê '
  'enviado ao modelo, para separar erro de base de erro de modelo.';

alter table public.sdr_lead_pitches enable row level security;

/*
 * Vê o pitch quem vê o lead — a MESMA régua de `sdr_leads_select`, e não uma
 * cópia mais frouxa. O pitch cita fornecedores, protestos de terceiros e nomes
 * de contatos: se ele fosse visível a mais gente que o card, seria a linha por
 * onde a carteira de um SDR vaza para outro.
 *
 * `(select ...)` nos helpers é o InitPlan da 0131: sem ele a função STABLE roda
 * por linha varrida.
 */
create policy sdr_lead_pitches_select on public.sdr_lead_pitches
  for select using (
    (select public.app_tem_modulo('comercial'))
    and exists (
      select 1 from public.sdr_leads l
      where l.id = sdr_lead_pitches.lead_id
        and (
          public.app_pode_ver_vendedor(l.sdr_id)
          or (l.vendedor_destino_id is not null
              and public.app_pode_ver_vendedor(l.vendedor_destino_id))
        )
    )
  );

grant select on public.sdr_lead_pitches to authenticated;
