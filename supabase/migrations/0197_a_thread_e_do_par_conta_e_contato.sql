-- A thread é do PAR (nossa conta, contato) — não do contato sozinho.
--
-- `conversas` tinha única em (canal, identificador_externo). O número do cliente era a
-- chave inteira, e a nossa ponta não entrava nela. Com um número só isso nunca apareceu;
-- com três, apareceu no mesmo dia: uma mensagem que chegou no WhatsApp do Viktor foi
-- parar na thread que o mesmo contato tinha com o Rodrigo, intercalada por hora com uma
-- conversa que não era aquela.
--
-- Cinco threads da base estavam nesse estado, e QUATRO delas são anteriores ao Viktor —
-- Rodrigo e Fabio já se misturavam desde 02/09 sem que ninguém percebesse. A pior tem 126
-- mensagens de três contas.
--
-- ── DOIS DANOS, E O SEGUNDO É O GRAVE ──────────────────────────────────────────────
-- O visível é a thread embaralhada. O outro é que `responsavel_vendedor_id` é gravado com
-- `coalesce` — quem chegou primeiro fica —, e a visibilidade da conversa sai daí: uma
-- mensagem que o cliente manda para o Viktor entrava na thread do Rodrigo e o Rodrigo
-- lia. Isso é vazamento entre carteiras, e é o motivo de esta migração não ter esperado.
--
-- ── E O E-MAIL VINHA PELO MESMO CAMINHO ────────────────────────────────────────────
-- `conversas` é a mesma tabela para `canal = 'email'`, com a mesma única. Hoje não há
-- nenhuma caixa conectada, então nada colidiu ainda; no dia em que duas pessoas
-- conectarem o Gmail e as duas falarem com o mesmo cliente, as threads colapsariam
-- igual. Consertar antes é a diferença entre uma migração de 5 linhas e uma de 126.
--
-- ── POR QUE `conta_remetente` text, E NÃO UM FK ────────────────────────────────────
-- A nossa ponta é uma linha de `whatsapp_contas` no WhatsApp, uma de `gmail_contas` (que
-- tem PK em usuario_id) no e-mail da pessoa, e NENHUMA linha quando o e-mail sai pelo
-- Resend do sistema. Não existe uma tabela para apontar. O identificador textual — número
-- E.164 ou endereço de e-mail — cobre os três, e é exatamente o que `comunicacoes.
-- conta_remetente` já guarda para cada mensagem, inclusive nas de ENTRADA (lá o nome
-- também significa "a nossa conta", não "quem escreveu"). Mesmo nome, mesmos valores: o
-- backfill vira um group by, e quem for ler o esquema depois vê a ligação sem procurar.
--
-- ── NULLS NOT DISTINCT ─────────────────────────────────────────────────────────────
-- Quatro mensagens antigas não têm conta (chegaram pelo segredo global, antes de a ficha
-- por número existir). Numa única normal, dois NULLs não colidem — e a thread "sem conta"
-- seria recriada a cada mensagem, que é o oposto do que a chave existe para fazer. PG 15+
-- resolve isso declarando a intenção em vez de inventar um sentinela como ''.

alter table public.conversas add column if not exists conta_remetente text;

comment on column public.conversas.conta_remetente is
  'A NOSSA ponta da conversa: número E.164 da conta de WhatsApp, ou endereço da caixa que enviou/recebeu. Casa com comunicacoes.conta_remetente. Null = conta desconhecida (mensagem anterior à ficha por número).';

-- ── O recontador ───────────────────────────────────────────────────────────────────
-- Existe porque o fatiamento mexe nos agregados de DUAS threads por vez (a nova e a que
-- perdeu mensagens), e porque `app__conversa_absorver_lid` vai passar a ter o mesmo
-- problema quando desfizer uma absorção. Uma cópia da regra em cada lugar é como os dois
-- lados divergem.
--
-- `nao_lidas` segue a regra do ledger — entrada depois da última saída, porque responder
-- é ler. NÃO é "tudo que ninguém abriu": o contador é da thread, não por pessoa.
create or replace function public.app__conversa_recontar(p_conversa uuid)
returns void
language sql
security definer
set search_path to ''
as $function$
  update public.conversas cv set
    ultima_mensagem_em = ag.ultima_em,
    ultima_direcao     = ag.ultima_direcao,
    criada_em          = least(cv.criada_em, coalesce(ag.primeira_em, cv.criada_em)),
    nao_lidas          = ag.nao_lidas
  from (
    select
      max(m.criado_em) as ultima_em,
      min(m.criado_em) as primeira_em,
      (array_agg(m.direcao order by m.criado_em desc))[1] as ultima_direcao,
      count(*) filter (
        where m.direcao = 'entrada'
          and m.criado_em > coalesce(
            (select max(s.criado_em) from public.comunicacoes s
              where s.conversa_id = p_conversa and s.direcao = 'saida'),
            '-infinity'::timestamptz)
      )::int as nao_lidas
    from public.comunicacoes m
    where m.conversa_id = p_conversa
  ) ag
  where cv.id = p_conversa and ag.ultima_em is not null;
$function$;

revoke all on function public.app__conversa_recontar(uuid) from public;
grant execute on function public.app__conversa_recontar(uuid) to service_role;

-- ── 1. Sair da chave velha ANTES de fatiar ─────────────────────────────────────────
-- A ordem não é arbitrária, e descobri isso do jeito difícil: a única antiga proíbe duas
-- threads com o mesmo (canal, identificador) — que é precisamente o que o fatiamento
-- precisa criar. Derrubá-la depois faz o backfill estourar 23505 na primeira fatia.
-- Dentro da transação da migração não existe janela sem chave: ou tudo entra, ou nada.
alter table public.conversas drop constraint if exists conversas_canal_identificador_externo_key;
drop index if exists public.conversas_canal_identificador_externo_key;
drop index if exists public.conversas_lid_idx;

-- ── 2. De quem é cada thread que já existe ─────────────────────────────────────────
-- A conta MAJORITÁRIA fica com a linha original, e não a mais recente: é ela que tem o
-- histórico, o `lid`, o vínculo com a empresa e o responsável certo. Empate desempata
-- pela mais antiga, para o resultado não depender da ordem de leitura.
with contagem as (
  select conversa_id, conta_remetente, count(*) as n, min(criado_em) as primeira
    from public.comunicacoes
   where conversa_id is not null and conta_remetente is not null
   group by 1, 2
), maioria as (
  select distinct on (conversa_id) conversa_id, conta_remetente
    from contagem
   order by conversa_id, n desc, primeira asc
)
update public.conversas cv
   set conta_remetente = m.conta_remetente
  from maioria m
 where m.conversa_id = cv.id;

-- ── 3. Fatiar o que está misturado ─────────────────────────────────────────────────
-- Uma thread nova por conta minoritária, e as mensagens daquela conta vão junto. As
-- mensagens SEM conta ficam na original: "não sei de quem é" não é motivo para inventar
-- mais uma thread.
--
-- Só `comunicacoes` migra. `mensagens_outbox`, `agente_decisoes` e `campanha_destinatarios`
-- continuam apontando para a original de propósito: são trabalho AGENDADO, e mover um
-- envio pendente para uma thread recém-criada mudaria por qual número ele sai — decisão
-- que é do compositor, não de um backfill.
do $$
declare
  f record;
  v_nova uuid;
  v_vend uuid;
  v_carteira uuid;
begin
  for f in
    select m.conversa_id as origem,
           m.conta_remetente as conta,
           cv.canal, cv.identificador_externo, cv.empresa_id, cv.contato_id,
           cv.objetivo, cv.playbook_id, cv.modo_agente, cv.responsavel_vendedor_id
      from public.comunicacoes m
      join public.conversas cv on cv.id = m.conversa_id
     where m.conta_remetente is not null
       and m.conta_remetente is distinct from cv.conta_remetente
     group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
  loop
    /*
     * O responsável da fatia sai da MESMA regra do runtime (webhooks.ts): a CARTEIRA
     * primeiro, o dono do número depois. Inverter a ordem aqui produziria threads que o
     * próximo webhook reatribuiria — duas respostas para a mesma pergunta, e a tela
     * mudando sozinha entre uma e outra.
     *
     * Vale reparar que a visibilidade NÃO depende só disto: `app__donos_da_conversa`
     * inclui o dono de toda `conta_remetente` que aparece no ledger da thread. É por isso
     * que o Rodrigo enxergava a conversa do Viktor — as mensagens dele estavam lá dentro —
     * e é o fatiamento, não o responsável, que fecha esse vazamento.
     */
    select vc.vendedor_id into v_carteira
      from public.vendedor_carteira vc
     where vc.empresa_id = f.empresa_id and vc.ate is null
     order by case vc.papel when 'originacao' then 1 when 'sdr' then 2 else 3 end
     limit 1;

    select v.id into v_vend
      from public.whatsapp_contas wa
      join public.vendedores v
        on v.usuario_id = wa.usuario_responsavel and v.ativo
     where wa.numero = f.conta
     limit 1;

    insert into public.conversas
      (canal, identificador_externo, conta_remetente, empresa_id, contato_id,
       objetivo, playbook_id, modo_agente, responsavel_vendedor_id, status)
    values
      (f.canal, f.identificador_externo, f.conta, f.empresa_id, f.contato_id,
       f.objetivo, f.playbook_id, f.modo_agente,
       coalesce(v_carteira, v_vend, f.responsavel_vendedor_id), 'ativa')
    returning id into v_nova;

    update public.comunicacoes
       set conversa_id = v_nova
     where conversa_id = f.origem
       and conta_remetente = f.conta;

    /*
     * A que SOBROU também precisa de conferência. Ela ficou com a conta majoritária, mas
     * o responsável dela foi decidido lá atrás pelo primeiro que falou — que pode ser o
     * dono de OUTRO número. Só realinha quando não há empresa: com empresa, a carteira é
     * quem manda, e sobrescrever aqui desfaria uma atribuição legítima.
     */
    update public.conversas cv
       set responsavel_vendedor_id = dono.id
      from public.whatsapp_contas wa
      join public.vendedores dono
        on dono.usuario_id = wa.usuario_responsavel and dono.ativo
     where cv.id = f.origem
       and cv.empresa_id is null
       and wa.numero = cv.conta_remetente
       and cv.responsavel_vendedor_id is distinct from dono.id;

    perform public.app__conversa_recontar(v_nova);
    perform public.app__conversa_recontar(f.origem);
  end loop;
end $$;

-- ── 4. As chaves novas ─────────────────────────────────────────────────────────────
create unique index conversas_canal_identificador_conta_key
  on public.conversas (canal, identificador_externo, conta_remetente) nulls not distinct;

-- O LID também é por conta: o mesmo cliente escrevendo para dois números nossos gera o
-- mesmo identificador de privacidade nos dois, e uma única global faria a segunda conta
-- herdar a thread da primeira — o bug, de novo, por outra porta.
create unique index conversas_lid_idx
  on public.conversas (lid, conta_remetente) nulls not distinct
  where lid is not null;

-- ── 5. As funções que resolvem a thread ────────────────────────────────────────────
-- `p_conta` entra com DEFAULT null, e isso não é preguiça: durante o deploy o worker
-- antigo (5 argumentos) continua chamando, e sem o default o PostgREST devolveria
-- "function not found" para toda mensagem que chegasse na janela entre a migração e o
-- release do container. Com o default, quem chama sem conta cai na thread que já existe
-- — a migração pode subir antes do container sem produzir uma linha torta sequer.
drop function if exists public.app__conversa_para(text, text, uuid, uuid, uuid);

create or replace function public.app__conversa_para(
  p_canal text,
  p_identificador text,
  p_empresa uuid,
  p_contato uuid,
  p_vendedor uuid,
  p_conta text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ident text := public.app__identificador_canonico(p_canal, p_identificador);
  -- Minúsculas e sem espaço: o número já vem em dígitos, mas o endereço de e-mail chega
  -- do provedor com a caixa que o remetente digitou, e "Rodrigo@" e "rodrigo@" abririam
  -- duas threads para a mesma caixa.
  v_conta text := nullif(btrim(lower(coalesce(p_conta, ''))), '');
  v_id uuid;
begin
  if v_ident is null or p_canal not in ('whatsapp', 'email') then
    return null;
  end if;

  /*
   * SEM CONTA: cai na thread que já existe, em vez de abrir uma "sem conta" ao lado.
   *
   * Quem chama assim é o worker AINDA NÃO ATUALIZADO, na janela entre esta migração e o
   * release do container. Sem este ramo, cada mensagem daquela janela criaria uma segunda
   * thread do mesmo contato — o bug que a migração desfez, refeito por alguns minutos e
   * desta vez sem nada que o desfaça depois. Com ele, o worker antigo continua se
   * comportando exatamente como antes: uma thread por contato.
   */
  if v_conta is null then
    select id into v_id from public.conversas
     where canal = p_canal and identificador_externo = v_ident
     order by ultima_mensagem_em desc nulls last
     limit 1;
    if v_id is not null then
      update public.conversas set
        empresa_id = coalesce(empresa_id, p_empresa),
        contato_id = coalesce(contato_id, p_contato),
        responsavel_vendedor_id = coalesce(responsavel_vendedor_id, p_vendedor)
       where id = v_id;
      return v_id;
    end if;
  end if;

  /*
   * ADOÇÃO. A thread que existe SEM conta e que agora ganhou uma passa a ser daquela
   * conta, em vez de virar uma segunda thread ao lado. É o que absorve o histórico
   * anterior à ficha por número.
   *
   * Só adota quando não existe ainda a thread daquela conta — se existir, a de conta
   * nula é resíduo e a mensagem vai para a legítima.
   */
  if v_conta is not null then
    update public.conversas set conta_remetente = v_conta
     where canal = p_canal and identificador_externo = v_ident and conta_remetente is null
       and not exists (
         select 1 from public.conversas outra
          where outra.canal = p_canal and outra.identificador_externo = v_ident
            and outra.conta_remetente = v_conta
       );
  end if;

  insert into public.conversas as cv
    (canal, identificador_externo, conta_remetente, empresa_id, contato_id, responsavel_vendedor_id)
  values (p_canal, v_ident, v_conta, p_empresa, p_contato, p_vendedor)
  on conflict (canal, identificador_externo, conta_remetente) do update set
    empresa_id = coalesce(cv.empresa_id, excluded.empresa_id),
    contato_id = coalesce(cv.contato_id, excluded.contato_id),
    responsavel_vendedor_id =
      coalesce(cv.responsavel_vendedor_id, excluded.responsavel_vendedor_id)
  returning cv.id into v_id;

  return v_id;
end $function$;

revoke all on function public.app__conversa_para(text, text, uuid, uuid, uuid, text) from public;
grant execute on function public.app__conversa_para(text, text, uuid, uuid, uuid, text) to service_role;

-- A busca por LID também é por conta, pelo mesmo motivo do índice: o mesmo cliente gera o
-- mesmo LID nos dois números nossos. Sem `p_conta` (worker antigo), devolve a mais
-- recente — o comportamento de antes, para não piorar durante o deploy.
drop function if exists public.app__conversa_por_lid(text);

create or replace function public.app__conversa_por_lid(p_lid text, p_conta text default null)
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select id from public.conversas
   where lid = p_lid
     and (
       nullif(btrim(lower(coalesce(p_conta, ''))), '') is null
       or conta_remetente is not distinct from nullif(btrim(lower(p_conta)), '')
     )
   order by ultima_mensagem_em desc nulls last
   limit 1;
$function$;

revoke all on function public.app__conversa_por_lid(text, text) from public;
grant execute on function public.app__conversa_por_lid(text, text) to service_role;

-- A absorção do LID passa a procurar a thread velha DENTRO da mesma conta. Sem o recorte,
-- o telefone que chega no número do Viktor absorveria a thread-por-LID que o Rodrigo
-- tinha do mesmo cliente — refazendo a mistura logo depois de a chave a ter desfeito.
create or replace function public.app__conversa_absorver_lid(p_lid text, p_conversa uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_velha public.conversas;
  v_nova  public.conversas;
begin
  if p_lid is null or btrim(p_lid) = '' or p_conversa is null then
    return;
  end if;

  select * into v_nova from public.conversas where id = p_conversa;
  if v_nova.id is null then
    return;
  end if;

  select * into v_velha
    from public.conversas
   where canal = 'whatsapp'
     and identificador_externo = p_lid
     and id <> p_conversa
     and conta_remetente is not distinct from v_nova.conta_remetente;

  if v_velha.id is not null then
    update public.comunicacoes     set conversa_id = v_nova.id where conversa_id = v_velha.id;
    update public.mensagens_outbox set conversa_id = v_nova.id where conversa_id = v_velha.id;
    update public.agente_decisoes  set conversa_id = v_nova.id where conversa_id = v_velha.id;

    update public.conversas set
      empresa_id = coalesce(v_nova.empresa_id, v_velha.empresa_id),
      contato_id = coalesce(v_nova.contato_id, v_velha.contato_id),
      responsavel_vendedor_id =
        coalesce(v_nova.responsavel_vendedor_id, v_velha.responsavel_vendedor_id),
      objetivo    = coalesce(v_nova.objetivo, v_velha.objetivo),
      playbook_id = coalesce(v_nova.playbook_id, v_velha.playbook_id)
      where id = v_nova.id;

    insert into public.conversas_ocultas (usuario_id, conversa_id, motivo, ocultada_em)
      select o.usuario_id, v_nova.id, o.motivo, o.ocultada_em
        from public.conversas_ocultas o where o.conversa_id = v_velha.id
      on conflict (usuario_id, conversa_id) do nothing;

    delete from public.conversas where id = v_velha.id;

    -- Os agregados saem do ledger já reunido, e não de somar os dois lados: `nao_lidas`
    -- somado contava duas vezes a entrada que estava nas duas pontas, e `criada_em`
    -- calculado a partir das linhas é o que ele sempre quis dizer.
    perform public.app__conversa_recontar(v_nova.id);
  end if;

  update public.conversas_nao_vinculadas nv set
    identificador_externo = v_nova.identificador_externo,
    lid = p_lid
    where nv.canal = 'whatsapp' and nv.identificador_externo = p_lid
      and not exists (
        select 1 from public.conversas_nao_vinculadas outra
        where outra.canal = 'whatsapp'
          and outra.identificador_externo = v_nova.identificador_externo
      );
  delete from public.conversas_nao_vinculadas
    where canal = 'whatsapp' and identificador_externo = p_lid;

  update public.conversas set lid = p_lid where id = v_nova.id;
end $function$;

-- ── 6. O inbox precisa DIZER de quem é a thread ────────────────────────────────────
-- Duas linhas com o mesmo nome de contato e nenhuma diferença visível seriam piores que a
-- thread misturada: quem olha conclui que é bug de duplicata e escolhe uma ao acaso. O
-- rótulo é o apelido da conta quando o usuário enxerga a ficha do número, e o número cru
-- quando não enxerga — a view é `security_invoker`, então a RLS de `whatsapp_contas` vale
-- aqui dentro e o LEFT JOIN degrada para null sozinho.
create or replace view public.inbox_conversas with (security_invoker = true) as
  select cv.id,
    cv.canal,
    cv.identificador_externo,
    cv.empresa_id,
    cv.contato_id,
    cv.objetivo,
    cv.playbook_id,
    cv.responsavel_vendedor_id,
    cv.modo_agente,
    cv.status,
    cv.ultima_mensagem_em,
    cv.ultima_direcao,
    cv.proxima_acao_em,
    cv.nao_lidas,
    e.cnpj as empresa_cnpj,
    coalesce(e.razao_social, e.nome_fantasia) as empresa_nome,
    ct.nome as contato_nome,
    ct.cargo as contato_cargo,
    ct.base_legal as contato_base_legal,
    ct.nao_e_o_decisor as contato_nao_e_o_decisor,
    v.nome as responsavel_nome,
    v.is_ia as responsavel_is_ia,
    ult.preview as ultima_preview,
    ult.por_ia as ultima_por_ia,
    ult.triagem as ultima_triagem,
    sug.id as sugestao_id,
    sug.acao as sugestao_acao,
    sug.conteudo_sugerido as sugestao_conteudo,
    sug.justificativa as sugestao_justificativa,
    sug.confianca as sugestao_confianca,
    cv.lid,
    nv.nome_sugerido,
    ult.origem as ultima_origem,
    cv.conta_remetente,
    coalesce(wa.apelido, cv.conta_remetente) as conta_rotulo
   from public.conversas cv
     left join public.empresas e on e.id = cv.empresa_id
     left join public.contatos ct on ct.id = cv.contato_id
     left join public.vendedores v on v.id = cv.responsavel_vendedor_id
     left join public.whatsapp_contas wa on wa.numero = cv.conta_remetente
     left join lateral ( select m.preview, m.por_ia, m.triagem, m.origem
           from public.comunicacoes m
          where m.conversa_id = cv.id
          order by m.criado_em desc
         limit 1) ult on true
     left join lateral ( select d.id, d.acao, d.conteudo_sugerido, d.justificativa, d.confianca
           from public.agente_decisoes d
          where d.conversa_id = cv.id and d.modo = 'sugestao' and not d.executada and not d.descartada
          order by d.criado_em desc
         limit 1) sug on true
     left join lateral ( select f.nome_sugerido
           from public.conversas_nao_vinculadas f
          where f.canal = cv.canal
            and (f.identificador_externo = cv.identificador_externo
                 or cv.lid is not null and f.identificador_externo = cv.lid
                 or cv.lid is not null and f.lid = cv.lid)
          order by f.ultima_mensagem_em desc
         limit 1) nv on true;

grant select on public.inbox_conversas to authenticated;

-- ── 7. Identificar o contato também mudou de escopo ────────────────────────────────
-- `app_conversa_vincular` fazia `on conflict (canal, identificador_externo)`, que era o
-- índice que acabou de deixar de existir: sem esta troca, identificar alguém no inbox
-- passaria a estourar erro de "no unique constraint matching".
--
-- E a correção não é só trocar o arbiter. IDENTIFICAR UMA PESSOA É UM FATO SOBRE A
-- PESSOA, não sobre o número por onde ela falou: quando o mesmo contato tem thread com
-- dois dos nossos números, dizer quem ele é em uma e deixar a outra como "a identificar"
-- devolveria à fila exatamente o trabalho que alguém acabou de fazer. Por isso a empresa
-- e o contato descem para TODAS as threads daquele identificador — com `coalesce`, para
-- não sobrescrever uma thread que já tinha vínculo próprio.
--
-- O responsável, não. Ele continua sendo de cada thread: quem falou pelo celular do
-- Fabio é o Fabio, mesmo que a empresa seja da carteira do Rodrigo. É a mesma distinção
-- que a 0169 já tinha escrito ao dizer que empresa e contato são sobre quem está do outro
-- lado, e o vendedor é sobre quem daqui falou.
create or replace function public.app_conversa_vincular(p jsonb)
returns public.conversas
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ator uuid := auth.uid();
  v_nv public.conversas_nao_vinculadas;
  v_empresa public.empresas;
  v_contato public.contatos;
  v_conversa public.conversas;
  v_base text;
  v_vendedor uuid;
  v_conta text;
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;

  select * into v_nv from public.conversas_nao_vinculadas where id = (p ->> 'id')::uuid;
  if v_nv.id is null then
    raise exception 'Conversa não encontrada na fila.' using errcode = 'no_data_found';
  end if;
  if v_nv.status <> 'pendente' then
    raise exception 'Esta conversa já foi resolvida.' using errcode = '23505';
  end if;

  select * into v_empresa from public.empresas where id = (p ->> 'empresa_id')::uuid;
  if v_empresa.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;
  if nullif(p ->> 'nome', '') is null then
    raise exception 'Informe o nome do contato.' using errcode = '23514';
  end if;

  /*
   * A conta que atendeu vem da fila (`conta_recebedora`, gravada pelo resolver desde que a
   * ficha por número existe). Quando ela é nula — linha antiga —, a thread mais recente
   * daquele identificador diz por qual número a pessoa falou. Chutar null criaria uma
   * thread vazia ao lado da que tem o histórico.
   */
  v_conta := nullif(btrim(lower(coalesce(v_nv.conta_recebedora, ''))), '');
  if v_conta is null then
    select cv.conta_remetente into v_conta
      from public.conversas cv
     where cv.canal = v_nv.canal and cv.identificador_externo = v_nv.identificador_externo
     order by cv.ultima_mensagem_em desc nulls last
     limit 1;
  end if;

  v_base := case when v_empresa.estagio in ('cliente', 'ex_cliente') then 'relacao_comercial'
                 else 'manual' end;

  insert into public.contatos (
    empresa_id, nome, cargo, email, telefone, whatsapp, origem,
    base_legal, base_legal_em, base_legal_detalhe
  ) values (
    v_empresa.id, p ->> 'nome', nullif(p ->> 'cargo', ''),
    case when v_nv.canal = 'email'    then v_nv.identificador_externo end,
    case when v_nv.canal = 'whatsapp' then v_nv.identificador_externo end,
    case when v_nv.canal = 'whatsapp' then v_nv.identificador_externo end,
    'vinculado_inbox', v_base, now(),
    'Vinculado no inbox a partir de ' || v_nv.canal || ' ' || v_nv.identificador_externo
  ) returning * into v_contato;

  select vc.vendedor_id into v_vendedor
    from public.vendedor_carteira vc
    where vc.empresa_id = v_empresa.id and vc.ate is null
    order by case vc.papel when 'originacao' then 1 when 'sdr' then 2 else 3 end
    limit 1;

  insert into public.conversas as cv
    (canal, identificador_externo, conta_remetente, empresa_id, contato_id, responsavel_vendedor_id)
  values (v_nv.canal, v_nv.identificador_externo, v_conta, v_empresa.id, v_contato.id,
          coalesce(v_vendedor, v_nv.vendedor_sugerido_id))
  on conflict (canal, identificador_externo, conta_remetente) do update set
    empresa_id = excluded.empresa_id,
    contato_id = excluded.contato_id,
    responsavel_vendedor_id = coalesce(cv.responsavel_vendedor_id, excluded.responsavel_vendedor_id)
  returning cv.* into v_conversa;

  -- As threads irmãs: mesmo contato, outro número nosso.
  update public.conversas cv set
    empresa_id = coalesce(cv.empresa_id, v_empresa.id),
    contato_id = coalesce(cv.contato_id, v_contato.id)
   where cv.canal = v_nv.canal
     and cv.identificador_externo = v_nv.identificador_externo
     and cv.id <> v_conversa.id;

  update public.comunicacoes m
     set empresa_id = v_empresa.id,
         contato_id = v_contato.id,
         vendedor_id = coalesce(m.vendedor_id, cv.responsavel_vendedor_id)
    from public.conversas cv
   where cv.id = m.conversa_id
     and cv.canal = v_nv.canal
     and cv.identificador_externo = v_nv.identificador_externo;

  update public.conversas_nao_vinculadas
    set status = 'vinculada', vinculada_contato_id = v_contato.id,
        resolvida_por = v_ator, resolvida_em = now()
    where id = v_nv.id;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_empresa.id, 'conversa.vinculada',
    jsonb_build_object(
      'titulo', 'Conversa identificada',
      'resumo', coalesce(p ->> 'nome', 'Contato') || ' (' || v_nv.canal || ') vinculado a '
                || coalesce(v_empresa.razao_social, v_empresa.nome_fantasia, v_empresa.cnpj) || '.',
      'url', '/comunicacao/' || v_conversa.id,
      'conversa_id', v_conversa.id,
      'contato_id', v_contato.id,
      'base_legal', v_base),
    v_ator);

  /*
   * O VÍNCULO é o gatilho do caminho do celular.
   *
   * O vendedor falou pelo WhatsApp dele, e a mensagem chegou sem empresa e sem
   * funil — 592 delas estão assim. Este é o primeiro instante em que o sistema
   * sabe com quem se falou, e portanto o instante de mover o card.
   */
  perform public.app__primeiro_contato_empresa(v_empresa.id);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.conversa_vinculada', 'conversas', v_conversa.id::text, p);

  return v_conversa;
end $function$;
