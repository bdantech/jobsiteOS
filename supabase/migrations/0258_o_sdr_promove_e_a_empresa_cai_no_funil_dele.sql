-- ─────────────────────────────────────────────────────────────────────────────
-- 0258 — O SDR promove, e a empresa cai no funil dele
--
-- O perfil SDR tem `mercado` e `empresas`, e "Promover para Empresas" quebrava para
-- ele com `new row violates row-level security policy for table "empresas"`. Não
-- era o INSERT: era o RETURNING. A 0188 fez o SDR restrito enxergar só as empresas
-- do próprio funil e da própria carteira, e o `returning *` de uma empresa que
-- acabou de nascer passa pela política de LEITURA — a empresa nova não está em
-- nenhum dos dois, e a linha que ele mesmo criou era invisível para ele.
--
-- ─── POR QUE A EMPRESA ENTRA NO FUNIL, E NÃO SÓ PASSA A EXISTIR ─────────────
-- Promover sem mais nada criaria uma ficha que o SDR não consegue abrir, e ele
-- dependeria de um gestor para trabalhá-la. O SDR promove porque quer falar com a
-- empresa, e o lugar dele falar é o Funil de Reuniões. Então a promoção pelo SDR
-- restrito termina em `app_criar_lead_sdr` — a porta manual da 0146, com as MESMAS
-- regras: cliente e ex-cliente não entram, e lead vivo de outro SDR barra (o erro
-- diz por quê). A visibilidade vem de graça: empresa do funil é empresa que ele vê.
--
-- Quem não é SDR restrito (gestor, closer, originador) sai daqui exatamente como
-- entrava: a empresa não vai para funil nenhum.
--
-- ─── POR QUE SECURITY DEFINER, CONTRARIANDO A 0015 ──────────────────────────
-- A 0015 deixou a função INVOKER "para que a RLS decida o que o chamador toca".
-- Para o SDR a RLS decide errado por construção: ele só enxerga a empresa DEPOIS
-- que o lead existe, e o lead só pode existir depois da empresa. Não há ordem de
-- instruções que satisfaça isso por dentro da RLS.
--
-- As checagens que a RLS fazia viram explícitas, e são as mesmas:
--   mercado_universo_select ... `mercado` lê o universo inteiro
--   mercado_universo_vincular . `mercado` grava `empresa_id`
--   empresas_insert/update .... `empresas`
--   empresas_select ........... quem não é SDR restrito vê todas (0188)
-- Para todo mundo que não é SDR restrito o resultado é idêntico ao de antes.
--
-- O `anon` tinha EXECUTE (o default do Supabase, nunca revogado — com INVOKER era
-- inofensivo). Com DEFINER não é, e `create or replace` preserva grant (0138k):
-- o revoke abaixo é obrigatório, não higiene.
--
-- O service role passa sem módulo: `atualizar-sacados.ts` promove sacados pelo
-- worker, sem usuário, e é o mesmo critério da 0009.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.app_promover_empresa(p jsonb)
returns public.empresas
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_universo public.mercado_universo;
  v_empresa public.empresas;
  v_ator uuid := auth.uid();
  v_tipo text := coalesce(p ->> 'tipo', 'construtora');
  v_origem text := coalesce(p ->> 'origem', 'mercado');
  v_usuario boolean := coalesce(auth.role(), 'service_role') <> 'service_role';
  v_ja_existia boolean := false;
begin
  if v_usuario and not (public.app_tem_modulo('mercado') and public.app_tem_modulo('empresas')) then
    raise exception 'Sem acesso para promover empresas.' using errcode = '42501';
  end if;

  if v_tipo not in ('construtora', 'fornecedor') then
    raise exception 'Tipo invalido: %.', v_tipo using errcode = 'check_violation';
  end if;

  select * into v_universo from public.mercado_universo where cnpj = p ->> 'cnpj';

  if v_universo.cnpj is null then
    raise exception 'CNPJ não encontrado no universo.' using errcode = 'no_data_found';
  end if;

  if v_universo.empresa_id is not null then
    select * into v_empresa from public.empresas where id = v_universo.empresa_id;
    v_ja_existia := v_empresa.id is not null;
  end if;

  -- Já promovida: não há o que gravar, mas o SDR ainda precisa dela no funil.
  if not v_ja_existia then
    select * into v_empresa from public.empresas where cnpj = v_universo.cnpj;

    if v_empresa.id is null then
      insert into public.empresas (
        cnpj, razao_social, nome_fantasia, tipo, estagio,
        uf, municipio, cnae_principal, porte,
        camada, grupo_id, is_spe, grafo_sefaz, origem
      )
      values (
        v_universo.cnpj,
        v_universo.razao_social,
        v_universo.nome_fantasia,
        v_tipo,
        'mercado',
        v_universo.uf,
        v_universo.municipio,
        v_universo.cnae_principal,
        v_universo.porte_rfb,
        v_universo.camada,
        v_universo.grupo_id,
        v_universo.is_spe,
        v_universo.grafo_sefaz,
        v_origem
      )
      returning * into v_empresa;
    else
      update public.empresas set
        camada      = coalesce(camada, v_universo.camada),
        grupo_id    = coalesce(grupo_id, v_universo.grupo_id),
        is_spe      = is_spe or v_universo.is_spe,
        grafo_sefaz = grafo_sefaz or v_universo.grafo_sefaz,
        origem      = coalesce(origem, v_origem)
      where id = v_empresa.id
      returning * into v_empresa;
    end if;

    update public.mercado_universo
    set empresa_id = v_empresa.id
    where cnpj = v_universo.cnpj;

    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (
      v_empresa.id,
      'empresa.promovida',
      jsonb_build_object(
        'resumo', coalesce(v_empresa.razao_social, v_empresa.cnpj)
                  || ' foi promovida do universo (camada ' || coalesce(v_universo.camada, '—') || ').',
        'camada', v_universo.camada,
        'origem', v_origem
      ),
      v_ator
    );

    insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
    values (v_ator, 'empresa.promovida', 'empresas', v_empresa.id::text, p);
  end if;

  /*
   * O SDR restrito leva a empresa para o próprio funil. Lead vivo DELE já basta —
   * promover de novo o que já está na fila não é erro, é o clique repetido que a
   * idempotência da promoção sempre aceitou. Qualquer outra recusa de
   * `app_criar_lead_sdr` sobe inteira e desfaz a promoção: ele não pode ficar com
   * uma empresa que não enxerga.
   */
  if v_usuario and public.app_sdr_restrito() and not exists (
    select 1 from public.sdr_leads l
     where l.empresa_id = v_empresa.id
       and l.sdr_id = public.app_vendedor_atual()
       and l.encerrado_em is null
       and l.estagio <> 'qualificada'
  ) then
    perform public.app_criar_lead_sdr(jsonb_build_object('empresa_id', v_empresa.id));
  end if;

  return v_empresa;
end;
$function$;

revoke execute on function public.app_promover_empresa(jsonb) from public, anon;
grant execute on function public.app_promover_empresa(jsonb) to authenticated, service_role;
