-- 0175 — A conta passiva não tinha titular, e por isso não pagava ninguém.
--
-- O motor v2 paga o VENDEDOR a quem tem `papel = 'vendedor'` sobre o sacado. Medido em
-- 04/09/2026, a tabela tinha 15 linhas de `originacao`, 5 de `gestao_passiva`, 5 de
-- `originador` — e ZERO de `vendedor`. O papel existia no CHECK, no core e na leitura do
-- painel; simplesmente nada no sistema o escrevia.
--
-- O único produtor era `vendas.situacao = 'ganho'`, e o funil de vendas tem uma venda em
-- andamento na base inteira. A tela que a operação usa de fato — "Definir gestão", na
-- ficha da empresa — abria `gestao_passiva` e `originacao`, que são os papéis do modelo
-- ANTERIOR. O resultado é que 22 cessões converteram em setembro e nenhuma virou
-- lançamento, com o extrato de todo mundo em zero.
--
-- Esta migração fecha o buraco pelo lado da conta PASSIVA, e só por ele:
--
--   passivo             `gestao_passiva` passa a espelhar também `vendedor`. É a mesma
--                       pessoa e a mesma entidade — quem gere a conta passiva É o titular
--                       do sacado dela. Conta passiva nunca tem `originacao` (o 0098
--                       exclui de propósito), então não há sobreposição possível.
--
--   prospecção ativa    NADA muda. `originacao` continua sendo lida só para dar os
--                       CEDENTES ao originador, e a conta segue sem titular do sacado até
--                       um gestor escolher um à mão. Espelhar `originacao` em `vendedor`
--                       faria a mesma pessoa somar as duas linhas da mesma cessão — 1000
--                       R$/MM pelo sacado mais 600 pelo cedente — onde a régua previa
--                       1000 para o closer e 600 para o originador, duas pessoas. Conta
--                       sem vendedor não redistribui a parcela dele (§4): ela não é paga.
--
-- O espelho só governa as linhas `automatica`. Uma titularidade que um gestor escolheu à
-- mão (`origem = 'manual'`) nunca é fechada nem sobrescrita por ele — é a válvula que já
-- existe no resto do módulo, e é ela que torna "colocar um vendedor nesta conta" uma
-- decisão que sobrevive à próxima reclassificação.

-- ─── §1 A tela de gestão passa a abrir o papel que o motor lê ───────────────

create or replace function public.app_definir_gestao_operacao(p jsonb)
returns public.empresas language plpgsql security definer set search_path = '' as $function$
declare
  v_ator uuid := auth.uid();
  v_empresa public.empresas;
  v_antes text;
  v_gestao text := p ->> 'gestao_operacao';
  v_gestor uuid := nullif(p ->> 'vendedor_gestao_id', '')::uuid;
  v_originador uuid := nullif(p ->> 'vendedor_originacao_id', '')::uuid;
  v_motivo text := nullif(trim(p ->> 'motivo'), '');
  v_tipo text;
  v_ativo boolean;
  r record;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;
  if v_gestao is not null and v_gestao not in ('prospeccao_ativa', 'passivo') then
    raise exception 'Gestão inválida: %.', v_gestao using errcode = '22023';
  end if;

  select * into v_empresa from public.empresas where id = (p ->> 'empresa_id')::uuid;
  if v_empresa.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;
  v_antes := v_empresa.gestao_operacao;

  if v_gestao is not null and v_empresa.estagio not in ('cliente', 'ex_cliente') then
    raise exception
      'Ativo x passivo só se decide para cliente ou ex-cliente da OnePay — esta empresa está em "%".',
      v_empresa.estagio using errcode = '22023';
  end if;
  if v_gestao = 'passivo' and v_gestor is null then
    raise exception 'Empresa passiva precisa de um vendedor de gestão.' using errcode = '22023';
  end if;
  -- Só gestor reclassifica: a classificação é a taxa, e a taxa não é decisão de quem recebe.
  if v_gestao is distinct from v_antes then
    if not public.app_gestor_comercial() then
      raise exception 'Só gestores mudam a classificação da conta.' using errcode = '42501';
    end if;
    if v_motivo is null then
      raise exception 'Mudar a classificação exige motivo.' using errcode = '22023';
    end if;
  end if;

  if v_originador is not null then
    if not public.app_gestor_comercial() then
      raise exception 'Só gestores definem o originador de uma conta.' using errcode = '42501';
    end if;
    if v_gestao is distinct from 'prospeccao_ativa' then
      raise exception 'Originador só se define em conta de prospecção ativa.' using errcode = '22023';
    end if;
    select tipo, ativo into v_tipo, v_ativo from public.vendedores where id = v_originador;
    if v_tipo is null then
      raise exception 'Originador não encontrado.' using errcode = 'no_data_found';
    end if;
    if v_tipo <> 'originador' or not v_ativo then
      raise exception 'O dono de uma conta ativa é um originador ativo — este é %.', v_tipo
        using errcode = '22023';
    end if;
  end if;

  update public.empresas set
    gestao_operacao = v_gestao,
    gestao_definida_por = case when v_gestao is null then null else v_ator end,
    gestao_definida_em = case when v_gestao is null then null else now() end
  where id = v_empresa.id
  returning * into v_empresa;

  /*
   * O histórico. `valor_novo` é not null, então "remover a classificação" entra como o
   * texto 'nenhum' em vez de sumir: uma conta que DEIXOU de ser passiva é um fato tão
   * relevante para a comissão quanto uma que passou a ser.
   */
  if v_gestao is distinct from v_antes then
    insert into public.gestao_operacao_historico
      (empresa_id, valor_anterior, valor_novo, motivo, alterado_por)
    values (v_empresa.id, v_antes, coalesce(v_gestao, 'nenhum'), v_motivo, v_ator);
  end if;

  update public.vendedor_carteira set ate = now()
  where empresa_id = v_empresa.id and papel = 'gestao_passiva' and ate is null
    and (v_gestao <> 'passivo' or vendedor_id is distinct from v_gestor);

  if v_gestao = 'passivo' then
    insert into public.vendedor_carteira (vendedor_id, empresa_id, papel)
    select v_gestor, v_empresa.id, 'gestao_passiva'
    where not exists (
      select 1 from public.vendedor_carteira c
      where c.empresa_id = v_empresa.id and c.papel = 'gestao_passiva' and c.ate is null
    );
  end if;

  /*
   * ── O espelho em `vendedor` (novo) ──
   *
   * Fecha primeiro, abre depois, e as duas coisas só tocam `origem = 'automatica'`:
   * a linha que um gestor pôs à mão é dele, e continua valendo quando a conta muda de
   * classificação ou de gestor passivo.
   *
   * A abertura ainda checa se existe QUALQUER titular vigente (manual inclusive) porque
   * o índice único e o trigger de share não sabem de origem — dois titulares de 100%
   * seriam recusados pelo banco no meio da transação da tela.
   */
  update public.vendedor_carteira set ate = now()
  where empresa_id = v_empresa.id and papel = 'vendedor' and ate is null
    and origem = 'automatica'
    and (v_gestao is distinct from 'passivo' or vendedor_id is distinct from v_gestor);

  if v_gestao = 'passivo' then
    insert into public.vendedor_carteira (vendedor_id, empresa_id, papel, origem)
    select v_gestor, v_empresa.id, 'vendedor', 'automatica'
    where not exists (
      select 1 from public.vendedor_carteira c
      where c.empresa_id = v_empresa.id and c.papel = 'vendedor' and c.ate is null
    );
  end if;

  if v_originador is not null then
    update public.vendedores v set settings = jsonb_set(
      coalesce(v.settings, '{}'::jsonb), '{empresas_escolhidas}',
      coalesce((select jsonb_agg(x)
                from jsonb_array_elements_text(v.settings -> 'empresas_escolhidas') x
                where x <> v_empresa.id::text), '[]'::jsonb))
    where v.tipo = 'originador' and v.id <> v_originador
      and coalesce(v.settings -> 'empresas_escolhidas' ? v_empresa.id::text, false);

    update public.vendedores v set settings = jsonb_set(
      coalesce(v.settings, '{}'::jsonb), '{empresas_escolhidas}',
      coalesce(v.settings -> 'empresas_escolhidas', '[]'::jsonb) || to_jsonb(v_empresa.id::text))
    where v.id = v_originador
      and not coalesce(v.settings -> 'empresas_escolhidas' ? v_empresa.id::text, false);

    for r in
      select v.id,
             coalesce((select array_agg((x)::uuid)
                       from jsonb_array_elements_text(coalesce(v.settings -> 'empresas_escolhidas', '[]'::jsonb)) x),
                      '{}'::uuid[]) as ids
      from public.vendedores v where v.tipo = 'originador' and v.ativo
    loop
      perform public.app_sincronizar_carteira_originacao(r.id, r.ids);
    end loop;
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_empresa.id, 'cliente.gestao_alterada',
    jsonb_build_object(
      'resumo', case v_gestao
        when 'passivo' then 'Passou a ser gerida como conta PASSIVA.'
        when 'prospeccao_ativa' then 'Passou a ser trabalhada em prospecção ATIVA.'
        else 'Gestão de operação removida.' end
        || case when v_motivo is null then '' else ' Motivo: ' || v_motivo end,
      'gestao_operacao', v_gestao, 'vendedor_gestao_id', v_gestor,
      'vendedor_originacao_id', v_originador, 'motivo', v_motivo,
      -- §3: sempre para frente. A mudança vale a partir do dia seguinte; o que já converteu
      -- guarda a classificação do dia em que converteu, no próprio lançamento.
      'vigencia', 'a partir do dia seguinte'),
    v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cliente.gestao_alterada', 'empresas', v_empresa.id::text, p);

  return v_empresa;
end $function$;

-- ─── §2 As passivas que já existiam ─────────────────────────────────────────
--
-- `desde` copiado da linha de `gestao_passiva` que ele espelha, e não `now()`: a pessoa
-- assumiu a conta naquele dia, e é a partir dele que as cessões dela são dessa pessoa.
-- Datar por hoje jogaria fora tudo o que a conta converteu desde então.
--
-- Só as VIGENTES. Espelhar a cadeia histórica inteira criaria titularidades para gente
-- que já saiu da conta — e, na base de hoje, faria um SDR desligado ser o vendedor de
-- uma conta passiva por um mês, um papel que ele nunca teve.

insert into public.vendedor_carteira (vendedor_id, empresa_id, papel, desde, share_pct, origem)
select c.vendedor_id, c.empresa_id, 'vendedor', c.desde, c.share_pct, 'automatica'
from public.vendedor_carteira c
join public.empresas e on e.id = c.empresa_id
where c.papel = 'gestao_passiva' and c.ate is null
  and e.gestao_operacao = 'passivo'
  and not exists (
    select 1 from public.vendedor_carteira x
    where x.empresa_id = c.empresa_id and x.papel = 'vendedor' and x.ate is null
  );

comment on column public.vendedor_carteira.papel is
  'originacao/gestao_passiva são do modelo 04g. O motor v2 lê `vendedor` (titular do '
  'SACADO) e `originador` (titular do CEDENTE). Em conta passiva, `vendedor` espelha '
  'automaticamente `gestao_passiva`; em prospecção ativa ele só existe se um gestor o '
  'definir à mão, e sem ele a parcela do vendedor simplesmente não é paga.';

-- ─── §3 O outro caminho que mexe na carteira passiva ────────────────────────
--
-- "Definir gestão" é a ficha da empresa; `app_definir_carteira_passiva` é a tela do
-- VENDEDOR, onde o gestor marca de uma vez o conjunto de contas dele. Foi por ela que a
-- carteira passiva mudou de dono em 03/09/2026. Espelhar só num dos dois caminhos
-- deixaria o titular do sacado certo pela ficha e ausente pela carteira — e a diferença
-- só apareceria na folha.
--
-- Duas correções entram junto, pelo mesmo motivo (esta função decide taxa agora):
--
--   histórico   Ela mudava `gestao_operacao` sem escrever `gestao_operacao_historico`.
--               `gestaoNaData` lê o histórico para saber a classificação VIGENTE NA DATA
--               da cessão; uma mudança que não deixa registro faz o passado ser
--               reprecificado pelo presente, em silêncio.
--
--   motivo      `motivo` é not null na tabela, e aqui não há campo de texto na tela. O
--               texto gerado diz o que de fato aconteceu — quem entrou ou saiu de qual
--               carteira —, que é a pergunta que a contestação de folha faz.

create or replace function public.app_definir_carteira_passiva(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_vendedor uuid := (p ->> 'vendedor_id')::uuid;
  v_ids uuid[] := coalesce(
    (select array_agg((x)::uuid) from jsonb_array_elements_text(coalesce(p -> 'empresa_ids', '[]'::jsonb)) x),
    '{}'::uuid[]);
  v_tipo text;
  v_nome text;
  v_invalida text;
  v_removidas int := 0;
  v_add int := 0;
  v_antes text;
  r record;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores mudam carteira.' using errcode = '42501';
  end if;

  select tipo, nome into v_tipo, v_nome from public.vendedores where id = v_vendedor;
  if v_tipo is null then
    raise exception 'Vendedor não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_tipo <> 'vendedor' then
    raise exception 'Carteira de contas passivas é do closer — este vendedor é %.', v_tipo
      using errcode = '22023';
  end if;

  -- Recusa o LOTE inteiro se alguma não puder ser passiva. Gravar as boas e ignorar as
  -- ruins deixaria a tela mostrando um sucesso que não corresponde ao que foi salvo.
  select string_agg(coalesce(e.razao_social, e.cnpj), ', ') into v_invalida
  from public.empresas e
  where e.id = any(v_ids) and e.estagio not in ('cliente', 'ex_cliente');
  if v_invalida is not null then
    raise exception 'Só cliente ou ex-cliente pode ser conta passiva. Fora da régua: %.', v_invalida
      using errcode = '22023';
  end if;

  -- Saíram: fecha a vigência e devolve a empresa a "não definido".
  for r in
    select c.empresa_id from public.vendedor_carteira c
    where c.vendedor_id = v_vendedor and c.papel = 'gestao_passiva' and c.ate is null
      and not (c.empresa_id = any(v_ids))
  loop
    update public.vendedor_carteira set ate = now()
    where empresa_id = r.empresa_id and papel = 'gestao_passiva' and ate is null;
    -- O espelho sai junto, e só ele: um titular que um gestor pôs à mão continua sendo
    -- dele mesmo quando a conta deixa de ser passiva.
    update public.vendedor_carteira set ate = now()
    where empresa_id = r.empresa_id and papel = 'vendedor' and ate is null
      and origem = 'automatica';

    select gestao_operacao into v_antes from public.empresas where id = r.empresa_id;
    update public.empresas set
      gestao_operacao = null, gestao_definida_por = null, gestao_definida_em = null
    where id = r.empresa_id;
    if v_antes is distinct from null then
      insert into public.gestao_operacao_historico
        (empresa_id, valor_anterior, valor_novo, motivo, alterado_por)
      values (r.empresa_id, v_antes, 'nenhum',
              'Saiu da carteira de contas passivas de ' || coalesce(v_nome, 'um closer') || '.',
              v_ator);
    end if;

    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (r.empresa_id, 'cliente.gestao_alterada',
      jsonb_build_object('resumo', 'Saiu da carteira de contas passivas — gestão não definida.',
        'gestao_operacao', null, 'vendedor_gestao_id', v_vendedor), v_ator);
    v_removidas := v_removidas + 1;
  end loop;

  -- Entraram (ou trocaram de dono): a empresa passa a passiva e a vigência vira dele.
  for r in
    select e.id from public.empresas e
    where e.id = any(v_ids)
      and not exists (
        select 1 from public.vendedor_carteira c
        where c.empresa_id = e.id and c.papel = 'gestao_passiva' and c.ate is null
          and c.vendedor_id = v_vendedor
      )
  loop
    update public.vendedor_carteira set ate = now()
    where empresa_id = r.id and papel = 'gestao_passiva' and ate is null;
    update public.vendedor_carteira set ate = now()
    where empresa_id = r.id and papel = 'vendedor' and ate is null
      and origem = 'automatica' and vendedor_id is distinct from v_vendedor;

    select gestao_operacao into v_antes from public.empresas where id = r.id;
    update public.empresas set
      gestao_operacao = 'passivo', gestao_definida_por = v_ator, gestao_definida_em = now()
    where id = r.id;
    if v_antes is distinct from 'passivo' then
      insert into public.gestao_operacao_historico
        (empresa_id, valor_anterior, valor_novo, motivo, alterado_por)
      values (r.id, v_antes, 'passivo',
              'Entrou na carteira de contas passivas de ' || coalesce(v_nome, 'um closer') || '.',
              v_ator);
    end if;

    insert into public.vendedor_carteira (vendedor_id, empresa_id, papel)
    values (v_vendedor, r.id, 'gestao_passiva');
    -- O titular do sacado. `not exists` porque um manual vigente vence o espelho, e
    -- porque o índice único não sabe distinguir os dois.
    insert into public.vendedor_carteira (vendedor_id, empresa_id, papel, origem)
    select v_vendedor, r.id, 'vendedor', 'automatica'
    where not exists (
      select 1 from public.vendedor_carteira c
      where c.empresa_id = r.id and c.papel = 'vendedor' and c.ate is null
    );

    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (r.id, 'cliente.gestao_alterada',
      jsonb_build_object('resumo', 'Entrou na carteira de contas passivas de um closer.',
        'gestao_operacao', 'passivo', 'vendedor_gestao_id', v_vendedor), v_ator);
    v_add := v_add + 1;
  end loop;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comercial.carteira_passiva_definida', 'vendedores', v_vendedor::text, p);

  return jsonb_build_object('adicionadas', v_add, 'removidas', v_removidas,
                            'total', coalesce(array_length(v_ids, 1), 0));
end $$;

-- ─── §4 As titularidades que já nasceram tarde demais ───────────────────────
--
-- `abrirTitularidade` gravava `desde = now()`, e `titularesNaData` exige
-- `desde <= evento`. As cinco titularidades automáticas de `originador` da base foram
-- todas criadas DEPOIS da cessão que as criou — entre 0,8 segundo (as duas da Ribeiro
-- Caram, abertas pelo handler live) e seis dias (as do cron diário). Nenhuma delas
-- alcançava a própria cessão, e como o backfill reprocessa com o mesmo `convertida_em`,
-- ele nunca fechava o buraco: repetia-o.
--
-- O código já foi corrigido (passa o instante do fato). Estas são as linhas que ficaram.
-- `gatilho` é a última conversão daquele cedente em ou antes do `desde` atual — que é,
-- por construção do §4 do motor, exatamente a cessão que abriu o vínculo. Onde não houver
-- gatilho identificável a linha fica como está: inventar uma data anterior daria ao
-- titular cessões que ele não trouxe.

update public.vendedor_carteira c
   set desde = (
         select max(a.convertida_em)
         from public.antecipacoes a
         join public.empresas e on e.id = c.empresa_id
         where a.fornecedor_cnpj = e.cnpj
           and a.convertida_em is not null and a.regrediu_em is null
           and a.convertida_em <= c.desde
       )
 where c.papel = 'originador' and c.origem = 'automatica'
   and exists (
     select 1 from public.antecipacoes a
     join public.empresas e on e.id = c.empresa_id
     where a.fornecedor_cnpj = e.cnpj
       and a.convertida_em is not null and a.regrediu_em is null
       and a.convertida_em < c.desde
   );

-- ─── §5 O espelho vale desde que a CONTA entrou, não desde a última troca ───
--
-- O §2 copiou o `desde` da linha vigente de `gestao_passiva`. Nas duas contas passivas da
-- base isso datava o titular em 03/09/2026 15:36 — a hora em que a carteira mudou de dono
-- —, e as duas cessões da HALSTEN daquele mesmo dia converteram às 13:32 e às 14:19.
-- Duas horas antes, numa janela cujo titular anterior era um SDR desligado, que nunca
-- seria elegível a este papel.
--
-- O papel `vendedor` não existia até esta migração: não há data verdadeira a preservar,
-- há uma a escolher. A escolha é o começo da CADEIA de vigências de `gestao_passiva` —
-- quando a conta entrou na carteira passiva e não saiu mais. Uma conta que saiu e voltou
-- meses depois não é a mesma relação, e por isso a cadeia é percorrida por encaixe
-- (`ate` de uma = `desde` da outra) em vez de um `min(desde)` que atravessaria o buraco.

with recursive cadeia as (
  select c.id as vigente_id, c.empresa_id, c.desde
  from public.vendedor_carteira c
  where c.papel = 'gestao_passiva' and c.ate is null
  union all
  select ch.vigente_id, p.empresa_id, p.desde
  from public.vendedor_carteira p
  join cadeia ch on p.empresa_id = ch.empresa_id
  where p.papel = 'gestao_passiva' and p.ate = ch.desde
),
inicio as (
  select empresa_id, min(desde) as desde from cadeia group by empresa_id
)
update public.vendedor_carteira c
   set desde = i.desde
  from inicio i
 where c.empresa_id = i.empresa_id
   and c.papel = 'vendedor' and c.origem = 'automatica' and c.ate is null
   and i.desde < c.desde;

-- ─── §6 Competência fechada, agora no BANCO ─────────────────────────────────
--
-- "Uma competência fechada é imutável" era doutrina em três comentários e uma checagem
-- dentro de `app_ajuste_manual_comissao`. Todo o resto — handler live, backfill, fila do
-- SDR — inseria por service role, sem nada no caminho. A invariante mais cara do módulo
-- dependia de cada chamador lembrar dela.
--
-- Vale a pena aqui e não só no job porque o job é UM dos caminhos, e porque o banco é o
-- único lugar onde a regra continua valendo enquanto a versão do worker em produção não
-- é a mesma do repositório. `app_ajuste_manual_comissao` já recusa antes, com mensagem
-- melhor; este é o piso.

create or replace function public.comissao_lancamento_competencia_aberta()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.app_competencia_fechada(new.competencia) then
    raise exception
      'A competência de % já foi fechada — um lançamento novo dela entra como ajuste manual no mês corrente.',
      to_char(new.competencia, 'MM/YYYY') using errcode = '22023';
  end if;
  return new;
end $$;

revoke execute on function public.comissao_lancamento_competencia_aberta() from public, anon, authenticated;

create trigger comissao_lancamentos_v2_competencia_aberta_trg
  before insert on public.comissao_lancamentos_v2
  for each row execute function public.comissao_lancamento_competencia_aberta();
