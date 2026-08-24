-- ─── A janela estreita do comercial sobre o crédito ─────────────────────────
--
-- O funil de vendas precisa mostrar em que etapa a análise está, quanto foi aprovado, e
-- receber os documentos que o Crédito vai pedir de qualquer jeito. Nada disso era possível:
-- Closer, Comercial, SDR e Originador não têm o módulo `credito`, e todas as policies de
-- `analises_credito`, `analise_docs` e do bucket exigem exatamente esse módulo.
--
-- ── POR QUE NÃO DAR O MÓDULO ────────────────────────────────────────────────
-- Dar `credito` ao comercial resolveria em uma linha e abriria junto a esteira inteira, o
-- scorecard, os parâmetros e as configurações — inclusive o interruptor que aponta a
-- seguradora para produção. O acesso tem que seguir o NEGÓCIO que a pessoa toca, não o
-- módulo: quem é dono de uma venda vê a análise daquela venda, e mais nada.

create or replace function public.app_ve_analise_pela_venda(p_analise_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.vendas v
    where v.analise_credito_id = p_analise_id
      and public.app_pode_ver_vendedor(v.vendedor_id)
  );
$$;

comment on function public.app_ve_analise_pela_venda is
  'Verdadeiro quando a análise está ligada a uma venda que o usuário pode ver. SECURITY '
  'DEFINER porque é usada dentro de policy: ler `vendas` pela policy dela levaria a '
  'perfil_modulos e a recursão derrubaria a consulta.';

-- As policies existentes continuam de pé; estas são um caminho ADICIONAL. Duas policies
-- permissivas na mesma tabela se somam, então o Crédito não perde nada.
create policy analises_credito_select_pela_venda on public.analises_credito
  for select using (public.app_ve_analise_pela_venda(id));

create policy analise_docs_select_pela_venda on public.analise_docs
  for select using (public.app_ve_analise_pela_venda(analise_id));

-- ── Storage ─────────────────────────────────────────────────────────────────
-- O caminho do objeto começa pelo id da análise (`{analise_id}/{tipo}-...`), e é esse
-- primeiro segmento que amarra o arquivo ao registro. Ler e escrever seguem a mesma régua.
-- Não há DELETE: o comercial anexa e consulta, mas apagar prova documental é do Crédito.
create policy analise_docs_storage_select_venda on storage.objects
  for select to authenticated
  using (
    bucket_id = 'analise-docs'
    and public.app_ve_analise_pela_venda(nullif(split_part(name, '/', 1), '')::uuid)
  );

create policy analise_docs_storage_insert_venda on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'analise-docs'
    and public.app_ve_analise_pela_venda(nullif(split_part(name, '/', 1), '')::uuid)
  );

-- ── O registro do documento ─────────────────────────────────────────────────
-- `app_registrar_doc_analise` exigia o módulo. Agora aceita as duas portas: o módulo, ou
-- ser dono da venda ligada àquela análise.
create or replace function public.app_registrar_doc_analise(p jsonb)
returns public.analise_docs language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_analise public.analises_credito;
  v_doc public.analise_docs;
begin
  select * into v_analise from public.analises_credito where id = (p ->> 'analise_id')::uuid;
  if v_analise.id is null then
    raise exception 'Análise não encontrada.' using errcode = 'no_data_found';
  end if;

  if not (public.app_tem_modulo('credito') or public.app_ve_analise_pela_venda(v_analise.id)) then
    raise exception 'Sem acesso a esta análise.' using errcode = '42501';
  end if;

  insert into public.analise_docs (analise_id, tipo, arquivo_url, nome_arquivo, enviado_por)
  values (
    v_analise.id, p ->> 'tipo', p ->> 'arquivo_url', nullif(p ->> 'nome_arquivo', ''), v_ator
  )
  returning * into v_doc;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'analise.doc_enviado', 'analise_docs', v_doc.id::text, p);

  return v_doc;
end; $$;

-- ── O pedido de análise, a partir da venda ──────────────────────────────────
--
-- Reaproveita uma análise ABERTA do mesmo CNPJ quando existe: `app_solicitar_analise`
-- recusa a segunda em paralelo (e faz bem — duas viram duas submissões cobradas), mas do
-- ponto de vista do comercial isso apareceria como erro quando na verdade é o caso feliz.
-- Aqui a análise existente é ligada à venda, e ninguém precisa saber que ela já existia.
create or replace function public.app_solicitar_analise_da_venda(p jsonb)
returns public.analises_credito language plpgsql security definer set search_path = '' as $$
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
  if v_empresa.tipo not in ('construtora', 'incorporadora') then
    raise exception 'Análise de crédito é para sacados (construtora/incorporadora).'
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

    -- O evento só existe para análise NOVA. Ligar o negócio a uma análise que o Crédito
    -- já estava tocando não é um pedido novo, e notificar como se fosse treinaria o time
    -- a ignorar o aviso.
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
end; $$;

revoke execute on function public.app_solicitar_analise_da_venda(jsonb) from public;
grant execute on function public.app_solicitar_analise_da_venda(jsonb) to authenticated, service_role;

-- Quem tem o perfil Crédito recebe o pedido. Sem regra, o evento existiria no histórico da
-- empresa e não chegaria a ninguém — que é o mesmo que não existir.
insert into public.notificacao_regras (tipo_evento, perfil_id)
select 'credito.analise_solicitada', p.id from public.perfis p where p.nome = 'Crédito'
on conflict do nothing;
