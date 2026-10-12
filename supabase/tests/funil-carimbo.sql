/*
 * O carimbo de entrada do funil (0296) — o que o gatilho promete, conferido no banco.
 *
 * Roda inteiro numa transação e termina em ROLLBACK: nada do que ele grava fica.
 *   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/funil-carimbo.sql
 *
 * Qualquer promessa quebrada levanta exceção com o nome do caso. Silêncio é passar.
 *
 * Os casos são os três do 04t §2.2 e os três da reentrada:
 *   (b) o upsert do sync não reescreve o carimbo, nem com outro valor nem com NULL;
 *   (a) mudança de estágio não é novidade;
 *   (c) troca de titular e sacado aprovado SÃO novidade — com as duas guardas da 0296.
 */
begin;

do $$
declare
  k text;       -- nota velha, em estágio aberto, com dono
  k2 text;      -- cópia recém-nascida da mesma nota, sem dono
  v_dono uuid;
  v_outro uuid;
  antes timestamptz;
  r record;
begin
  select nf.access_key, nf.vendedor_id, nf.entrou_funil_em into k, v_dono, antes
    from public.notas_fiscais nf
   where nf.estagio_funil = 'a_prospectar' and nf.vendedor_id is not null
     and nf.entrou_funil_em < now() - interval '2 days' and nf.reentrou_funil_em is null
     and nf.situacao = 'valida' and nf.operavel and nf.operavel_manual is null
     and nf.credit_status is distinct from 'APPROVED' and nf.sacado_cnpj is not null
   limit 1;
  if k is null then raise exception 'sem nota para o teste'; end if;
  select v.id into v_outro from public.vendedores v where v.id <> v_dono limit 1;

  -- (b) O sync roda duas vezes com o mesmo payload: o carimbo não anda.
  for i in 1..2 loop
    insert into public.notas_fiscais
    select * from public.notas_fiscais where access_key = k
    on conflict (access_key) do update
      set sincronizada_em = clock_timestamp(), entrou_funil_em = clock_timestamp();
  end loop;
  select * into r from public.notas_fiscais where access_key = k;
  if r.entrou_funil_em <> antes then raise exception '(b) o upsert reescreveu entrou_funil_em'; end if;
  if r.reentrou_funil_em is not null then raise exception '(b) o upsert carimbou reentrada'; end if;

  -- (b) Lote de formato misturado: a chave que falta chega como NULL.
  update public.notas_fiscais
     set entrou_funil_em = null, reentrou_funil_em = clock_timestamp(), reentrou_funil_motivo = 'carteira'
   where access_key = k;
  select * into r from public.notas_fiscais where access_key = k;
  if r.entrou_funil_em <> antes then raise exception '(b) NULL apagou entrou_funil_em'; end if;
  if r.reentrou_funil_em is not null then raise exception '(b) o escritor conseguiu gravar a reentrada'; end if;

  -- (a) Mudança de estágio é trabalho, não chegada.
  update public.notas_fiscais
     set estagio_funil = 'em_prospeccao', estagio_alterado_em = clock_timestamp()
   where access_key = k;
  select * into r from public.notas_fiscais where access_key = k;
  if r.reentrou_funil_em is not null then raise exception '(a) mudança de estágio carimbou reentrada'; end if;

  -- (c) Sacado aprovado, sem aprovação anterior registrada: é novidade.
  delete from public.credito_snapshots where cnpj = r.sacado_cnpj;
  update public.notas_fiscais set credit_status = 'APPROVED' where access_key = k;
  select * into r from public.notas_fiscais where access_key = k;
  if r.reentrou_funil_motivo is distinct from 'sacado_aprovado' then
    raise exception '(c) sacado aprovado não carimbou';
  end if;

  -- (c) …mas a virada de quem já estava aprovado ontem é oscilação da origem.
  update public.notas_fiscais set credit_status = null where access_key = k;
  alter table public.notas_fiscais disable trigger notas_fiscais_carimbo_funil;
  update public.notas_fiscais set reentrou_funil_em = null, reentrou_funil_motivo = null where access_key = k;
  alter table public.notas_fiscais enable trigger notas_fiscais_carimbo_funil;
  insert into public.credito_snapshots (cnpj, status, capturado_em)
  values (r.sacado_cnpj, 'APPROVED', now() - interval '3 days');
  update public.notas_fiscais set credit_status = 'APPROVED' where access_key = k;
  select * into r from public.notas_fiscais where access_key = k;
  if r.reentrou_funil_em is not null then raise exception '(c) oscilação de crédito carimbou reentrada'; end if;

  -- (c) Troca de titular: é novidade para o novo dono.
  update public.notas_fiscais set vendedor_id = v_outro where access_key = k;
  select * into r from public.notas_fiscais where access_key = k;
  if r.reentrou_funil_motivo is distinct from 'carteira' or r.reentrou_funil_em is null then
    raise exception '(c) troca de titular não carimbou';
  end if;
  if r.entrou_funil_em <> antes then raise exception '(c) a reentrada mexeu em entrou_funil_em'; end if;

  -- (c) Nota que deixa de ser não operável.
  alter table public.notas_fiscais disable trigger notas_fiscais_carimbo_funil;
  update public.notas_fiscais
     set reentrou_funil_em = null, reentrou_funil_motivo = null, operavel = false
   where access_key = k;
  alter table public.notas_fiscais enable trigger notas_fiscais_carimbo_funil;
  update public.notas_fiscais set operavel = true where access_key = k;
  select * into r from public.notas_fiscais where access_key = k;
  if r.reentrou_funil_motivo is distinct from 'operavel' then raise exception '(c) nota que virou operável não carimbou'; end if;

  -- Nascimento: o carimbo é do banco mesmo quando o escritor manda NULL…
  k2 := 'TESTE0296' || substr(k, 10);
  insert into public.notas_fiscais
  select (jsonb_populate_record(null::public.notas_fiscais,
            to_jsonb(n) || jsonb_build_object('access_key', k2, 'nf_id_externo', null, 'vendedor_id', null,
                                              'entrou_funil_em', null, 'reentrou_funil_em', null,
                                              'reentrou_funil_motivo', null))).*
    from public.notas_fiscais n where n.access_key = k;
  select * into r from public.notas_fiscais where access_key = k2;
  if r.entrou_funil_em is null then raise exception 'nota nova nasceu sem entrou_funil_em'; end if;

  -- …e o roteamento logo atrás do sync é parte da chegada, não uma volta ao funil.
  update public.notas_fiscais set vendedor_id = v_dono where access_key = k2;
  select * into r from public.notas_fiscais where access_key = k2;
  if r.reentrou_funil_em is not null then raise exception 'a primeira atribuição da nota nova carimbou reentrada'; end if;

  -- Item encerrado não volta a ser novidade por trocar de dono.
  update public.notas_fiscais set estagio_funil = 'perdida', perda_motivo = 'teste' where access_key = k2;
  update public.notas_fiscais set vendedor_id = v_outro where access_key = k2;
  select * into r from public.notas_fiscais where access_key = k2;
  if r.reentrou_funil_em is not null then raise exception 'nota encerrada carimbou reentrada'; end if;

  -- As outras duas fontes usam o mesmo gatilho: basta provar que ele está ligado.
  select st.id_externo::text, st.entrou_funil_em into k, antes from public.sienge_titulos st limit 1;
  update public.sienge_titulos set entrou_funil_em = clock_timestamp() where id_externo = k::integer;
  if (select entrou_funil_em from public.sienge_titulos where id_externo = k::integer) <> antes then
    raise exception 'título: o carimbo foi reescrito';
  end if;
  select pa.id_externo::text, pa.entrou_funil_em into k, antes from public.pre_autorizacoes pa limit 1;
  update public.pre_autorizacoes set entrou_funil_em = clock_timestamp() where id_externo = k::integer;
  if (select entrou_funil_em from public.pre_autorizacoes where id_externo = k::integer) <> antes then
    raise exception 'pré-autorização: o carimbo foi reescrito';
  end if;

  raise notice 'carimbo do funil: todos os casos passaram';
end;
$$;

rollback;
