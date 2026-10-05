-- ─────────────────────────────────────────────────────────────────────────────
-- 0286 — Conversa ignorada não é analisada
--
-- Ignorar um contato na fila de identificação ("não é cliente, não é lead") já tira a
-- conversa do Meu Dia (0278). A janela de conversa da 05C não sabia disso: o recorte do
-- dia pegava a conversa ignorada como qualquer outra, e ela viraria nota e pendência de
-- alguém. Em 05/10/2026 eram 10 das 1.294 conversas candidatas.
--
-- A regra é a mesma da 0278 — a identidade da conversa (número ou LID) foi ignorada —, e
-- vale também na hora de analisar (o worker confere de novo), porque a conversa pode ter
-- sido ignorada entre a janela fechar e a fila andar. Tirar do ignorado devolve a
-- conversa ao recorte da noite seguinte.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.app__conversa_ignorada(p_conversa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.conversas c
    join public.conversas_nao_vinculadas nvi
      on nvi.status = 'ignorada'
     and (nvi.identificador_externo = c.identificador_externo or (c.lid is not null and nvi.lid = c.lid))
    where c.id = p_conversa
  )
$$;

revoke all on function public.app__conversa_ignorada(uuid) from public, anon, authenticated;
grant execute on function public.app__conversa_ignorada(uuid) to service_role;

create or replace function public.app__qualidade_janelas_candidatas(p_horas int, p_limite int)
returns table (conversa_id uuid, ultima_janela_fim timestamptz, mensagens timestamptz[])
language sql stable security definer set search_path = '' as $$
  select c.id, lj.fim,
         array(select m.criado_em from public.comunicacoes m
                where m.conversa_id = c.id and m.canal in ('whatsapp', 'email')
                  and coalesce(m.corpo, m.assunto, '') <> ''
                  and m.criado_em > coalesce(lj.fim, now() - interval '30 days')
                order by m.criado_em)
  from public.conversas c
  left join lateral (select max(f.janela_fim) as fim from public.analise_fila f
                      where f.conversa_id = c.id and f.escopo = 'janela_conversa') lj on true
  where c.ultima_mensagem_em < now() - make_interval(hours => p_horas)
    and c.ultima_mensagem_em > now() - interval '30 days'
    and (lj.fim is null or c.ultima_mensagem_em > lj.fim)
    /* Contato ignorado na fila de identificação não é conversa de trabalho (0278). */
    and not exists (
      select 1 from public.conversas_nao_vinculadas nvi
      where nvi.status = 'ignorada'
        and (nvi.identificador_externo = c.identificador_externo
             or (c.lid is not null and nvi.lid = c.lid))
    )
  order by c.ultima_mensagem_em desc
  limit p_limite
$$;
