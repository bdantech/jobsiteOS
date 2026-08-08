-- ─────────────────────────────────────────────────────────────────────────────
-- A busca de candidatos do importador sai do PostgREST e vira RPC
--
-- Sintoma: a fila de resolução estourava o statement_timeout de 8s do papel
-- `authenticated`. A MESMA consulta roda em 34 ms como superusuário.
--
-- Causa: a policy de `mercado_universo` referencia colunas da tabela dentro de
-- dois EXISTS (notas_fiscais e empresas). Ela é uma barreira de segurança, e
-- `ILIKE` (~~*) NÃO é LEAKPROOF — então o Postgres é obrigado a avaliar a policy
-- ANTES do filtro do usuário, e um filtro que não pode ser avaliado primeiro não
-- pode virar condição de índice. Resultado medido, com o papel authenticated:
--
--   ilike + uf = 'SP'   → Index Scan pelo índice de UF, 246 mil linhas filtradas,  8,7 s
--   ilike sem uf        → Seq Scan, 882 mil linhas filtradas,                     31,5 s
--
-- Os índices GIN de trigrama existem e estão corretos; eles simplesmente não são
-- alcançáveis por esse caminho. Não é um problema de índice, é de ordem de
-- avaliação, e nenhuma reescrita do lado do PostgREST resolve.
--
-- SECURITY DEFINER resolve porque a função roda sem RLS e o planner volta a poder
-- usar os índices (BitmapOr dos dois trigramas). A autorização não se perde: o
-- gate de módulo é checado UMA vez, no topo, e é o mesmo `app_tem_modulo('mercado')`
-- do primeiro braço da policy — quem tem o módulo já podia ler o universo inteiro.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.app_buscar_candidatos_universo(p jsonb)
returns table (
  cnpj text,
  razao_social text,
  nome_fantasia text,
  uf text,
  municipio text,
  situacao_cadastral text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  -- O chamador manda o token já normalizado (só A-Z0-9), mas `%` e `_` são
  -- curingas do LIKE: limpar aqui também é barato e tira a confiança do cliente.
  v_token text := regexp_replace(coalesce(p ->> 'token', ''), '[%_\\]', '', 'g');
  v_nome  text := coalesce(p ->> 'nome', '');
  v_uf    text := nullif(p ->> 'uf', '');
  v_limite int := least(coalesce((p ->> 'limite')::int, 60), 200);
begin
  if not public.app_tem_modulo('mercado') then
    raise exception 'Sem acesso ao módulo Mercado.' using errcode = '42501';
  end if;
  -- Token vazio buscaria '%%' e devolveria as primeiras 60 empresas do universo
  -- como "candidatas". Nada é melhor que qualquer coisa.
  if length(v_token) < 3 then
    return;
  end if;

  return query
  select u.cnpj, u.razao_social, u.nome_fantasia, u.uf, u.municipio, u.situacao_cadastral
  from public.mercado_universo u
  where (u.razao_social ilike '%' || v_token || '%'
      or u.nome_fantasia ilike '%' || v_token || '%')
    and (v_uf is null or u.uf = v_uf)
  -- Ordenar aqui é o que faz o LIMIT devolver os 60 MELHORES, e não 60 quaisquer.
  -- Importa justamente nos nomes cujo token distintivo é uma palavra genérica
  -- ("LCM CONSTRUÇÃO" busca por CONSTRUCAO): sem ordem, os 60 primeiros que o
  -- índice cuspir não têm por que conter a empresa certa.
  --
  -- O ranking FINAL continua no Node (components/mercado/importador/similaridade.ts),
  -- onde entra o bônus de município e o corte de similaridade. Aqui é só a peneira.
  -- `public.similarity`: o pg_trgm está no schema public e a função roda com
  -- `search_path = ''`, então sem o qualificador ela não existe.
  order by greatest(
    public.similarity(v_nome, coalesce(u.razao_social, '')),
    public.similarity(v_nome, coalesce(u.nome_fantasia, ''))
  ) desc
  limit v_limite;
end $$;

revoke execute on function public.app_buscar_candidatos_universo(jsonb) from public;
grant execute on function public.app_buscar_candidatos_universo(jsonb) to authenticated, service_role;

comment on function public.app_buscar_candidatos_universo is
  'Candidatos do universo por trigrama (razão social OU nome fantasia), para a fila de '
  'resolução do importador. SECURITY DEFINER porque sob RLS o ILIKE não alcança os '
  'índices GIN — ver o cabeçalho da migração 0082. Gate de módulo no topo.';
