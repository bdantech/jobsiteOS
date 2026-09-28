-- 0272 — As rotinas agendadas dizem se rodaram.
--
-- Em 28/09/2026 a distribuição semanal de SDR não aconteceu: o worker estava fora do
-- ar às 07:00, o cron da Vercel recebeu 502 e ninguém soube até o SDR reclamar. O
-- estado dos jobs avulsos vive na memória do worker, então worker caído não deixa
-- rastro nenhum no banco.
--
-- Daqui em diante toda chamada de /api/cron/* abre uma linha aqui ANTES de falar com
-- o worker (worker fora do ar vira `falhou`, não silêncio), o worker fecha a linha
-- quando o job termina, e o monitor — que roda na Vercel, não no worker — grava
-- `nao_executou` quando um horário da agenda passa sem linha nenhuma.

create table if not exists public.cron_execucoes (
  id             uuid primary key default gen_random_uuid(),
  -- Casa com o `path` de apps/web/vercel.json.
  path           text not null,
  status         text not null default 'executando'
                 check (status in ('executando', 'concluida', 'falhou', 'nao_executou', 'pulada')),
  iniciado_em    timestamptz not null default now(),
  terminado_em   timestamptz,
  -- Só em `nao_executou`: o horário que a agenda previa e que passou em branco.
  esperado_em    timestamptz,
  -- O worker assumiu o job e vai dizer como ele terminou. Sem isso, `concluida`
  -- quer dizer só "o disparo foi aceito".
  acompanhado    boolean not null default false,
  job_id         text,
  erro           text,
  -- O aviso de falha: nulo = pendente; `suprimido` = a mesma rotina já tinha avisado
  -- nas últimas seis horas. Só `enviado` conta para a janela — senão uma falha
  -- contínua se suprimiria para sempre.
  aviso          text check (aviso in ('enviado', 'suprimido')),
  notificado_em  timestamptz,
  check (status <> 'nao_executou' or esperado_em is not null)
);

comment on table public.cron_execucoes is
  'Uma linha por disparo de /api/cron/* (0272). Aberta pela rota na Vercel, fechada pelo worker, e `nao_executou` gravado pelo monitor.';

create index if not exists cron_execucoes_path_idx
  on public.cron_execucoes (path, iniciado_em desc);

-- O monitor roda a cada cinco minutos: a mesma falta não pode virar cinco linhas.
create unique index if not exists cron_execucoes_falta_uniq
  on public.cron_execucoes (path, esperado_em) where status = 'nao_executou';

create index if not exists cron_execucoes_a_avisar_idx
  on public.cron_execucoes (iniciado_em)
  where status in ('falhou', 'nao_executou') and aviso is null;

create index if not exists cron_execucoes_executando_idx
  on public.cron_execucoes (iniciado_em) where status = 'executando';

alter table public.cron_execucoes enable row level security;

-- Leitura só para admin; escrita só pelo service role (rota, worker e monitor).
drop policy if exists cron_execucoes_admin_le on public.cron_execucoes;
create policy cron_execucoes_admin_le on public.cron_execucoes
  for select to authenticated using (public.app_is_admin());

-- A última execução de cada rotina — o que a tela de Crons mostra — e o último disparo
-- REAL (sem as faltas que o monitor grava), que é o que o monitor compara com a agenda.
-- security_invoker: sem ela a view ignora a RLS da tabela e entrega a qualquer logado.
create or replace view public.cron_execucoes_ultimas
with (security_invoker = on) as
select distinct on (c.path)
  c.id, c.path, c.status, c.iniciado_em, c.terminado_em, c.esperado_em, c.acompanhado,
  c.job_id, c.erro,
  (select max(x.iniciado_em) from public.cron_execucoes x
    where x.path = c.path and x.status <> 'nao_executou') as ultimo_disparo_em
from public.cron_execucoes c
order by c.path, c.iniciado_em desc;

comment on view public.cron_execucoes_ultimas is
  'A execução mais recente de cada rotina agendada (0272).';

-- O aviso. Crítico: falha de rotina não espera o fim do horário de silêncio.
insert into public.notificacao_tipos (tipo, modulo, nome, descricao, gravidade) values
  ('plataforma.cron_falhou', 'plataforma', 'Rotina agendada falhou',
   'Uma rotina agendada falhou, não rodou no horário, ou ficou sem retorno do worker. A mesma rotina não repete o aviso por seis horas.',
   'critica')
on conflict (tipo) do nothing;

insert into public.notificacao_regras
  (tipo_evento, perfil_id, canais, dedup_horas, fallback_admin, respeita_silencio)
select 'plataforma.cron_falhou', pf.id, '{sino,push,email}'::text[], 0, false, false
from public.perfis pf
where pf.nome = 'Admin'
  and not exists (
    select 1 from public.notificacao_regras r
    where r.tipo_evento = 'plataforma.cron_falhou' and r.perfil_id = pf.id
  );
