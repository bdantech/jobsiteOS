-- ═════════════════════════════════════════════════════════════════════════════
-- 0249 — A ficha nasce das três fontes, e o enriquecimento vem atrás
--
-- ─── O QUE ACONTECIA ────────────────────────────────────────────────────────
-- "Criar ficha" num fornecedor que veio de PRÉ-AUTORIZAÇÃO respondia
-- **"Registro não encontrado."** — e a frase não descrevia nada que a pessoa pudesse
-- resolver.
--
-- Por trás havia duas recusas, as duas com `errcode = 'no_data_found'`, que o tradutor
-- de erros do core mapeia para essa mesma frase genérica:
--
--   1. «Este CNPJ não é fornecedor de nenhuma nota.»
--   2. «Cadastro deste CNPJ ainda não foi enriquecido.»
--
-- A primeira é um recorte que envelheceu. O funil tinha UMA fonte quando esta função
-- foi escrita; desde a 0233 tem três — nota fiscal, pré-autorização e título Sienge —,
-- unidas em `funil_oportunidades`. O card aparecia pelas três, e o botão só funcionava
-- para uma. Medido hoje: dos 435 fornecedores com pré-autorização, **261 não aparecem em
-- nota nenhuma**.
--
-- A segunda transformava uma lacuna temporária em porta fechada. `mercado_universo` não
-- é "todos os CNPJs do Brasil": são 908 mil linhas do recorte de construção (CNAE 41/42/43
-- e vizinhança). Um fornecedor de plástico, de fôrmas ou de importação não está lá — e
-- **não deve estar**, porque a pirâmide comercial lê essa tabela. Dos mesmos 435, só 181
-- existem no universo.
--
-- E o dado existe: `lookupCadastral` (§3.1 da Antecipação) busca cadastro em três APIs
-- públicas gratuitas exatamente para esse caso, e grava com `origem_ingestao = 'lookup'`
-- e `fora_recorte_cnae = true`. Recusar a ficha porque o lookup ainda não rodou é fechar
-- a porta na frente da fila que existe para abri-la.
--
-- ─── O QUE MUDA ─────────────────────────────────────────────────────────────
-- 1. O recorte passa a ser AS TRÊS FONTES do funil. Continua sendo um recorte de
--    verdade — a função é SECURITY DEFINER e não pode virar "crie empresa com qualquer
--    CNPJ" —, só que agora ele cobre o mesmo conjunto que a tela mostra.
-- 2. Universo ausente deixa de ser recusa: a ficha nasce com o que a fonte do funil sabe
--    (CNPJ e nome), e o CNPJ entra em `cnpj_lookup_fila`. Quando o lookup responder, a
--    linha do universo aparece e a ficha ganha todo o resto — é o mesmo caminho por onde
--    passa qualquer fornecedor que chega por nota.
-- 3. `tipo = 'fornecedor'` continua vindo do código e nunca do cliente. Era isso que
--    impedia este caminho de envenenar a pirâmide, e segue impedindo.
--
-- ─── O ELO QUE SE PERDIA DEPOIS ─────────────────────────────────────────────
-- `gravarNoUniverso` (worker) faz upsert em `mercado_universo` sem preencher
-- `empresa_id`. Quem promove ANTES do lookup — que passa a ser o caso comum — fica com a
-- ficha de um lado, a linha do universo do outro e nada ligando as duas: o Explorador
-- continua oferecendo "promover" a quem já foi promovido. A 0072 reparou isso uma vez;
-- hoje são **199 linhas** de novo. O worker passou a ligar na hora da gravação, e esta
-- migração repara o acumulado.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── `motivo` diz por que fomos buscar o cadastro ───────────────────────────
--
-- A lista atual (`fornecedor_nf`, `sacado_nf`, `manual`) foi lida do banco vivo, não da
-- migração que a criou — recriar um CHECK a partir do texto original apaga os valores que
-- migrações posteriores acrescentaram.
--
-- `api_credito` entra porque já É usado: a rota de criação de análise da plataforma de
-- produção enfileira com esse motivo, e o CHECK a recusava em silêncio (o upsert não
-- confere o erro). Uma empresa criada por lá nunca entrava na fila de lookup.
alter table public.cnpj_lookup_fila drop constraint if exists cnpj_lookup_fila_motivo_check;
alter table public.cnpj_lookup_fila add constraint cnpj_lookup_fila_motivo_check
  check (motivo in ('fornecedor_nf', 'sacado_nf', 'manual', 'fornecedor_funil', 'api_credito'));

create or replace function public.app__promover_fornecedor_para_empresa(
  p_cnpj text,
  p_ator uuid,
  p_origem text
) returns public.empresas language plpgsql security definer set search_path = '' as $function$
declare
  v_universo public.mercado_universo;
  v_empresa public.empresas;
  v_nome text;
  v_enfileirou boolean := false;
begin
  if p_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;

  /*
   * O RECORTE: você promove quem você já podia ler — nas TRÊS fontes do funil (0233).
   *
   * Até aqui era só `notas_fiscais`, e o card de pré-autorização batia numa porta que a
   * própria tela tinha aberto. As três leituras são por índice e param na primeira linha.
   */
  if not exists (select 1 from public.notas_fiscais nf where nf.fornecedor_cnpj = p_cnpj)
     and not exists (select 1 from public.pre_autorizacoes pa where pa.fornecedor_cnpj = p_cnpj)
     and not exists (select 1 from public.sienge_titulos st where st.credor_cnpj = p_cnpj)
  then
    raise exception
      'Este CNPJ não aparece em nenhuma nota, pré-autorização ou título — não há de onde criar a ficha.'
      using errcode = 'no_data_found';
  end if;

  -- O nome que a fonte do funil conhece. Serve de ponte até o lookup responder: uma ficha
  -- só com CNPJ é uma linha que ninguém reconhece na lista.
  select coalesce(
    (select nf.fornecedor_nome from public.notas_fiscais nf
      where nf.fornecedor_cnpj = p_cnpj and nf.fornecedor_nome is not null limit 1),
    (select pa.fornecedor_nome from public.pre_autorizacoes pa
      where pa.fornecedor_cnpj = p_cnpj and pa.fornecedor_nome is not null limit 1),
    (select st.credor_nome from public.sienge_titulos st
      where st.credor_cnpj = p_cnpj and st.credor_nome is not null limit 1)
  ) into v_nome;

  select * into v_universo from public.mercado_universo where cnpj = p_cnpj;

  /*
   * UNIVERSO AUSENTE NÃO É RECUSA — é uma lacuna com fila própria.
   *
   * `mercado_universo` é o recorte de construção, e o fornecedor de material, de
   * equipamento ou de serviço não está nele por desenho. `lookupCadastral` existe
   * exatamente para esses: busca em API pública e grava com `fora_recorte_cnae = true`,
   * de onde a Company 360, a régua de faixas e o resto passam a enxergar.
   *
   * Enfileirar aqui é o que faz a promessa da tela ser verdadeira: a ficha aparece agora
   * e o enriquecimento chega atrás, sozinho.
   */
  if v_universo.cnpj is null then
    insert into public.cnpj_lookup_fila (cnpj, motivo)
    values (p_cnpj, 'fornecedor_funil')
    on conflict (cnpj) do nothing;
    v_enfileirou := true;
  end if;

  /*
   * IDEMPOTENTE, E AGORA PELO CNPJ — não só pelo elo do universo.
   *
   * A saída antecipada dependia de `mercado_universo.empresa_id`, que é justamente o que
   * NÃO existe no caso novo (universo ausente). O segundo clique então caía adiante,
   * encontrava a ficha, não inseria nada… e emitia um segundo `empresa.promovida`. Uma
   * timeline que diz duas vezes que a empresa foi promovida descreve um fato que
   * aconteceu uma vez — e é assim que uma timeline deixa de ser confiável.
   *
   * O elo do universo continua sendo reparado aqui: quem promoveu antes do lookup passa
   * por este caminho quando clica de novo, e é a chance de ligar as duas pontas.
   */
  if v_universo.empresa_id is not null then
    select * into v_empresa from public.empresas where id = v_universo.empresa_id;
    if v_empresa.id is not null then return v_empresa; end if;
  end if;

  select * into v_empresa from public.empresas where cnpj = p_cnpj;
  if v_empresa.id is not null then
    update public.mercado_universo set empresa_id = v_empresa.id
    where cnpj = p_cnpj and empresa_id is null;
    return v_empresa;
  end if;

  insert into public.empresas (
    cnpj, razao_social, nome_fantasia, tipo, estagio,
    uf, municipio, cnae_principal, porte,
    camada, grupo_id, is_spe, grafo_sefaz, origem
  )
  values (
    p_cnpj,
    -- O universo manda quando existe; o nome do funil é a ponte quando não existe.
    coalesce(v_universo.razao_social, v_nome),
    v_universo.nome_fantasia,
    -- Nunca vem do cliente: é o que impede este caminho de envenenar a pirâmide
    -- comercial, os segmentos e o TAM, que leem esta coluna.
    'fornecedor', 'mercado',
    v_universo.uf, v_universo.municipio, v_universo.cnae_principal, v_universo.porte_rfb,
    -- Todas nulas quando o universo ainda não respondeu, e é o certo: camada e grupo
    -- são leitura do universo, e inventá-las aqui colocaria a empresa numa pirâmide
    -- onde ela não foi medida.
    v_universo.camada, v_universo.grupo_id,
    coalesce(v_universo.is_spe, false), coalesce(v_universo.grafo_sefaz, false),
    p_origem
  )
  returning * into v_empresa;

  -- No-op quando a linha do universo ainda não existe. Quando ela chegar pelo lookup, é o
  -- worker que liga as duas (`gravarNoUniverso`).
  update public.mercado_universo set empresa_id = v_empresa.id where cnpj = p_cnpj;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa.id, 'empresa.promovida',
    jsonb_build_object(
      'titulo', 'Ficha criada a partir do funil',
      'resumo', coalesce(v_empresa.razao_social, v_empresa.cnpj)
                || ' foi promovida a partir do funil de ' || p_origem || '.'
                || case when v_enfileirou
                     then ' O cadastro ainda não estava no universo: entrou na fila de enriquecimento.'
                     else '' end,
      'camada', v_universo.camada,
      'origem', p_origem,
      'aguardando_lookup', v_enfileirou
    ),
    p_ator
  );

  return v_empresa;
end $function$;

comment on function public.app__promover_fornecedor_para_empresa is
  'Núcleo da promoção de fornecedor a `empresas`. Interna (app__, sem grant): o gate de '
  'módulo é de quem chama. Sempre tipo=fornecedor, sempre a partir de CNPJ que já aparece '
  'em nota, pré-autorização ou título Sienge (0249). Cadastro fora de `mercado_universo` '
  'não impede a ficha — entra em `cnpj_lookup_fila` e o enriquecimento chega depois.';

-- ─── O elo perdido, reparado (de novo) ──────────────────────────────────────
--
-- Mesma reparação da 0072, pelo mesmo motivo e com a mesma forma: o Explorador só chega à
-- ficha por `mercado_universo.empresa_id`, e sem ele continua oferecendo "promover" a quem
-- já foi promovido. Da 0072 para cá o buraco reabriu porque o lookup grava a linha do
-- universo sem o elo — corrigido no worker no mesmo commit que esta migração.
update public.mercado_universo u
set empresa_id = e.id
from public.empresas e
where e.cnpj = u.cnpj and u.empresa_id is null;
