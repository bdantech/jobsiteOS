-- ─────────────────────────────────────────────────────────────────────────────
-- 0277 — O número que cai avisa
--
-- Em 02/10/2026 o WhatsApp do Rodrigo e o da Ana desconectaram do Wasender de
-- manhã, e ninguém soube até o volume do time despencar à tarde. Nada no sistema
-- olhava a sessão: o webhook simplesmente parou de chegar, e o envio pela API
-- seguiu "dando certo" — o Wasender responde 200 sem id com o número caído, e isso
-- era gravado como `enviada`. A Ana deu por feitos dois contatos que nunca saíram.
--
-- O código passa a perceber a queda por três caminhos (o envio sem id, o evento
-- `session.status` do webhook e uma consulta periódica ao `/api/status` de cada
-- número) e guarda o estado aqui. O aviso vai a quem responde pelo número e ao
-- Admin, por sino, push e e-mail.
--
-- Repetição: a chave é por conta, com janela de 4 h — enquanto o número segue
-- caído, quem precisa reconectar é lembrado, sem receber um aviso a cada consulta.
-- Silêncio respeitado: uma queda de madrugada entra no sino na hora, e o push e o
-- e-mail saem quando o silêncio acaba.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.whatsapp_contas
  add column if not exists sessao_status text,
  add column if not exists sessao_verificada_em timestamptz,
  add column if not exists sessao_caiu_em timestamptz;

comment on column public.whatsapp_contas.sessao_status is
  'Último estado da sessão no Wasender (connected, need_scan, logged_out…; envio_sem_id quando só o envio acusou). Nulo = nunca verificado.';
comment on column public.whatsapp_contas.sessao_caiu_em is
  'Desde quando o número está desconectado. Nulo enquanto conectado.';

insert into public.notificacao_tipos (tipo, modulo, nome, descricao, gravidade) values
  ('whatsapp.numero_desconectado', 'comunicacao', 'WhatsApp desconectado',
   'Um número de WhatsApp caiu no Wasender: nada entra nem sai por ele até alguém reconectar. Vai a quem responde pelo número e ao Admin; enquanto seguir caído, repete a cada quatro horas.',
   'normal')
on conflict (tipo) do nothing;

insert into public.notificacao_regras
  (tipo_evento, papel, canais, frequencia, dedup_horas, fallback_admin, respeita_silencio)
values
  ('whatsapp.numero_desconectado', 'dono_do_numero', '{sino,push,email}', 'imediato', 4, false, true)
on conflict do nothing;

insert into public.notificacao_regras
  (tipo_evento, perfil_id, canais, frequencia, dedup_horas, fallback_admin, respeita_silencio)
select 'whatsapp.numero_desconectado', pf.id, '{sino,push,email}'::text[], 'imediato', 4, false, true
from public.perfis pf
where pf.nome = 'Admin'
  and not exists (
    select 1 from public.notificacao_regras r
    where r.tipo_evento = 'whatsapp.numero_desconectado' and r.perfil_id = pf.id
  );
