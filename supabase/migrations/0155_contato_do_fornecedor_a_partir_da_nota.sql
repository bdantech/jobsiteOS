-- ═════════════════════════════════════════════════════════════════════════════
-- 0155 — O fornecedor que só existe como nota também precisa ter com quem falar
--
-- A aba "Mensagens" do card de NF é um beco sem saída para a maioria dos cards:
-- ela pede uma empresa, e 3.542 dos 3.705 fornecedores com nota viva não têm
-- ficha de empresa nenhuma. A tela diz "sem empresa não há contato, e sem contato
-- não há conversa" e para por aí — que é uma descrição correta do problema e
-- nenhuma solução para ele.
--
-- A maquinaria de resolver isso já existe inteira no funil de fornecedores (04l
-- §5): a cascata de descoberta, os contatos com fonte e evidência, e o
-- `app_promover_contato_descoberto`, que CRIA a ficha da empresa quando ela não
-- existe. O que faltava era o funil de NFs alcançá-la.
--
-- ═══ 1. A VISIBILIDADE PRECISAVA INCLUIR QUEM CHEGOU PELA NOTA ═══════════════
--
-- `app_fornecedor_visivel` exigia linha em `fornecedores_funil` com o originador
-- certo. Só que 3.474 dos 3.705 fornecedores com nota viva NÃO TÊM essa linha —
-- eles nunca entraram no funil de cadastro, entraram pela NF. Para eles a função
-- devolvia false para todo mundo que não fosse gestor, e a promoção de contato
-- era recusada justamente nos casos em que ela é mais necessária.
--
-- A ampliação é: também é visível o fornecedor que tem NOTA no funil de
-- antecipação, para quem tem esse módulo. Isso NÃO abre nada novo — a policy de
-- `notas_fiscais` já é `app_tem_modulo('antecipacao')` e nada mais, então quem
-- passa por aqui já lê o CNPJ, a razão social e todas as notas do fornecedor pela
-- tela do funil. O que passa a alcançar é o contato dele, que é exatamente a
-- função de trabalhar uma nota.
--
-- Deliberadamente NÃO se exige dono da nota: 7.640 das 8.038 notas vivas não têm
-- vendedor atribuído. Uma regra por dono deixaria 95% do funil de fora, e o funil
-- de NFs nunca foi recortado por carteira — a "fila sem dono" é a mesa de todos.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.app_fornecedor_visivel(p_cnpj text)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    public.app_gestor_comercial()
    or exists (
      select 1 from public.fornecedores_funil f
      where f.fornecedor_cnpj = p_cnpj
        and (
          f.originador_id = public.app_vendedor_atual()
          or f.originador_id in (
            select a.pode_ver_vendedor_id from public.vendedor_acessos a
            where a.vendedor_id = public.app_vendedor_atual()
          )
        )
    )
    -- Chegou pela NOTA. O módulo é a autorização, como já é para a nota em si.
    or (
      public.app_tem_modulo('antecipacao')
      and exists (
        select 1 from public.notas_fiscais nf where nf.fornecedor_cnpj = p_cnpj
      )
    );
$$;

comment on function public.app_fornecedor_visivel is
  'Este usuário enxerga o card deste fornecedor? Gestor sempre; originador quando o '
  'fornecedor está atribuído a ele (ou a alguém que ele pode ver); e quem tem o '
  'módulo Antecipação quando o fornecedor tem nota no funil — a policy de '
  'notas_fiscais já lhe dá a nota inteira, e trabalhar a nota é falar com ele.';

revoke execute on function public.app_fornecedor_visivel(text) from public, anon;
grant execute on function public.app_fornecedor_visivel(text) to authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- ═══ 2. O CONTATO ESCRITO À MÃO ══════════════════════════════════════════════
--
-- A descoberta acha o que está publicado. O originador que ligou para a obra e
-- anotou o celular do financeiro no papel sabe algo que nenhuma cascata acha — e
-- hoje não tem onde escrever, porque `criarContatoSchema` exige `empresa_id` de
-- uma empresa que ainda não existe.
--
-- ─── A BASE LEGAL É OBRIGATÓRIA AQUI ────────────────────────────────────────
-- `contatos.base_legal` é nullable, e o compositor recusa contato sem ela ("não é
-- possível abordá-lo"). Um contato criado sem base nasce mudo — cadastrado,
-- visível e incapaz de receber mensagem, que é o pior dos três estados porque
-- parece que funcionou. Aqui ela é exigida, e o default da tela é
-- `dado_publico_nfe`: o CNPJ e o nome vieram da NF-e, e é essa a base que
-- descreve a verdade de como chegamos nele.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.app_fornecedor_contato_manual(p jsonb)
returns public.contatos language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_cnpj text := regexp_replace(coalesce(p ->> 'fornecedor_cnpj', ''), '[^0-9]', '', 'g');
  v_base text := p ->> 'base_legal';
  v_focal boolean := coalesce((p ->> 'ponto_focal')::boolean, true);
  v_nome text := nullif(btrim(coalesce(p ->> 'nome', '')), '');
  v_email text := nullif(btrim(coalesce(p ->> 'email', '')), '');
  v_tel text := nullif(btrim(coalesce(p ->> 'telefone', '')), '');
  v_wpp text := nullif(btrim(coalesce(p ->> 'whatsapp', '')), '');
  v_empresa public.empresas;
  v_contato public.contatos;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;

  if length(v_cnpj) <> 14 then
    raise exception 'CNPJ do fornecedor inválido.' using errcode = '22023';
  end if;

  if not public.app_fornecedor_visivel(v_cnpj) then
    raise exception 'Este fornecedor não está na sua carteira.' using errcode = '42501';
  end if;

  -- Um contato sem canal nenhum não é contato: é uma linha que ocupa o seletor do
  -- compositor e não pode receber mensagem.
  if v_email is null and v_tel is null and v_wpp is null then
    raise exception 'Informe ao menos e-mail, telefone ou WhatsApp.' using errcode = '23514';
  end if;

  if v_base is null or v_base not in
     ('formulario_aceite', 'relacao_comercial', 'dado_publico_nfe', 'indicacao', 'manual') then
    raise exception 'Base legal inválida ou ausente.' using errcode = '23514';
  end if;

  -- Cria a ficha da empresa se ainda não existir — a MESMA função que a promoção
  -- do contato descoberto usa. Duas formas de criar a empresa a partir de um CNPJ
  -- de fornecedor seriam duas fichas para o mesmo CNPJ no dia em que divergirem.
  v_empresa := public.app__promover_fornecedor_para_empresa(v_cnpj, v_ator, 'comercial');

  insert into public.contatos
    (empresa_id, nome, cargo, email, telefone, whatsapp, origem, base_legal, base_legal_em, base_legal_detalhe)
  values (
    v_empresa.id,
    coalesce(v_nome, 'Contato do fornecedor'),
    nullif(btrim(coalesce(p ->> 'cargo', '')), ''),
    v_email,
    v_tel,
    -- Celular digitado no campo de telefone entra também como WhatsApp quando a
    -- pessoa marcou que é: obrigá-la a digitar o mesmo número duas vezes é o
    -- atrito que faz o formulário não ser usado.
    coalesce(v_wpp, case when coalesce((p ->> 'telefone_e_whatsapp')::boolean, false) then v_tel end),
    'manual:funil_nfs',
    v_base,
    now(),
    nullif(btrim(coalesce(p ->> 'base_legal_detalhe', '')), '')
  )
  returning * into v_contato;

  if v_focal then
    -- Um por empresa (índice único parcial de 0045). A troca na MESMA transação,
    -- porque dois UPDATEs separados deixam um instante com dois focais.
    update public.contatos set ponto_focal = false
      where empresa_id = v_empresa.id and ponto_focal and id <> v_contato.id;
    update public.contatos set ponto_focal = true where id = v_contato.id
      returning * into v_contato;
  end if;

  update public.fornecedores_funil
    set empresa_id = coalesce(empresa_id, v_empresa.id)
  where fornecedor_cnpj = v_cnpj;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa.id,
    case when v_focal then 'contato.ponto_focal_definido' else 'contatos.enriquecidos' end,
    jsonb_build_object(
      'resumo', coalesce(v_contato.nome, 'Contato') || ' cadastrado à mão a partir do funil de NFs.',
      'fonte', 'manual',
      'base_legal', v_base
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'fornecedores.contato_manual', 'contatos', v_contato.id::text, p);

  return v_contato;
end $$;

comment on function public.app_fornecedor_contato_manual is
  'Cadastra à mão um contato de fornecedor a partir do funil de NFs, criando a ficha '
  'da empresa se ela ainda não existir. Exige base legal: contato sem ela nasce mudo, '
  'porque o compositor o recusa.';

revoke execute on function public.app_fornecedor_contato_manual(jsonb) from public, anon;
grant execute on function public.app_fornecedor_contato_manual(jsonb) to authenticated, service_role;
