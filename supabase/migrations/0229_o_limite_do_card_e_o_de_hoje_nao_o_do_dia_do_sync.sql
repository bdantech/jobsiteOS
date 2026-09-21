-- ═════════════════════════════════════════════════════════════════════════════
-- 0229 — O limite do card é o de hoje, não o do dia em que a nota foi sincronizada
--
-- ─── O CARD ACUSAVA ESTOURO DE LIMITE DE QUEM TINHA LIMITE DE SOBRA ─────────
-- "Aprovado, mas o limite não cobre esta nota." A RIBEIRO CARAM tem limite de
-- sobra e o card dizia o contrário — numa tira âmbar, que é a forma que a tela
-- usa para dizer "pare".
--
-- `sacado_limite_cobre_nota` nasceu em 0046 como
--   coalesce(nf.credit_disponivel, 0) >= nf.valor
-- e `notas_fiscais.credit_disponivel` é, pelo comentário da própria coluna em
-- 0045, um "snapshot no momento do sync". O snapshot é POR NOTA: o sync grava o
-- disponível que a plataforma respondeu junto com AQUELA nota, no dia em que ela
-- passou pelo job.
--
-- E a nota para de passar. O plano de sync (`montarPlanoSync`) é incremental por
-- `sync_hours`, e a rede diária é uma varredura por EMISSÃO de 30 dias. Passados
-- 30 dias da emissão, nenhuma requisição alcança aquela nota de novo: o
-- `credit_disponivel` dela congela no valor daquele dia e fica lá enquanto ela
-- viver no funil — que, pelo prazo, é até 90 dias.
--
-- O disponível, porém, é a grandeza que MAIS se mexe do módulo: cai a cada
-- operação e volta a cada liquidação. Congelar o numerador de uma comparação e
-- deixar o denominador vivo produz exatamente o que se viu — um veredito
-- confiante sobre um número velho.
--
-- ─── O NÚMERO DE HOJE JÁ ESTÁ NO BANCO ──────────────────────────────────────
-- `analises_plataforma` tem uma linha por CNPJ com a análise corrente, mantida
-- pelo seu próprio job (`sync-analises-plataforma`), que varre a fonte inteira e
-- não depende de nota nenhuma ter sido tocada. É de lá que a 0225 passou a tirar
-- a taxa que a Ana fala em voz alta, pelo mesmo motivo: o que se DIZ ao cliente
-- não pode sair de um retrato de um mês atrás.
--
-- Esta migração termina a mudança da 0225: a taxa saiu da nota, o LIMITE ficou.
--
-- ─── E ELE PODE ESTAR NA MATRIZ ─────────────────────────────────────────────
-- Do contrato da fonte, no cabeçalho do job: "a análise é do documento da MATRIZ
-- — filial não gera linha". Um sacado que é filial ou SPE não tem análise
-- própria, e perguntar pelo CNPJ dele devolve vazio. A 0225 resolveu isso para a
-- taxa com `app_holding_do_sacado`; a escada aqui é a mesma, na mesma ordem: o
-- próprio sacado primeiro, a empresa-mãe depois.
--
-- ─── GRAVADO NA NOTA, E NÃO RESOLVIDO NA LEITURA ────────────────────────────
-- A tentação é a view resolver ao vivo, com um `left join lateral` por linha.
-- Não dá, e o porquê está medido em `queries.ts`: "app_holding_do_sacado custa
-- ~0,55 ms por CNPJ. Em notas_funil isso seriam 58 mil chamadas e meio minuto
-- contra o timeout de 8 s do PostgREST — o mesmo defeito que já derrubou a tela
-- de contas por comissão uma vez". E a `notas_funil` não é varrida só pela tela:
-- `antecipacao_fornecedores`, `antecipacao_a_prospectar` e o job de
-- reclassificação leem a view INTEIRA.
--
-- E não compraria frescor nenhum: `analises_plataforma.available_limit` é, ela
-- mesma, o que o último sync trouxe. Resolver por linha pagaria 58 mil vezes
-- para chegar no mesmo número que uma coluna gravada logo depois daquele sync.
--
-- Então a resolução é POR CNPJ e roda uma vez — na reclassificação, que já roda
-- todo dia e depois de cada sync, e que precisa do valor certo ANTES de aplicar
-- as regras de faixa (`sacado_limite_cobre_nota` é variável do motor).
--
-- ─── NULO PASSA A SER "NÃO SEI", E NÃO "NÃO COBRE" ──────────────────────────
-- O `coalesce(…, 0)` da definição antiga transformava ausência em zero, e zero
-- nunca cobre nada. Um sacado aprovado sem disponível conhecido recebia a tira de
-- alerta como se o limite tivesse estourado.
--
-- `sacado_limite_cobre_nota` passa a ser NULO quando não se sabe. As regras de
-- faixa não mudam de comportamento: em SQL, `null = true` já não casava, como
-- `false = true` não casava. Quem muda é a TELA, que para de afirmar.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── §1 A resolução, num lugar só ───────────────────────────────────────────
--
-- Função e não SQL solto, pelo motivo da 0225: a escada de fallback tem de ter
-- um dono, e duas cópias divergem na primeira vez que alguém mexer numa delas.
--
-- SEM portão de módulo, ao contrário de `app__condicao_publicada` (0227): esta
-- função não é lida de dentro de uma view de usuário. Ela é INTERNA — quem a
-- chama é o job, com service_role. Um `app_tem_modulo` aqui seria pior que
-- inútil: o worker não tem JWT de ninguém, o portão daria falso, e a atualização
-- apagaria o limite de todas as notas. O portão de quem LÊ é a RLS de
-- `notas_fiscais`, onde o valor vai ficar gravado.

create or replace function public.app__limite_da_analise(p_sacado_cnpj text)
returns table (disponivel numeric, limite numeric, origem text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_sacado_cnpj is null then
    return;
  end if;

  -- 1. A análise do PRÓPRIO sacado.
  return query
    select a.available_limit, a.credit_limit, 'sacado'::text
      from public.analises_plataforma a
     where a.cnpj = p_sacado_cnpj
       and a.status = 'approved'
       and a.available_limit is not null
     order by a.sincronizada_em desc nulls last
     limit 1;
  -- A escada é sequencial e não um UNION com desempate: `app_holding_do_sacado`
  -- custa ~0,55 ms por CNPJ, e pagá-la também para quem já achou a própria
  -- análise dobraria o custo do refresh sem mudar uma linha do resultado.
  if found then return; end if;

  -- 2. A da empresa-mãe. Filial e SPE não geram linha na fonte, então este é o
  --    único lugar onde o limite delas existe.
  return query
    select a.available_limit, a.credit_limit, 'holding'::text
      from public.analises_plataforma a
      join public.empresas e on e.cnpj = a.cnpj
     where e.id = public.app_holding_do_sacado(p_sacado_cnpj)
       and a.status = 'approved'
       and a.available_limit is not null
     order by a.sincronizada_em desc nulls last
     limit 1;
end $$;

comment on function public.app__limite_da_analise(text) is
  'O limite DISPONÍVEL de hoje para este sacado, da análise corrente da '
  'plataforma: a dele primeiro, a da empresa-mãe depois (filial e SPE não geram '
  'linha na fonte). Só de análise `approved`. Nulo quando não existe — e nulo '
  'aqui quer dizer "não sei", nunca "não tem". Interna: quem lê o número é a '
  'coluna que ela grava, sob a RLS de notas_fiscais.';

revoke execute on function public.app__limite_da_analise(text) from public, anon, authenticated;
grant execute on function public.app__limite_da_analise(text) to service_role;

-- ─── §2 Onde o número mora ──────────────────────────────────────────────────
--
-- Na nota, como `taxa_analise_am` (0225) e `tac_estimada` (0223) — e lida daqui
-- pela view sem custo nenhum por linha.

alter table public.notas_fiscais
  add column if not exists limite_disponivel_sacado numeric(14, 2),
  add column if not exists limite_sacado_origem text
    constraint notas_fiscais_limite_sacado_origem_check
      check (limite_sacado_origem is null or limite_sacado_origem in ('sacado', 'holding'));

comment on column public.notas_fiscais.limite_disponivel_sacado is
  'O limite disponível do sacado na análise corrente da plataforma, resolvido por '
  'app__limite_da_analise() e atualizado a cada reclassificação (0229). Distinto '
  'de `credit_disponivel`, que é o retrato do dia do sync DESTA nota.';
comment on column public.notas_fiscais.limite_sacado_origem is
  '`sacado` quando o limite é do próprio, `holding` quando veio da empresa-mãe. '
  'Nulo com o limite nulo.';

comment on column public.notas_fiscais.credit_disponivel is
  'Disponível que a plataforma respondeu NO DIA do sync desta nota. É histórico: '
  'congela quando a nota sai da janela de varredura (30 dias após a emissão). '
  'Quem quer o disponível de HOJE lê `limite_disponivel_sacado` (0229).';

-- ─── §3 O refresh, uma vez por CNPJ ─────────────────────────────────────────
--
-- Por SACADO e não por nota: um sacado com 400 notas no funil resolve uma vez e
-- escreve nas 400. É a diferença entre uns poucos milhares de chamadas e 58 mil.
--
-- Só notas VIVAS, como na 0223 e na 0225: mexer na estimativa de uma nota já
-- convertida mudaria o retrato de uma decisão já tomada.
--
-- O `is distinct from` no fim não é economia de digitação: sem ele todo refresh
-- reescreveria a tabela inteira, e o `atualizada_em` de 58 mil notas mudaria
-- todo dia sem que nada tivesse mudado.

create or replace function public.app__atualizar_limites_dos_sacados()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_total integer;
begin
  with sacados as (
    select distinct nf.sacado_cnpj as cnpj
      from public.notas_fiscais nf
     where nf.sacado_cnpj is not null
       and nf.estagio_funil not in ('convertida', 'perdida')
  ),
  resolvidos as (
    -- `left join lateral`, e não `cross`: o sacado sem análise nenhuma precisa
    -- CHEGAR ao update com nulo, senão o limite dele nunca é limpo quando a
    -- análise some do outro lado. Mesma forma da 0225.
    select s.cnpj, l.disponivel, l.origem
      from sacados s
      left join lateral public.app__limite_da_analise(s.cnpj) l on true
  )
  update public.notas_fiscais nf
     set limite_disponivel_sacado = r.disponivel,
         limite_sacado_origem = r.origem
    from resolvidos r
   where r.cnpj = nf.sacado_cnpj
     and nf.estagio_funil not in ('convertida', 'perdida')
     and (nf.limite_disponivel_sacado is distinct from r.disponivel
       or nf.limite_sacado_origem is distinct from r.origem);

  get diagnostics v_total = row_count;
  return v_total;
end $$;

comment on function public.app__atualizar_limites_dos_sacados() is
  'Regrava `notas_fiscais.limite_disponivel_sacado` das notas vivas a partir da '
  'análise corrente da plataforma, resolvendo UMA vez por sacado. Chamada pela '
  'reclassificação, antes das regras de faixa — `sacado_limite_cobre_nota` é '
  'variável do motor e precisa do número certo para decidir a faixa.';

revoke execute on function public.app__atualizar_limites_dos_sacados() from public, anon, authenticated;
grant execute on function public.app__atualizar_limites_dos_sacados() to service_role;

-- O que já está gravado, agora.
select public.app__atualizar_limites_dos_sacados();

-- ─── §4 A view lê o de hoje ─────────────────────────────────────────────────
--
-- A definição VIVA é lida e recebe três enxertos: as duas colunas antigas trocam
-- de expressão e a nova entra antes do `FROM`. Recolar a definição de um arquivo
-- antigo perderia o que as migrações seguintes acrescentaram — a 0225 acabou de
-- somar `taxa_analise_am` aqui.
--
-- Nenhum join novo: as três colunas saem de `nf`, que já está no FROM.

do $$
declare
  v_def text;
  v_ancora text := E'\n   FROM notas_fiscais nf';
  v_velho_disp text := 'nf.credit_disponivel AS sacado_limite_disponivel';
  v_velho_cobre text := 'COALESCE(nf.credit_disponivel, 0::numeric) >= nf.valor AS sacado_limite_cobre_nota';
begin
  select pg_get_viewdef('public.notas_funil'::regclass, true) into v_def;

  if position(v_ancora in v_def) = 0 then
    raise exception 'A âncora do FROM mudou em notas_funil — revise a 0229 à mão.';
  end if;
  if position(v_velho_disp in v_def) = 0 then
    raise exception 'sacado_limite_disponivel não está na forma esperada em notas_funil — revise a 0229 à mão.';
  end if;
  if position(v_velho_cobre in v_def) = 0 then
    raise exception 'sacado_limite_cobre_nota não está na forma esperada em notas_funil — revise a 0229 à mão.';
  end if;

  -- `create or replace view` recusa a troca se o TIPO da coluna mudar, e
  -- `credit_disponivel` e `limite_disponivel_sacado` são ambas numeric(14,2).
  v_def := replace(v_def, v_velho_disp, 'nf.limite_disponivel_sacado AS sacado_limite_disponivel');
  -- Sem `coalesce`: disponível desconhecido tem de sair NULO daqui.
  v_def := replace(v_def, v_velho_cobre, 'nf.limite_disponivel_sacado >= nf.valor AS sacado_limite_cobre_nota');

  -- A coluna nova entra no FIM da lista: `create or replace view` só aceita
  -- acréscimo no fim, nunca no meio.
  v_def := overlay(v_def placing ',' || E'\n' || '    nf.limite_sacado_origem AS sacado_limite_origem' || v_ancora
                   from position(v_ancora in v_def) for length(v_ancora));

  execute 'create or replace view public.notas_funil as ' || v_def;
end $$;

/*
 * ── A REAFIRMAÇÃO NÃO É REDUNDANTE, É A CONVENÇÃO DA 0099 ──────────────────
 * `create or replace view` NÃO preserva reloptions. Toda migração que recria a
 * `notas_funil` reafirma a opção logo abaixo — a 0099 é a cicatriz de quando
 * alguém esqueceu, e a 0225 encontrou a opção já perdida de novo.
 */
alter view public.notas_funil set (security_invoker = on);

comment on column public.notas_funil.sacado_limite_disponivel is
  'O limite disponível de HOJE (0229), da análise corrente da plataforma — e não '
  'mais o snapshot que o sync congelou na nota, que parava de ser atualizado 30 '
  'dias depois da emissão.';
comment on column public.notas_funil.sacado_limite_cobre_nota is
  'Disponível de hoje ≥ valor da nota. NULO quando não se sabe o disponível: '
  'ausência não é zero, e o card não pode dizer "não cobre" sobre o que não leu.';
comment on column public.notas_funil.sacado_limite_origem is
  '`sacado` quando o limite é do próprio, `holding` quando veio da empresa-mãe '
  '(filial e SPE não geram análise na fonte). Nulo com o disponível nulo.';
