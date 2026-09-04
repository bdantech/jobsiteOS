-- ============================================================================
-- 0174 — O toque manual gravava o número do DESTINATÁRIO como nossa conta
--
-- `conta_remetente` significa "a nossa conta por onde isto passou" — é a coluna
-- que hoje decide de quem é a mensagem, de quem é a conversa, quanto cada número
-- já mandou hoje e qual número está mais carregado. `app__registrar_toque`
-- gravava ali o `p_contato`: o telefone de quem RECEBEU a ligação.
--
-- Passou despercebido porque o toque não é enviado por ninguém — a pessoa clica
-- em `tel:`/`wa.me` e fala pelo próprio aparelho —, então a coluna nunca era
-- lida. Ela passou a ser lida ontem, na 0169, e a única conversa que sobrou sem
-- dono depois da 0172 é exatamente um toque: a dedução por número procurou
-- `+5512997455554` em `whatsapp_contas` e, com razão, não achou.
--
-- Um número de terceiro numa coluna que descreve nossas contas é pior que um
-- nulo: nulo é "não sabemos", e o outro é uma afirmação falsa que qualquer join
-- futuro vai acreditar. Se o destinatário um dia for igual a um número nosso, o
-- toque entra na cota daquele número.
--
-- O CERTO É O NÚMERO DE QUEM CLICOU, quando essa pessoa tem um: o toque saiu do
-- aparelho dela. Quando não tem, nulo — e nulo aqui é a resposta honesta.
--
-- A posse da conversa também: ela vinha só da carteira (`vendedor_carteira`), que
-- não responde nada numa empresa sem dono. Quem clicou é o dono óbvio da conversa
-- que ele mesmo acabou de abrir.
-- ============================================================================

create or replace function public.app__registrar_toque(
  p_cnpj text, p_canal text, p_contato text, p_extra jsonb, p_ator uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid;
  v_nome text;
  v_contato_id uuid;
  v_ident text;
  v_canal_thread text;
  v_conversa uuid;
  v_vendedor uuid;
  v_vendedor_ator uuid;
  v_conta_ator text;
  v_comunicacao uuid;
begin
  if p_canal not in ('ligacao', 'whatsapp', 'email') then
    raise exception 'Canal inválido: %.', p_canal using errcode = '22023';
  end if;
  if p_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;

  select id, coalesce(razao_social, nome_fantasia) into v_empresa, v_nome
    from public.empresas where cnpj = p_cnpj;

  v_canal_thread := case when p_canal = 'ligacao' then 'whatsapp' else p_canal end;
  v_ident := public.app__identificador_canonico(v_canal_thread, p_contato);

  if v_empresa is not null and v_ident is not null then
    select id into v_contato_id from public.contatos
      where empresa_id = v_empresa
        and public.app__identificador_canonico(v_canal_thread,
              case when v_canal_thread = 'email' then email else coalesce(whatsapp, telefone) end) = v_ident
      limit 1;
  end if;

  select vc.vendedor_id into v_vendedor
    from public.vendedor_carteira vc
    where vc.empresa_id = v_empresa and vc.ate is null
    order by case vc.papel when 'originacao' then 1 when 'sdr' then 2 else 3 end
    limit 1;

  -- Quem clicou, e o número dele. As duas coisas que faltavam.
  select v.id into v_vendedor_ator from public.vendedores v
    where v.usuario_id = p_ator and v.ativo limit 1;
  select w.numero into v_conta_ator from public.whatsapp_contas w
    where w.usuario_responsavel = p_ator and w.ativo limit 1;

  -- Carteira primeiro (ela é a régua de posse do comercial), quem clicou depois.
  v_conversa := public.app__conversa_para(
    v_canal_thread, v_ident, v_empresa, v_contato_id, coalesce(v_vendedor, v_vendedor_ator));

  insert into public.comunicacoes (
    conversa_id, empresa_id, contato_id, canal, direcao,
    usuario_id, vendedor_id, por_ia,
    corpo, preview, provedor, conta_remetente, status_envio,
    origem, funil, funil_card_id, enviado_em
  ) values (
    v_conversa, v_empresa, v_contato_id, p_canal, 'saida',
    p_ator,
    coalesce(v_vendedor_ator, v_vendedor),
    false,
    null,
    'Abriu ' || p_canal || ' com ' || coalesce(p_contato, coalesce(v_nome, p_cnpj)) || '.',
    -- `v_conta_ator`, e não `p_contato`: a coluna é a NOSSA conta.
    'app_link', v_conta_ator, 'enviada',
    'app_toque',
    nullif(p_extra ->> 'funil', ''), nullif(p_extra ->> 'funil_card_id', ''),
    now()
  ) returning id into v_comunicacao;

  if v_conversa is not null then
    update public.conversas
      set ultima_mensagem_em = now(), ultima_direcao = 'saida', status = 'ativa'
      where id = v_conversa;
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa, 'toque.manual',
    jsonb_build_object(
      'titulo', 'Toque manual',
      'resumo', 'Contato por ' || p_canal || ' com ' || coalesce(v_nome, p_cnpj) || '.',
      'cnpj', p_cnpj,
      'canal', p_canal,
      'contato', p_contato,
      'comunicacao_id', v_comunicacao,
      'conversa_id', v_conversa
    ) || coalesce(p_extra, '{}'::jsonb),
    p_ator
  );
end $$;

-- O que já foi gravado: troca o número do destinatário pelo de quem clicou, ou
-- por nulo quando essa pessoa não tem conta.
update public.comunicacoes c
set conta_remetente = (
  select w.numero from public.whatsapp_contas w
  where w.usuario_responsavel = c.usuario_id and w.ativo limit 1
)
where c.origem = 'app_toque'
  and c.conta_remetente is not null
  and not exists (select 1 from public.whatsapp_contas w2 where w2.numero = c.conta_remetente);

-- E a conversa que ficou sem dono por causa disso.
update public.conversas cv
set responsavel_vendedor_id = c.vendedor_id
from public.comunicacoes c
where c.conversa_id = cv.id
  and cv.responsavel_vendedor_id is null
  and c.vendedor_id is not null;
