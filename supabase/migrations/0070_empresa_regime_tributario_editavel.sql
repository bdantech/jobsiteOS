-- 0070 — `regime_tributario` editável na ficha da empresa.
--
-- `app_atualizar_empresa` faz whitelist de colunas: o que não está no UPDATE não é
-- gravado, e o zod descarta chave desconhecida em silêncio. Sem esta migration o
-- campo apareceria no formulário, o usuário salvaria, a tela diria "salvo" e o valor
-- sumiria a caminho do banco — o mesmo modo de falhar que a 0058 documentou para
-- `tipo`.
--
-- Diferente das outras colunas do UPDATE, esta usa `p ? chave` em vez de `coalesce`:
-- regime é um campo que precisa poder ser LIMPO. Com coalesce, string vazia viraria
-- "manter o que estava" e não haveria como desfazer uma classificação errada.

create or replace function public.app_atualizar_empresa(p jsonb)
returns public.empresas language plpgsql set search_path = '' as $$
declare
  v_antes public.empresas;
  v_depois public.empresas;
  v_ator uuid := auth.uid();
begin
  select * into v_antes from public.empresas where id = (p ->> 'id')::uuid;

  if v_antes.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;

  update public.empresas set
    razao_social    = coalesce(p ->> 'razao_social',    razao_social),
    nome_fantasia   = coalesce(p ->> 'nome_fantasia',   nome_fantasia),
    tipo            = coalesce(p ->> 'tipo',            tipo),
    estagio         = coalesce(p ->> 'estagio',         estagio),
    uf              = coalesce(p ->> 'uf',              uf),
    municipio       = coalesce(p ->> 'municipio',       municipio),
    cnae_principal  = coalesce(p ->> 'cnae_principal',  cnae_principal),
    porte           = coalesce(p ->> 'porte',           porte),
    erp_atual       = coalesce(p ->> 'erp_atual',       erp_atual),
    erp_mrr         = coalesce((p ->> 'erp_mrr')::numeric, erp_mrr),
    erp_canal_venda = coalesce(p ->> 'erp_canal_venda', erp_canal_venda),
    dominio         = coalesce(p ->> 'dominio', dominio),
    regime_tributario = case
                        when p ? 'regime_tributario'
                        then nullif(p ->> 'regime_tributario', '')
                        else regime_tributario end,
    -- Procedência/carimbo só mudam quando o domínio realmente muda por edição manual.
    dominio_origem  = case
                        when p ? 'dominio' and (p ->> 'dominio') is distinct from dominio
                        then 'manual' else dominio_origem end,
    dominio_validado_em = case
                        when p ? 'dominio' and (p ->> 'dominio') is distinct from dominio
                        then now() else dominio_validado_em end
  where id = v_antes.id
  returning * into v_depois;

  if v_depois.id is null then
    raise exception 'Sem permissão para alterar esta empresa.' using errcode = '42501';
  end if;

  if v_depois.estagio is distinct from v_antes.estagio then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (
      v_depois.id,
      'estagio.alterado',
      jsonb_build_object(
        'resumo', 'Estágio: ' || v_antes.estagio || ' → ' || v_depois.estagio,
        'de', v_antes.estagio,
        'para', v_depois.estagio
      ),
      v_ator
    );
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'empresa.atualizada', 'empresas', v_depois.id::text, p);

  return v_depois;
end;
$$;
