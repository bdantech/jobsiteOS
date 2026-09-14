-- ═════════════════════════════════════════════════════════════════════════════
-- 0200 — Quem preencheu o formulário podia ser respondido, e não era
--
-- Sintoma, na tela do Viktor: lead inbound no funil de reuniões, WhatsApp na
-- ficha, mensagem escrita, e o botão Enviar desligado com
-- "Contato sem base legal — não é possível abordá-lo."
--
-- A pessoa tinha acabado de preencher NOSSO formulário, com o WhatsApp como
-- campo OBRIGATÓRIO, e marcado a caixa "Autorizo o contato e o tratamento dos
-- meus dados conforme a LGPD" — que é obrigatória nos cinco formulários ativos.
-- Ela pediu para ser procurada e o sistema respondia que não havia base para
-- procurá-la.
--
-- ─── A CAUSA ────────────────────────────────────────────────────────────────
-- O consentimento SEMPRE foi coletado e SEMPRE foi gravado:
-- `formulario_submissoes.consentimento_aceito` e `.consentimento_em`. A rota
-- pública valida (`consentimento_obrigatorio`) e recusa a submissão sem aceite.
-- Nas 80 submissões que existem, 80 têm o aceite marcado — nenhuma recusa.
--
-- O que faltava era uma linha: o `insert into public.contatos` desta função
-- nunca passou `base_legal`. O dado estava a uma tabela de distância do campo
-- que o compositor lê, e nunca atravessou.
--
-- É o MESMO defeito que a 0155 descreveu para o contato manual e a 0196 para o
-- contato promovido — "um contato criado sem base nasce mudo: cadastrado,
-- visível e incapaz de receber mensagem, que é o pior dos três estados porque
-- parece que funcionou". As duas consertaram o caminho delas. O caminho do
-- formulário ficou para trás, e é justamente o de maior volume: 71 contatos em
-- onze dias, todos inbound, todos com aceite.
--
-- ─── POR QUE `formulario_aceite`, E POR QUE ISSO NÃO É AFROUXAR A TRAVA ──────
-- `formulario_aceite` é o valor que o CHECK da 0144 já previa para exatamente
-- este caso, e é a base mais forte que existe na tabela: consentimento livre,
-- informado e inequívoco, com data e texto registrados. Não estou dispensando a
-- trava — estou entregando a ela a prova que já existia.
--
-- A derivação é CONDICIONAL, e é aí que a trava continua de pé: sem
-- `consentimento_aceito`, `v_base` fica nulo e o contato continua mudo, como
-- deve. Se um formulário futuro tornar o aceite opcional, quem não marcar
-- continua sem base.
--
-- No caminho do UPDATE (contato que já existia e agora preencheu o formulário) a
-- gravação é por `coalesce`: base legal existente NUNCA é sobrescrita. Quem já
-- tinha `relacao_comercial` não é rebaixado, e quem não tinha nada ganha a base
-- que a pessoa acabou de dar. Consentimento acrescenta; não substitui histórico.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.app_processar_submissao(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_sub uuid;
  v_cnpj text := p ->> 'cnpj';
  v_email text := nullif(p ->> 'email', '');
  v_telefone text := nullif(p ->> 'telefone', '');
  v_empresa uuid;
  v_contato uuid;
  v_lead uuid;
  v_sdr uuid := nullif(p ->> 'sdr_id', '')::uuid;
  v_status text := coalesce(p ->> 'status', 'processada');
  v_criar_lead boolean := coalesce((p ->> 'criar_lead')::boolean, true);
  v_tipagem text := nullif(p ->> 'tipagem_antecipacao', '');
  v_nome_empresa text := nullif(p ->> 'razao_social', '');
  /* Só os quatro que o CHECK de empresas.tipo aceita. "outro", que o formulário
     oferece, não tem destino — e inventar um seria pior que deixar no default. */
  v_tipo text := nullif(p ->> 'tipo', '');
  v_tem_focal boolean;
  /* A base legal do contato sai do aceite desta submissão — e só dele. */
  v_aceite boolean := coalesce((p ->> 'consentimento_aceito')::boolean, false);
  v_base text;
  v_base_em timestamptz;
  v_base_detalhe text;
begin
  insert into public.formulario_submissoes (
    formulario_id, dados, campos_snapshot, intencao,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    referrer, pagina_url, user_agent, ip_hash, cnpj, status, motivo_revisao,
    consentimento_aceito, consentimento_em
  ) values (
    nullif(p ->> 'formulario_id', '')::uuid, p -> 'dados', p -> 'campos_snapshot',
    nullif(p ->> 'intencao', ''),
    p ->> 'utm_source', p ->> 'utm_medium', p ->> 'utm_campaign', p ->> 'utm_term',
    p ->> 'utm_content', p ->> 'referrer', p ->> 'pagina_url', p ->> 'user_agent',
    p ->> 'ip_hash', v_cnpj, v_status, nullif(p ->> 'motivo_revisao', ''),
    (p ->> 'consentimento_aceito')::boolean,
    case when (p ->> 'consentimento_aceito')::boolean then now() end
  ) returning id into v_sub;

  if v_status = 'descartada_spam' then
    return jsonb_build_object('submissao_id', v_sub, 'status', v_status);
  end if;

  /*
   * A evidência aponta para a SUBMISSÃO, não para esta função: é lá que estão o
   * texto aceito, o IP e a data. Quem for defender a abordagem depois abre a
   * submissão e vê o que a pessoa leu quando marcou a caixa.
   */
  if v_aceite then
    v_base := 'formulario_aceite';
    v_base_em := now();
    v_base_detalhe := 'Aceite LGPD no formulário "' || coalesce(p ->> 'slug', '?')
                      || '" — submissão ' || v_sub::text;
  end if;

  select id into v_empresa from public.empresas where cnpj = v_cnpj;
  if v_empresa is null then
    insert into public.empresas (cnpj, razao_social, estagio, origem, tipo)
    values (v_cnpj, v_nome_empresa, 'lead', 'formulario',
            coalesce(
              case when v_tipo in ('construtora', 'incorporadora', 'fornecedor', 'subempreiteiro')
                   then v_tipo end,
              'construtora'))
    returning id into v_empresa;

    insert into public.cnpj_lookup_fila (cnpj, motivo)
    values (v_cnpj, 'manual') on conflict (cnpj) do nothing;

    insert into public.empresa_eventos (empresa_id, tipo, payload)
    values (v_empresa, 'empresa.criada',
            jsonb_build_object('origem', 'formulario', 'slug', p ->> 'slug'));
  else
    update public.empresas set
      razao_social = coalesce(razao_social, v_nome_empresa),
      uf = coalesce(uf, nullif(p ->> 'uf', '')),
      municipio = coalesce(municipio, nullif(p ->> 'municipio', '')),
      erp_atual = coalesce(erp_atual, nullif(p ->> 'erp_atual', ''))
    where id = v_empresa;
  end if;

  if v_tipagem is not null then
    update public.empresas set tipagem_antecipacao = v_tipagem
    where id = v_empresa and tipagem_antecipacao is null;
  end if;

  if v_email is not null or v_telefone is not null then
    select id into v_contato from public.contatos
    where empresa_id = v_empresa
      and ((v_email is not null and lower(email) = v_email)
        or (v_telefone is not null and telefone = v_telefone))
    limit 1;

    select exists (select 1 from public.contatos where empresa_id = v_empresa and ponto_focal)
      into v_tem_focal;

    if v_contato is null then
      insert into public.contatos (
        empresa_id, nome, cargo, email, telefone, whatsapp, origem, ponto_focal,
        base_legal, base_legal_em, base_legal_detalhe
      )
      values (v_empresa, nullif(p ->> 'nome', ''), nullif(p ->> 'cargo', ''), v_email,
              v_telefone, nullif(p ->> 'whatsapp', ''),
              'formulario:' || coalesce(p ->> 'slug', '?'),
              not v_tem_focal,
              v_base, v_base_em, v_base_detalhe)
      returning id into v_contato;
    else
      update public.contatos set
        nome = coalesce(nome, nullif(p ->> 'nome', '')),
        cargo = coalesce(cargo, nullif(p ->> 'cargo', '')),
        email = coalesce(email, v_email),
        telefone = coalesce(telefone, v_telefone),
        whatsapp = coalesce(whatsapp, nullif(p ->> 'whatsapp', '')),
        -- coalesce: base legal que já existe não é sobrescrita por esta.
        base_legal = coalesce(base_legal, v_base),
        base_legal_em = coalesce(base_legal_em, v_base_em),
        base_legal_detalhe = coalesce(base_legal_detalhe, v_base_detalhe)
      where id = v_contato;
    end if;
  end if;

  if v_criar_lead and v_sdr is not null then
    select id into v_lead from public.sdr_leads
    where empresa_id = v_empresa and encerrado_em is null
    order by distribuido_em desc limit 1;

    if v_lead is null then
      insert into public.sdr_leads (empresa_id, sdr_id, origem, estagio, ultimo_toque_em)
      values (v_empresa, v_sdr, 'inbound', 'a_contatar', now())
      returning id into v_lead;
    else
      update public.sdr_leads set ultimo_toque_em = now(), atualizado_em = now()
      where id = v_lead;
    end if;
  end if;

  update public.formulario_submissoes set
    empresa_id = v_empresa, contato_id = v_contato, sdr_lead_id = v_lead
  where id = v_sub;

  insert into public.empresa_eventos (empresa_id, tipo, payload)
  values (v_empresa, 'lead.inbound_recebido', jsonb_build_object(
    'submissao_id', v_sub, 'slug', p ->> 'slug', 'intencao', p ->> 'intencao',
    'utm_source', p ->> 'utm_source', 'utm_campaign', p ->> 'utm_campaign',
    'status', v_status
  ));

  return jsonb_build_object(
    'submissao_id', v_sub, 'empresa_id', v_empresa, 'contato_id', v_contato,
    'sdr_lead_id', v_lead, 'status', v_status
  );
end $function$;

comment on function public.app_processar_submissao is
  'Submissão de formulário → empresa + contato + lead de SDR. O contato nasce com '
  '`base_legal = formulario_aceite` QUANDO a pessoa marcou o aceite — sem aceite ele '
  'continua mudo, de propósito. A evidência aponta para a submissão, onde estão o '
  'texto, a data e o IP.';

-- ─── O passivo: onze dias de lead inbound que ninguém pôde responder ─────────
--
-- 71 contatos, todos ligados à submissão que os criou, todos com o aceite
-- marcado. `base_legal_em` recebe a data do ACEITE, não a de hoje: a base nasceu
-- quando a pessoa marcou a caixa, e datar de hoje inventaria um consentimento
-- que teria chegado onze dias atrasado.
--
-- O `where base_legal is null` é o que torna isto seguro de rodar de novo.

update public.contatos c
set base_legal = 'formulario_aceite',
    base_legal_em = coalesce(s.consentimento_em, s.criada_em),
    base_legal_detalhe = 'Aceite LGPD no formulário "' || coalesce(f.slug, '?')
                         || '" — submissão ' || s.id::text || ' (regularizado pela 0200)'
from public.formulario_submissoes s
join public.formularios f on f.id = s.formulario_id
where s.contato_id = c.id
  and s.consentimento_aceito
  and c.base_legal is null
  and c.origem like 'formulario:%';
