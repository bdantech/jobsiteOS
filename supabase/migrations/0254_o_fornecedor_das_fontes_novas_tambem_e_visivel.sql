/*
 * Dois defeitos da vinda das fontes novas, e a mesma causa nos dois: uma regra
 * escrita quando NF era a única fonte não foi reapresentada às outras duas.
 *
 * ── 1. `app_fornecedor_visivel` só conhecia NF ──────────────────────────────
 * O relato: o originador clica em "enriquecer" num fornecedor e recebe "Este
 * fornecedor não está na sua carteira" — num fornecedor que não está na carteira
 * de NINGUÉM. A recusa não vinha de carteira: vinha de a função não saber que a
 * pré-autorização e a parcela do Sienge existem.
 *
 *   app_gestor_comercial()                          -> não, ele é originador
 *   fornecedores_funil.originador_id                -> não: aquela tabela é
 *                                                      construída SÓ de `notas_funil`
 *                                                      (atualizar-funil.ts), e um
 *                                                      fornecedor que chegou por
 *                                                      título nunca entra nela
 *   exists (notas_fiscais where fornecedor_cnpj)    -> não: ele não emitiu nota
 *
 * Três ramos, três nãos, e nenhum deles é sobre carteira. Medido na conta do
 * Rodrigo: dos 135 fornecedores que chegam ao funil dele por título ou
 * pré-autorização, 43 tinham o enriquecimento RECUSADO — e a mensagem culpava a
 * carteira nos 43.
 *
 * É o mesmo defeito que a 0242 corrigiu em `mercado_universo` ("o universo enxerga
 * as fontes novas"), na função que ninguém lembrou de visitar no mesmo dia.
 *
 * ── O RECORTE NÃO MUDA, E ISSO É DELIBERADO ─────────────────────────────────
 * A função é SECURITY DEFINER, então os EXISTS não pagam RLS: o ramo de NF já
 * significava hoje "existe QUALQUER nota deste fornecedor", não "existe uma que
 * você vê". Os dois ramos novos são cópia literal desse critério para as outras
 * duas fontes. Estreitar o ramo antigo para "só o que a RLS deixa" é outra
 * decisão, de segurança e não de bug, e não se toma escondida numa correção.
 *
 * ── 2. Documento ENCERRADO não pode esconder oportunidade ABERTA ────────────
 * A dedup carregava como possíveis "originais" toda NF e todo título com
 * `estagio_funil not in ('convertida','perdida')` — lista que ESQUECE `expirada`.
 * Consequência medida: 22 pré-autorizações em `a_prospectar` escondidas atrás de
 * um original expirado (20 títulos e 2 NFs). O card saía das colunas abertas do
 * Kanban e reaparecia em Encerradas, atrás de um documento que ninguém mais olha.
 *
 * O `deduplicar.ts` já dizia a regra certa em português — "uma nota convertida ou
 * perdida não pode esconder uma pré-autorização: ela já saiu do funil" — e
 * `expirada` saiu do funil pela mesma porta. A lista estava incompleta, não a
 * regra; a correção do job passa a usar `ESTAGIOS_ENCERRADOS` inteiro.
 *
 * Esta migração NÃO refaz a dedup — o job recompõe tudo a cada corrida, por
 * desenho. Ela só devolve agora o que está escondido errado, para que ninguém
 * espere a madrugada por cards que já deviam estar na tela.
 */

-- ── 1. A função aprende as três fontes ─────────────────────────────────────

create or replace function public.app_fornecedor_visivel(p_cnpj text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
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
    or (
      public.app_tem_modulo('antecipacao')
      and (
        exists (
          select 1 from public.notas_fiscais nf where nf.fornecedor_cnpj = p_cnpj
        )
        -- As duas fontes novas, pela ponta FORNECEDOR de cada uma. No título essa
        -- ponta é o CREDOR, e credor pessoa física não tem CNPJ: `= p_cnpj` já o
        -- deixa fora sem precisar de guarda.
        or exists (
          select 1 from public.pre_autorizacoes pa where pa.fornecedor_cnpj = p_cnpj
        )
        or exists (
          select 1 from public.sienge_titulos st where st.credor_cnpj = p_cnpj
        )
      )
    );
$$;

comment on function public.app_fornecedor_visivel(text) is
  'O fornecedor que este usuário alcança: gestor vê todos, o originador vê os do '
  'funil dele, e quem tem `antecipacao` vê quem aparece em ALGUMA das três fontes. '
  'As duas últimas entraram na 0254: sem elas o fornecedor que chegou por título ou '
  'pré-autorização recebia "não está na sua carteira" — 43 na conta do Rodrigo.';

-- Os índices que os dois EXISTS novos usam já existem: `pre_autorizacoes_partes_idx`
-- começa em `fornecedor_cnpj` e `sienge_titulos_credor_idx` é exatamente `credor_cnpj`.

-- ── 2. Devolver o que original encerrado escondeu ──────────────────────────

/*
 * TUDO por `exists` correlato, e nenhum `join` — é a MESMA armadilha que a 0248
 * registrou para o `update`, e ela vale igual para o `delete`: um `left join` cujo
 * `on` aponta para a tabela ALVO é recusado pelo Postgres com
 * "invalid reference to FROM-clause entry". Custou uma aplicação recusada aqui
 * também, com a nota da 0248 três linhas acima.
 */

-- O selo pendurado no encerrado sai PRIMEIRO: ele é lido pela ocultação que o
-- delete seguinte apaga, então a ordem das duas instruções é load-bearing.
delete from public.funil_selos_preauth s
 where exists (
   select 1 from public.funil_ocultacoes o
    where o.tipo = 'pre_autorizacao'
      and o.referencia_id = s.pre_autorizacao_id::text
      and o.original_tipo = s.tipo
      and o.original_id = s.referencia_id
      and (
        (o.original_tipo = 'titulo' and exists (
            select 1 from public.sienge_titulos st
             where st.id_externo::text = o.original_id
               and st.estagio_funil in ('convertida', 'perdida', 'expirada')))
        or (o.original_tipo = 'nf' and exists (
            select 1 from public.notas_fiscais nf
             where nf.access_key = o.original_id
               and nf.estagio_funil in ('convertida', 'perdida', 'expirada')))
      )
 );

delete from public.funil_ocultacoes o
 where o.tipo = 'pre_autorizacao'
   and (
     (o.original_tipo = 'titulo' and exists (
         select 1 from public.sienge_titulos st
          where st.id_externo::text = o.original_id
            and st.estagio_funil in ('convertida', 'perdida', 'expirada')))
     or (o.original_tipo = 'nf' and exists (
         select 1 from public.notas_fiscais nf
          where nf.access_key = o.original_id
            and nf.estagio_funil in ('convertida', 'perdida', 'expirada')))
   );

-- O mesmo espelho da 0248, e pelo mesmo motivo: `origem_exibida` acompanha
-- `funil_ocultacoes`.
update public.pre_autorizacoes t
   set origem_exibida = true, original_tipo = null, original_id = null
 where not t.origem_exibida
   and not exists (select 1 from public.funil_ocultacoes o
                    where o.tipo = 'pre_autorizacao' and o.referencia_id = t.id_externo::text);
