-- 0068 — Quem tem Antecipação promove o FORNECEDOR das suas notas, e só ele.
--
-- Terceiro achado da mesma família (0060, 0066): a tela existe, o botão existe, e o
-- único time que os usa não consegue clicar. Promover um fornecedor a partir do funil
-- esbarrava em TRÊS portas, todas de módulos que o Comercial não tem:
--
--   1. `promoverEmpresaAction` autoriza por `/mercado`;
--   2. `empresas_insert` exige `app_tem_modulo('empresas')`;
--   3. `mercado_universo_vincular` (UPDATE) exige `app_tem_modulo('mercado')`.
--
-- E `app_promover_empresa` é SECURITY INVOKER, então nenhuma delas é contornável do
-- lado da aplicação. Hoje ninguém foi atingido porque só existe o usuário Admin —
-- sorte de cronograma, como na 0060, não desenho.
--
-- Isso passou a bloquear um fluxo real: contato de fornecedor exige empresa
-- (`contatos.empresa_id` é NOT NULL), e a decisão desta rodada é que a promoção
-- acontece COMO CONSEQUÊNCIA de cadastrar o contato. Sem esta função, esse cadastro
-- simplesmente falha para o público da tela.
--
-- O RECORTE, que é o que justifica o DEFINER:
--
--   - só CNPJ que aparece como FORNECEDOR em `notas_fiscais` — o mesmo princípio da
--     0060: você promove quem você já podia ler;
--   - `tipo` é sempre `'fornecedor'`, nunca vem do cliente. É o que impede que este
--     caminho envenene a pirâmide comercial, os segmentos e o TAM, que leem essa
--     coluna (o mesmo cuidado que a 0058 documentou);
--   - `origem` é sempre `'antecipacao'`, então dá para auditar de onde veio.
--
-- Não é acesso a `empresas` nem ao universo. É "promover um fornecedor meu".

create or replace function public.app_promover_fornecedor(p jsonb)
returns public.empresas language plpgsql security definer set search_path = '' as $$
declare
  v_cnpj text := p ->> 'cnpj';
  v_universo public.mercado_universo;
  v_empresa public.empresas;
  v_ator uuid := auth.uid();
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;
  if v_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;

  -- O recorte. Sem notas deste fornecedor, este caminho não promove nada — quem
  -- quiser promover outro CNPJ usa o de Mercado, com o módulo de Mercado.
  if not exists (select 1 from public.notas_fiscais nf where nf.fornecedor_cnpj = v_cnpj) then
    raise exception 'Este CNPJ não é fornecedor de nenhuma nota.' using errcode = 'no_data_found';
  end if;

  select * into v_universo from public.mercado_universo where cnpj = v_cnpj;
  if v_universo.cnpj is null then
    -- O lookup cadastral ainda não respondeu. A mensagem diz isso em vez de "não
    -- encontrado": a fila resolve sozinha, e o usuário só precisa esperar.
    raise exception 'Cadastro deste CNPJ ainda não foi enriquecido. Ele está na fila de lookup.'
      using errcode = 'no_data_found';
  end if;

  -- Idempotente como o `app_promover_empresa`: promover de novo devolve o que existe,
  -- em vez de estourar. É o que permite dois cliques sem consequência.
  if v_universo.empresa_id is not null then
    select * into v_empresa from public.empresas where id = v_universo.empresa_id;
    if v_empresa.id is not null then return v_empresa; end if;
  end if;

  select * into v_empresa from public.empresas where cnpj = v_cnpj;

  if v_empresa.id is null then
    insert into public.empresas (
      cnpj, razao_social, nome_fantasia, tipo, estagio,
      uf, municipio, cnae_principal, porte,
      camada, grupo_id, is_spe, grafo_sefaz, origem
    )
    values (
      v_universo.cnpj, v_universo.razao_social, v_universo.nome_fantasia,
      'fornecedor', 'mercado',
      v_universo.uf, v_universo.municipio, v_universo.cnae_principal, v_universo.porte_rfb,
      v_universo.camada, v_universo.grupo_id, v_universo.is_spe, v_universo.grafo_sefaz,
      'antecipacao'
    )
    returning * into v_empresa;
  end if;

  update public.mercado_universo set empresa_id = v_empresa.id where cnpj = v_cnpj;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa.id, 'empresa.promovida',
    jsonb_build_object(
      'resumo', coalesce(v_empresa.razao_social, v_empresa.cnpj)
                || ' foi promovida a partir do funil de Antecipação.',
      'camada', v_universo.camada,
      'origem', 'antecipacao'
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'antecipacao.fornecedor_promovido', 'empresas', v_empresa.id::text, p);

  return v_empresa;
end; $$;

revoke execute on function public.app_promover_fornecedor(jsonb) from public;
grant execute on function public.app_promover_fornecedor(jsonb) to authenticated, service_role;

comment on function public.app_promover_fornecedor is
  'Promove para `empresas` um CNPJ que é FORNECEDOR de alguma nota fiscal, sempre com '
  'tipo=fornecedor e origem=antecipacao. DEFINER porque o insert em empresas exige o '
  'módulo Empresas e o vínculo no universo exige Mercado — nenhum dos dois é do '
  'público do funil. Idempotente.';
