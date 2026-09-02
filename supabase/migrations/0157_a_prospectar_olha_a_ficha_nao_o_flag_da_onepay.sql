-- ═════════════════════════════════════════════════════════════════════════════
-- 0157 — Corrige a 0156: "cadastrado" não é "tem ficha aqui"
--
-- A 0156 amarrou as notas à empresa recém-promovida, e junto disso marcou
-- `sacado_cadastrado`/`fornecedor_cadastrado` como true. Isso estava ERRADO, e o
-- erro é de significado: esses dois campos são o `registered` do payload da OnePay
-- (`item.recipient?.registered`, em nf-payload.ts) — dizem se o participante está
-- cadastrado NA PLATAFORMA DELES, não se existe ficha na nossa base.
--
-- A diferença não é acadêmica. `fornecedor_cadastrado` alimenta
-- `calcularTipagem()` — é ele que separa "aquisição" de "ativação", que decide o
-- TOM da abordagem — e é variável das regras de faixa (seed 0048). Marcar como
-- cadastrado quem apenas ganhou ficha no nosso CRM faria o funil tratar um
-- desconhecido como cliente que nunca ativou.
--
-- A função volta a fazer só o que precisava: apontar as notas para a ficha.
--
-- ─── E A LISTA "A PROSPECTAR" PASSA A OLHAR A COISA CERTA ───────────────────
-- O sintoma original era este: promover um sacado não o tirava de "sacados a
-- prospectar", e o botão continuava oferecendo "Promover para Empresas" na ficha
-- dele. A view filtrava `where not sacado_cadastrado` — o flag da OnePay, que
-- continua falso depois da promoção e só muda se o sacado se cadastrar LÁ.
--
-- A pergunta que a lista faz é "quem ainda não está na nossa base", e a coluna que
-- responde isso é `sacado_empresa_id`. Com a amarração da 0156 funcionando, ela
-- passa a ser verdade no instante da promoção.
--
-- ─── DÍVIDA CONHECIDA ───────────────────────────────────────────────────────
-- A 0156 rodou em produção antes desta correção e marcou `cadastrado = true` nas
-- notas dos 11 CNPJs que tinham notas órfãs (3 como sacado, 8 como fornecedor).
-- O valor anterior de cada linha não é reconstruível — o `registered` só existe no
-- payload da OnePay, e o sync sobrescreve a coluna apenas nas notas que ele
-- revisita na janela dele. As telas afetadas são a tipagem desses fornecedores e
-- as regras de faixa que leem o flag.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.app__vincular_notas_da_empresa(p_cnpj text, p_empresa uuid)
returns void language sql security definer set search_path = '' as $$
  update public.notas_fiscais
     set sacado_empresa_id = p_empresa
   where sacado_cnpj = p_cnpj and sacado_empresa_id is null;

  update public.notas_fiscais
     set fornecedor_empresa_id = p_empresa
   where fornecedor_cnpj = p_cnpj and fornecedor_empresa_id is null;
$$;

comment on function public.app__vincular_notas_da_empresa is
  'Aponta as notas de um CNPJ para a ficha recém-criada, nos dois papéis. NÃO toca em '
  'sacado_cadastrado/fornecedor_cadastrado: esses são o `registered` do payload da '
  'OnePay (estar cadastrado LÁ), e não "existe ficha aqui" — confundir os dois altera '
  'a tipagem do fornecedor e as regras de faixa.';

create or replace view public.antecipacao_sacados_a_prospectar as
 SELECT sacado_cnpj,
    max(COALESCE(sacado_razao_social, sacado_nome)) AS sacado_nome,
    (array_agg(sacado_empresa_id) FILTER (WHERE sacado_empresa_id IS NOT NULL))[1] AS sacado_empresa_id,
    max(sacado_uf) AS sacado_uf,
    max(sacado_municipio) AS sacado_municipio,
    max(sacado_cnae_principal) AS sacado_cnae_principal,
    count(*)::integer AS notas,
    sum(valor) AS valor_agregado,
    count(DISTINCT fornecedor_cnpj)::integer AS fornecedores,
    count(*) FILTER (WHERE fornecedor_ja_antecipou)::integer AS notas_de_quem_ja_antecipou,
    max(emitida_em) AS ultima_nota_em,
    min(emitida_em) AS primeira_nota_em,
    max(sacado_camada) AS sacado_camada
   FROM notas_funil f
  WHERE sacado_empresa_id IS NULL AND sacado_construcao
  GROUP BY sacado_cnpj;

comment on view public.antecipacao_sacados_a_prospectar is
  'Construtoras que compram a prazo e ainda NÃO têm ficha na nossa base. O filtro é '
  'sacado_empresa_id nulo, e não `not sacado_cadastrado`: aquele flag é o `registered` '
  'da OnePay e continuava falso depois de promover, então quem já tinha sido trazido '
  'para a base seguia listado como se não estivesse.';
