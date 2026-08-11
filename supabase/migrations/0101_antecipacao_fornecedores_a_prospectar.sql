-- =============================================================================
-- 0101 — Antecipação: "fornecedores a prospectar"
--
-- A tela irmã de `antecipacao_sacados_a_prospectar` (0056/0065), com o funil
-- invertido. Lá a pergunta é "que CONSTRUTORA recebe nota e não é nossa?"; aqui é
-- "que FORNECEDOR emite contra construtora que JÁ é nossa e ainda não está na
-- plataforma?".
--
-- O QUE QUALIFICA O LEAD é o sacado já ser cadastrado, e é o equivalente exato do
-- que o CNAE faz na lista de sacados: separa oportunidade de ruído. Um fornecedor
-- que emite contra uma construtora nossa tem o caminho de antecipação já aberto do
-- outro lado — limite analisado, relação conhecida, sacado que atende o telefone.
-- Sem esse recorte a lista viraria "todo CNPJ que já emitiu uma nota".
--
-- A JANELA DE 90 DIAS mora na view, não na tela. É recência, não filtro de
-- conveniência: fornecedor que emitiu contra nosso sacado no ano passado e parou
-- não é lead, é histórico — e ele infla a contagem por cima de quem está emitindo
-- agora. Como a lista é ordenada por VOLUME DE NOTAS, deixar a janela aberta
-- premiaria justamente o passado.
--
-- ONDE O CADASTRO MORA: `mercado_universo`, mesma fonte da lista de sacados. Aqui
-- não há a espera do lookup que existe lá — 5.503 dos 5.514 fornecedores da janela
-- já têm razão social, município e CNAE. Isso porque o join é oportunista: quem
-- não estiver no universo entra na lista assim mesmo, com o nome que veio na NF.
-- Sem CNAE não se perde ninguém, porque não existe portão de CNAE nesta lista.
--
-- RLS: nenhuma policy nova. `notas_funil` é security_invoker e a de
-- `mercado_universo` (0060) já libera, para quem tem `antecipacao`, as linhas cujo
-- CNPJ aparece numa nota que a pessoa pode ler — e ela cobre `fornecedor_cnpj`
-- explicitamente, não só o sacado.
-- =============================================================================

create view public.antecipacao_fornecedores_a_prospectar
with (security_invoker = true) as
  select
    f.fornecedor_cnpj,

    -- A razão social do cadastro ganha do nome da NF, mesma razão de 0056: o da
    -- nota é o que o emitente digitou, e vem abreviado com frequência.
    max(coalesce(fu.razao_social, f.fornecedor_nome)) as fornecedor_nome,

    -- Não-cadastrado NÃO quer dizer sem ficha: 189 notas têm `empresa_id` de um
    -- fornecedor já promovido à mão. É o que decide, na tela, entre "Ficha" e
    -- "Promover".
    (array_agg(f.fornecedor_empresa_id) filter (where f.fornecedor_empresa_id is not null))[1]
      as fornecedor_empresa_id,

    max(f.fornecedor_uf) as fornecedor_uf,
    max(fu.municipio) as fornecedor_municipio,
    max(fu.cnae_principal) as fornecedor_cnae_principal,

    -- 22 dos 5.514 estão inapta/baixada/suspensa. São poucos, e é exatamente o
    -- tipo de lead em que não se gasta uma ligação.
    max(fu.situacao_cadastral) as fornecedor_situacao_cadastral,

    -- A ORDENAÇÃO PADRÃO DA TELA. Quem mais emite contra nossos sacados primeiro.
    count(*)::int as notas,

    -- Quantas dessas notas a regra de natureza de operação (0061) deixa operar.
    -- 85 fornecedores da janela têm ZERO — a contagem alta deles é uma promessa
    -- que não se cumpre, e sem esta coluna nada na tela diria isso.
    count(*) filter (where f.operavel)::int as notas_operaveis,

    -- Contra quantos sacados NOSSOS ele emite. Dois sacados em comum é uma
    -- abordagem com duas portas.
    count(distinct f.sacado_cnpj)::int as sacados,

    sum(f.valor) as valor_agregado,
    max(f.emitida_em) as ultima_nota_em,
    min(f.emitida_em) as primeira_nota_em
  from public.notas_funil f
    left join public.mercado_universo fu on fu.cnpj = f.fornecedor_cnpj
  where f.sacado_cadastrado
    and f.emitida_em >= (now() - interval '90 days')
  group by f.fornecedor_cnpj
  -- O "não cadastrado" é decidido no GRUPO, não na linha. Dois CNPJs da janela
  -- aparecem com `fornecedor_cadastrado` true numa nota e false noutra (o flag vem
  -- do endpoint, por nota). Filtrar por linha deixaria os dois na lista com as
  -- notas "false" — um fornecedor cadastrado numa aba de não-cadastrados, com as
  -- contagens erradas por baixo. Aqui, uma nota cadastrada elimina o CNPJ inteiro.
  --
  -- De quebra é mais barato que o `not exists` sobre `notas_fiscais`: 300ms contra
  -- 1,2s, porque não há anti-join — a informação já está nas linhas agregadas.
  having not bool_or(f.fornecedor_cadastrado);

grant select on public.antecipacao_fornecedores_a_prospectar to authenticated;

comment on view public.antecipacao_fornecedores_a_prospectar is
  'Fornecedores que NÃO estão na plataforma e emitiram NF contra sacado que JÁ '
  'está, nos últimos 90 dias, ranqueados por número de notas. O espelho de '
  'antecipacao_sacados_a_prospectar: lá o lead é a construtora que recebe, aqui é '
  'quem emite para as construtoras que já são nossas.';

comment on column public.antecipacao_fornecedores_a_prospectar.notas is
  'Notas emitidas contra sacados cadastrados nos últimos 90 dias. É a ordenação '
  'padrão da lista — quem mais emite, primeiro.';

comment on column public.antecipacao_fornecedores_a_prospectar.notas_operaveis is
  'Quantas dessas notas passam na regra de natureza de operação (0061). Zero com '
  '"notas" alto é um lead que a operação não consegue atender.';

comment on column public.antecipacao_fornecedores_a_prospectar.sacados is
  'Sacados cadastrados distintos contra os quais ele emitiu na janela. Cada um é '
  'uma porta de entrada para a abordagem.';

comment on column public.antecipacao_fornecedores_a_prospectar.fornecedor_empresa_id is
  'Não nulo quando o fornecedor já foi promovido a `empresas` à mão — tem ficha, '
  'mas continua fora da plataforma.';
