-- ─────────────────────────────────────────────────────────────────────────────
-- 0264 — O lembrete não espera o cooldown, e o plantão não repete
--
-- ─── 1. LEMBRETE DE REUNIÃO GANHA ORIGEM PRÓPRIA ─────────────────────────────
-- Os lembretes (confirmação, D-1, D-0, H-1, reagendamento) entravam na fila com
-- `origem = 'outbox'`, a mesma da régua de antecipação — e a fila aplica o
-- intervalo mínimo entre contatos (3 dias) justamente a essa origem. O último
-- toque conta QUALQUER saída para o contato, inclusive a conversa em que o SDR
-- marcou a reunião: o lembrete de uma reunião combinada ontem era descartado como
-- "falamos com este contato há pouco tempo". Em 90 dias, 220 de 227 descartados,
-- todos por esse motivo.
--
-- O cooldown existe para não insistir com quem não pediu nada. Lembrete é o
-- contrário: é a pessoa que marcou. Com origem própria, a fila deixa de aplicar o
-- cooldown a ele (o resto do portão — supressão, teto, janela — continua valendo),
-- e o ledger passa a distinguir lembrete de régua numa auditoria.
--
-- Os CHECKs vêm do banco vivo, não da migração que os criou.
alter table public.mensagens_outbox drop constraint if exists mensagens_outbox_origem_check;
alter table public.mensagens_outbox add constraint mensagens_outbox_origem_check
  check (origem = any (array['compositor', 'outbox', 'agente', 'campanha', 'lembrete']::text[]));

alter table public.comunicacoes drop constraint if exists comunicacoes_origem_check;
alter table public.comunicacoes add constraint comunicacoes_origem_check
  check (origem is null or origem = any (array[
    'compositor', 'outbox', 'agente', 'app_toque', 'inbox', 'sistema', 'campanha', 'celular', 'lembrete'
  ]::text[]));

-- ─── 2. O PLANTÃO LEMBRA O QUE JÁ MANDOU ─────────────────────────────────────
-- A varredura roda de hora em hora e olhava 65 minutos para trás: o evento que
-- caía nos 5 minutos de sobra saía duas vezes. Sem registro do que já foi, não
-- havia como a janela ser maior (cobrir uma rodada perdida) sem repetir tudo.
--
-- Agora cada evento é REIVINDICADO antes do envio: quem insere a linha manda;
-- quem esbarra na chave primária pula. Vale também para duas rodadas simultâneas.
create table if not exists public.plantao_enviados (
  evento_id   uuid primary key references public.empresa_eventos (id) on delete cascade,
  enviado_em  timestamptz not null default now()
);

comment on table public.plantao_enviados is
  'Eventos já levados ao plantão por WhatsApp (0264). A chave primária é a trava contra repetição.';

-- Só o service role lê e escreve.
alter table public.plantao_enviados enable row level security;

-- ─── 3. O TEXTO DO AVISO, PARA QUEM NÃO É O SINO ─────────────────────────────
-- O plantão usava `payload.titulo ?? tipo`: os eventos que nascem em SQL sem
-- título (o aceite pendente) chegavam ao WhatsApp como "🔔 sdr.aceite_pendente".
-- Esta função devolve o texto pela MESMA régua de `notificacao__entregar` — o
-- modelo do painel, senão o texto do evento, senão "Empresa — nome do tipo" —,
-- para que o WhatsApp e o sino digam a mesma coisa.
create or replace function public.notificacao_texto(
  p_tipo text,
  p_empresa_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_catalogo public.notificacao_tipos;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_vars jsonb;
  v_empresa_nome text;
begin
  select * into v_catalogo from public.notificacao_tipos t where t.tipo = p_tipo;

  if p_empresa_id is not null then
    select coalesce(e.nome_fantasia, e.razao_social, e.cnpj) into v_empresa_nome
    from public.empresas e where e.id = p_empresa_id;
  end if;

  v_vars := v_payload || jsonb_build_object('empresa', coalesce(v_empresa_nome, ''));

  return jsonb_build_object(
    'titulo', coalesce(
      public.notificacao_renderizar(v_catalogo.titulo_modelo, v_vars),
      nullif(v_payload ->> 'titulo', ''),
      coalesce(v_empresa_nome, 'Empresa') || ' — ' || coalesce(v_catalogo.nome, p_tipo)
    ),
    'corpo', coalesce(
      public.notificacao_renderizar(v_catalogo.corpo_modelo, v_vars),
      nullif(v_payload ->> 'resumo', ''),
      nullif(v_payload ->> 'corpo', '')
    ),
    'url', coalesce(
      public.notificacao_renderizar(v_catalogo.url_modelo, v_vars),
      nullif(v_payload ->> 'url', ''),
      case when p_empresa_id is not null then '/empresas/' || p_empresa_id::text end
    )
  );
end $$;

revoke all on function public.notificacao_texto(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.notificacao_texto(text, uuid, jsonb) to service_role;
