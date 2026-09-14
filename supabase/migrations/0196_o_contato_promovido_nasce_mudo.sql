-- ═════════════════════════════════════════════════════════════════════════════
-- 0196 — O contato promovido nascia mudo
--
-- Promover um contato descoberto (a estrela na aba Fornecedor do card de NF, e a
-- mesma estrela na ficha do funil de fornecedores) criava a linha em `contatos`
-- SEM `base_legal`. A 0155 já tinha escrito o diagnóstico para o contato manual:
-- "um contato criado sem base nasce mudo — cadastrado, visível e incapaz de
-- receber mensagem, que é o pior dos três estados porque parece que funcionou".
-- A promoção continuou fazendo exatamente isso, e os 10 contatos que existem hoje
-- por esse caminho estão todos com base nula — o compositor recusa cada um com
-- "Contato sem base legal — não é possível abordá-lo."
--
-- É o outro lado do beco da aba "Mensagens": o originador vê três contatos
-- descobertos na aba ao lado, promove um, a aba destrava… e o compositor recusa a
-- pessoa que ele acabou de promover.
--
-- ─── A DERIVAÇÃO É A DA CASA, NÃO UMA NOVA ──────────────────────────────────
--
-- A 0144 já derivou base legal da ORIGEM para a tabela inteira: o que veio do XML
-- da NF-e (e do sacado) é `dado_publico_nfe`; o resto, quando a origem é
-- conhecida, é `manual`. A promoção usa a MESMA regra, com a fonte da descoberta
-- no lugar da origem — duas derivações para a mesma pergunta acabariam divergindo,
-- e a base legal é o que se defende depois.
--
-- `manual` aqui não é carimbo de conveniência: a promoção É o ato de uma pessoa
-- que olhou a fonte e a evidência na tela e decidiu adotar aquele número. O que
-- garante a auditoria é o `base_legal_detalhe`, que passa a guardar a fonte e a
-- evidência da descoberta — de onde o número veio fica escrito na linha, não só no
-- log.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.app_promover_contato_descoberto(p jsonb)
returns public.contatos language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_id uuid := (p ->> 'contato_descoberto_id')::uuid;
  v_focal boolean := coalesce((p ->> 'ponto_focal')::boolean, true);
  v_desc public.contatos_descobertos;
  v_empresa public.empresas;
  v_contato public.contatos;
  v_base text;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;

  select * into v_desc from public.contatos_descobertos where id = v_id;
  if v_desc.id is null then
    raise exception 'Contato descoberto não encontrado.' using errcode = 'no_data_found';
  end if;
  if not public.app_fornecedor_visivel(v_desc.fornecedor_cnpj) then
    raise exception 'Este fornecedor não está na sua carteira.' using errcode = '42501';
  end if;

  -- Site e Instagram não são pessoa: não há o que virar ponto focal.
  if v_desc.tipo not in ('telefone', 'email', 'whatsapp') then
    raise exception 'Só telefone, e-mail ou WhatsApp viram contato oficial.' using errcode = '23514';
  end if;

  -- A mesma regra da 0144, com a fonte da descoberta no lugar da origem.
  v_base := case
    when v_desc.fonte in ('xml_nfe', 'sacado') then 'dado_publico_nfe'
    else 'manual'
  end;

  -- Já promovido: devolve o mesmo contato. Dois cliques não criam duas fichas.
  if v_desc.promovido_contato_id is not null then
    select * into v_contato from public.contatos where id = v_desc.promovido_contato_id;
    if v_contato.id is not null then
      -- Uma linha promovida ANTES desta migração está muda. O segundo clique na
      -- estrela é a chance de destravá-la, e ele não pode passar batido.
      if v_contato.base_legal is null then
        update public.contatos set
          base_legal = v_base,
          base_legal_em = now(),
          base_legal_detalhe = coalesce(base_legal_detalhe,
            'Descoberta ' || v_desc.fonte || coalesce(' — ' || v_desc.evidencia, ''))
        where id = v_contato.id
        returning * into v_contato;
      end if;
      if v_focal and not v_contato.ponto_focal then
        update public.contatos set ponto_focal = false
          where empresa_id = v_contato.empresa_id and ponto_focal and id <> v_contato.id;
        update public.contatos set ponto_focal = true where id = v_contato.id
          returning * into v_contato;
      end if;
      return v_contato;
    end if;
  end if;

  -- A ficha da empresa é criada aqui se ainda não existir. Exigir que alguém a crie
  -- antes transformaria o "um clique" do §5 num formulário.
  v_empresa := public.app__promover_fornecedor_para_empresa(v_desc.fornecedor_cnpj, v_ator, 'comercial');

  insert into public.contatos (
    empresa_id, nome, cargo, email, telefone, whatsapp, origem,
    base_legal, base_legal_em, base_legal_detalhe
  )
  values (
    v_empresa.id,
    coalesce(v_desc.nome_pessoa, 'Contato ' || v_desc.tipo),
    v_desc.cargo,
    case when v_desc.tipo = 'email'    then v_desc.valor end,
    case when v_desc.tipo = 'telefone' then v_desc.valor end,
    case when v_desc.tipo = 'whatsapp' then v_desc.valor
         -- Celular achado pela cascata entra também como WhatsApp: é o canal que o
         -- originador de fato usa no celular, e obrigá-lo a copiar o número de um
         -- campo para o outro é o tipo de atrito que faz o botão não ser usado.
         when v_desc.tipo = 'telefone' and (v_desc.validado ->> 'tem_whatsapp')::boolean then v_desc.valor
    end,
    'descoberta:' || v_desc.fonte,
    v_base,
    now(),
    'Descoberta ' || v_desc.fonte || coalesce(' — ' || v_desc.evidencia, '')
  )
  returning * into v_contato;

  if v_focal then
    -- Um por empresa (índice único parcial de 0045). A troca é feita aqui, na mesma
    -- transação, porque duas UPDATEs separadas deixam um instante com dois focais.
    update public.contatos set ponto_focal = false
      where empresa_id = v_empresa.id and ponto_focal and id <> v_contato.id;
    update public.contatos set ponto_focal = true where id = v_contato.id
      returning * into v_contato;
  end if;

  update public.contatos_descobertos
    set promovido_contato_id = v_contato.id
  where id = v_desc.id;

  update public.fornecedores_funil
    set empresa_id = coalesce(empresa_id, v_empresa.id)
  where fornecedor_cnpj = v_desc.fornecedor_cnpj;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa.id,
    case when v_focal then 'contato.ponto_focal_definido' else 'contatos.enriquecidos' end,
    jsonb_build_object(
      'resumo', coalesce(v_contato.nome, 'Contato') || ' promovido a partir da descoberta ('
                || v_desc.fonte || ', confiança ' || v_desc.confianca || ').',
      'fonte', v_desc.fonte,
      'confianca', v_desc.confianca,
      'base_legal', v_base,
      'evidencia', v_desc.evidencia
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'fornecedores.promover_contato', 'contatos', v_contato.id::text, p);

  return v_contato;
end $$;

comment on function public.app_promover_contato_descoberto is
  'Promove um contato descoberto a contato oficial, criando a ficha da empresa se '
  'preciso. A base legal é derivada da FONTE da descoberta (a regra da 0144) e nunca '
  'fica nula: contato sem base legal é recusado pelo compositor e nasce mudo.';

-- ─── Os que já nasceram mudos ───────────────────────────────────────────────
/*
 * Dez linhas hoje, todas promovidas antes desta migração e todas incapazes de
 * receber mensagem. A derivação é a mesma da função, lida da descoberta que as
 * originou — e não do `origem` da linha, que é onde a informação chegou truncada.
 */
update public.contatos c set
  base_legal = case
    when d.fonte in ('xml_nfe', 'sacado') then 'dado_publico_nfe'
    else 'manual'
  end,
  base_legal_em = now(),
  base_legal_detalhe = coalesce(c.base_legal_detalhe,
    'Descoberta ' || d.fonte || coalesce(' — ' || d.evidencia, ''))
from public.contatos_descobertos d
where d.promovido_contato_id = c.id
  and c.base_legal is null;
