-- ─────────────────────────────────────────────────────────────────────────────
-- 0281 — O fornecedor também pede limite
--
-- Desde a 0073 a análise de crédito recusava qualquer empresa que não fosse
-- construtora ou incorporadora: "limite" era pergunta de sacado. Só que às vezes é
-- o FORNECEDOR que quer limite de risco sacado — ele vai aparecer do outro lado de
-- uma operação, como devedor — e o funil de vendas devolvia "Análise de crédito é
-- para sacados" sem caminho nenhum.
--
-- O fornecedor entra na lista. A análise dele é a de um sacado como outro qualquer:
-- mesma esteira, mesmo envio à seguradora (o CNPJ dele é o buyer, que é exatamente
-- o que se quer saber). O que ele não tem é `limite_potencial` — o worker só calcula
-- para construtora/incorporadora —, então o limite pedido fica nulo até alguém
-- preenchê-lo, como já acontecia com sacado sem potencial calculado.
--
-- Subempreiteiro continua de fora: ninguém pediu, e a regra só abre o que tem uso.
--
-- Os dois portões mudam juntos — o do funil de vendas (`app_solicitar_analise_da_venda`)
-- e o compartilhado da ficha, do Crédito e da prospecção (`app__abrir_analise_credito`).
-- Abrir só um faria o mesmo fornecedor passar por uma porta e ser barrado na outra.
-- O resto de cada corpo é o vigente, sem mudança.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.app_solicitar_analise_da_venda(p jsonb)
returns public.analises_credito
language plpgsql security definer set search_path to '' as $function$
declare
  v_ator uuid := auth.uid();
  v_venda public.vendas;
  v_empresa public.empresas;
  v_linha public.analises_credito;
  v_limite numeric := nullif(p ->> 'limite_solicitado', '')::numeric;
begin
  select * into v_venda from public.vendas where id = (p ->> 'venda_id')::uuid;
  if v_venda.id is null then
    raise exception 'Negócio não encontrado.' using errcode = 'no_data_found';
  end if;
  if not public.app_pode_ver_vendedor(v_venda.vendedor_id) then
    raise exception 'Este negócio não é seu.' using errcode = '42501';
  end if;

  select * into v_empresa from public.empresas where id = v_venda.empresa_id;
  if v_empresa.tipo not in ('construtora', 'incorporadora', 'fornecedor') then
    raise exception 'Análise de crédito é para construtora, incorporadora ou fornecedor.'
      using errcode = '22023';
  end if;

  if v_venda.analise_credito_id is not null then
    select * into v_linha from public.analises_credito where id = v_venda.analise_credito_id;
    if v_linha.id is not null then
      return v_linha;
    end if;
  end if;

  select * into v_linha
  from public.analises_credito a
  where a.cnpj = v_empresa.cnpj
    and a.estagio in ('rascunho', 'solicitada', 'docs_pendentes', 'enviada_seguradora', 'em_analise')
  order by a.criada_em desc
  limit 1;

  if v_linha.id is null then
    insert into public.analises_credito (
      empresa_id, cnpj, estagio, limite_solicitado, solicitada_por, origem
    )
    values (
      v_empresa.id, v_empresa.cnpj, 'docs_pendentes',
      coalesce(v_limite, v_empresa.limite_potencial), v_ator, 'jobsiteos'
    )
    returning * into v_linha;

    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (
      v_empresa.id,
      'credito.analise_solicitada',
      jsonb_build_object(
        'titulo', 'Análise pedida pelo comercial',
        'resumo', coalesce(v_empresa.razao_social, v_empresa.cnpj) ||
                  ' — o comercial pediu análise de crédito e está juntando os documentos.',
        'url', '/credito/analises/' || v_linha.id::text,
        'analise_id', v_linha.id,
        'venda_id', v_venda.id
      ),
      v_ator
    );
  end if;

  update public.vendas
     set analise_credito_id = v_linha.id, atualizada_em = now()
   where id = v_venda.id;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'credito.analise_pedida_pela_venda', 'vendas', v_venda.id::text, p);

  return v_linha;
end; $function$;

create or replace function public.app__abrir_analise_credito(
  p_empresa_id uuid, p_limite numeric, p_observacoes text, p_origem_motivo text,
  p_ator uuid, p_mesmo_com_aberta boolean default false
)
returns public.analises_credito
language plpgsql security definer set search_path to '' as $function$
declare
  v_empresa public.empresas;
  v_linha public.analises_credito;
begin
  select * into v_empresa from public.empresas where id = p_empresa_id;
  if v_empresa.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;

  if v_empresa.tipo not in ('construtora', 'incorporadora', 'fornecedor') then
    raise exception 'Análise de crédito é para construtora, incorporadora ou fornecedor.'
      using errcode = '22023';
  end if;

  if not p_mesmo_com_aberta and exists (
    select 1 from public.analises_credito a
    where a.cnpj = v_empresa.cnpj
      and a.estagio in ('rascunho', 'solicitada', 'docs_pendentes', 'docs_recebidos',
                        'enviada_seguradora', 'em_analise')
  ) then
    raise exception 'Já existe uma análise em andamento para este CNPJ.' using errcode = '23505';
  end if;

  insert into public.analises_credito (
    empresa_id, cnpj, estagio, limite_solicitado, observacoes, solicitada_por, origem_motivo
  )
  values (
    v_empresa.id, v_empresa.cnpj, 'solicitada',
    coalesce(p_limite, public.app_arredondar_limite_sugerido(v_empresa.limite_potencial)),
    nullif(p_observacoes, ''), p_ator, nullif(p_origem_motivo, '')
  )
  returning * into v_linha;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa.id, 'analise.solicitada',
    jsonb_build_object(
      'titulo', 'Análise de crédito solicitada',
      'resumo', 'Limite solicitado: R$ ' ||
                to_char(coalesce(v_linha.limite_solicitado, 0), 'FM999G999G999G990D00') || '.',
      'url', '/credito/analises/' || v_linha.id,
      'analise_id', v_linha.id,
      'origem_motivo', v_linha.origem_motivo
    ),
    p_ator
  );

  return v_linha;
end $function$;
