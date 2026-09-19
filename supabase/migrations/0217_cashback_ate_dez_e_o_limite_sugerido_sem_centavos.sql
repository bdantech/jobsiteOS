-- ═════════════════════════════════════════════════════════════════════════════
-- 0217 — O cashback vai até 10%, e o limite sugerido para de ter centavos
--
-- ─── §1 O CAMPO SE CHAMA CASHBACK ───────────────────────────────────────────
-- `commission_percent` é o nome no contrato com a plataforma de produção e NÃO muda:
-- renomear a chave quebraria a integração, e o que estava errado nunca foi a chave —
-- era o rótulo. Na tela ele passa a se chamar Cashback, que é como a mesa o chama.
--
-- O teto sobe de 3% para 10%. O 3 era o teto da matriz semente (0185) e virou trava
-- na negociação: quem precisava oferecer mais publicava "fora da faixa", e fora da
-- faixa é o aviso que deveria significar exceção — quando vira rotina, ninguém mais
-- lê nenhum deles.
--
-- Mexe na matriz ATIVA, não só no default do core. As duas coisas existem: o core
-- tem a semente (`MATRIZ_PADRAO`) e o banco tem as versões, e é a versão ativa que
-- precifica. Mudar só o core deixaria a tela oferecendo um teto que a matriz vigente
-- continua recusando.
--
-- Mexe DENTRO da versão 2 em vez de criar a 3. Versão nova é para quando a matriz
-- PRECIFICA diferente — células, ajustes —, porque a condição publicada guarda a
-- versão que a sugeriu e é por ela que uma condição antiga continua explicável. Um
-- teto de faixa mais largo não muda preço nenhum já sugerido: nenhuma célula chega
-- perto de 10, e todas as condições publicadas continuam dentro da faixa nova. Criar
-- uma versão aqui só faria as condições antigas apontarem para uma matriz que
-- precifica igual à delas.
--
-- ─── §2 O LIMITE SUGERIDO NÃO TEM CENTAVOS ──────────────────────────────────
-- Em 17/09/2026 duas análises entraram na esteira com valores que ninguém digitaria:
--
--   JCB CONSTRUTORA       R$  18.156,87
--   PLANGEFF ENGENHARIA   R$ 435.764,96
--
-- Nenhum humano pediu nenhum dos dois. Os dois são o `limite_potencial` da empresa,
-- saída crua do estimador, que o diálogo de "Solicitar análise" pré-preenche e que
-- esta função usa quando o campo vem em branco. A pessoa abriu, viu um número já lá,
-- e confirmou — que é exatamente o que um campo pré-preenchido pede que se faça.
--
-- E o número não fica aqui dentro: é ele que vai à seguradora no pedido de cobertura.
-- Pedir R$ 435.764,96 à Atradius anuncia que a conta foi feita por uma máquina e que
-- ninguém olhou — a impressão errada sobre a única parte do processo em que alguém
-- olhou de fato.
--
-- O arredondamento é SUGESTÃO, não trava: o campo continua editável e quem quiser
-- pedir 437.500 pede. A régua é a mesma do core (`arredondarLimiteSugerido`, testada
-- lá): passo proporcional à grandeza, ao mais próximo. Ao mais próximo e não para
-- baixo porque o potencial é a NOSSA estimativa do que a empresa sustenta, não um
-- teto da apólice — quem decide o limite é a seguradora.
--
-- DUAS CÓPIAS DA MESMA RÉGUA, e isso é deliberado: o TypeScript preenche o campo e o
-- SQL cobre quem não passa pela tela (a API do 04n, um INSERT de rotina). Ter só uma
-- delas deixaria o outro caminho com centavos, que é o defeito que se está corrigindo.
-- Os testes do core são a referência; esta função é a tradução.
--
-- ─── §3 O BURACO DO `docs_recebidos` ────────────────────────────────────────
-- A guarda de "já existe análise em andamento" lista cinco estágios e esquece
-- `docs_recebidos` — que `ESTAGIOS_ANALISE_ABERTOS` considera aberto desde sempre. Na
-- prática dava para abrir uma segunda análise do mesmo CNPJ enquanto a primeira estava
-- com a pasta conferida, esperando o envio. Duas análises vivas do mesmo CNPJ é o
-- estado que essa guarda inteira existe para impedir, e é o pior deles: é justo antes
-- da chamada PAGA.
--
-- Achado ao abrir "solicitar nova análise" nas telas (o pedido que trouxe esta
-- migração). A lista passa a vir de um lugar só.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── §1 ─────────────────────────────────────────────────────────────────────

update public.precificacao_matriz
   set definicao = jsonb_set(definicao, '{faixas,comissao,max}', '10'::jsonb)
 where ativa;

-- ─── §2 ─────────────────────────────────────────────────────────────────────

create or replace function public.app_arredondar_limite_sugerido(p_valor numeric)
returns numeric language sql immutable set search_path = '' as $function$
  select case
    when p_valor is null or p_valor <= 0 then null
    else greatest(passo.v, round(p_valor / passo.v) * passo.v)
  end
  from (select case
    when p_valor >= 1000000 then 50000
    when p_valor >=  100000 then 10000
    when p_valor >=   10000 then  5000
    else                          1000
  end::numeric as v) passo;
$function$;

comment on function public.app_arredondar_limite_sugerido is
  'O limite potencial virando um número que uma pessoa pediria (0217). Passo proporcional '
  'à grandeza, ao mais próximo. Gêmea de `arredondarLimiteSugerido` no core, que é onde '
  'ela é testada — quem mexer numa mexe na outra.';

-- ─── §3 + o arredondamento no fallback ──────────────────────────────────────

create or replace function public.app_solicitar_analise(p jsonb)
returns public.analises_credito
language plpgsql security definer set search_path = '' as $function$
declare
  v_ator uuid := auth.uid();
  v_empresa public.empresas;
  v_linha public.analises_credito;
  v_limite numeric := nullif(p ->> 'limite_solicitado', '')::numeric;
begin
  if not (public.app_tem_modulo('credito') or public.app_tem_modulo('empresas')) then
    raise exception 'Sem acesso para solicitar análise de crédito.' using errcode = '42501';
  end if;

  select * into v_empresa from public.empresas where id = (p ->> 'empresa_id')::uuid;
  if v_empresa.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;

  if v_empresa.tipo not in ('construtora', 'incorporadora') then
    raise exception 'Análise de crédito é para sacados (construtora/incorporadora).'
      using errcode = '22023';
  end if;

  /*
   * Os SEIS estágios abertos — `docs_recebidos` entrou na 0217. A lista é a mesma de
   * `ESTAGIOS_ANALISE_ABERTOS` no core; ela estava com cinco aqui e seis lá, e a que
   * faltava é justamente a de quem está prestes a enviar.
   *
   * Decidida (aprovada, parcial, negada) e cancelada FICAM DE FORA de propósito: é
   * delas que nasce a nova análise, e é esse o caminho que as telas oferecem agora.
   */
  if exists (
    select 1 from public.analises_credito a
    where a.cnpj = v_empresa.cnpj
      and a.estagio in ('rascunho', 'solicitada', 'docs_pendentes', 'docs_recebidos',
                        'enviada_seguradora', 'em_analise')
  ) then
    raise exception 'Já existe uma análise em andamento para este CNPJ.' using errcode = '23505';
  end if;

  insert into public.analises_credito (
    empresa_id, cnpj, estagio, limite_solicitado, observacoes, solicitada_por
  )
  values (
    v_empresa.id, v_empresa.cnpj, 'solicitada',
    -- O que a pessoa digitou vale COMO DIGITADO: arredondar o pedido dela seria mexer
    -- num número que ela conferiu. O arredondamento é só do palpite da casa.
    coalesce(v_limite, public.app_arredondar_limite_sugerido(v_empresa.limite_potencial)),
    nullif(p ->> 'observacoes', ''), v_ator
  )
  returning * into v_linha;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa.id, 'analise.solicitada',
    jsonb_build_object(
      'titulo', 'Análise de crédito solicitada',
      'resumo', 'Limite solicitado: R$ ' ||
                to_char(coalesce(v_linha.limite_solicitado, 0), 'FM999G999G999G990D00') || '.',
      'url', '/credito/analises/' || v_linha.id,
      'analise_id', v_linha.id
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'analise.solicitada', 'analises_credito', v_linha.id::text, p);

  return v_linha;
end; $function$;
