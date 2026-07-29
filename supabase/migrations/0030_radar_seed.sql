-- =============================================================================
-- 0030 — Radar: seeds
--
-- radar_config com os defaults do Prompt (§2), idempotente (on conflict do
-- nothing — não sobrescreve ajustes feitos pelo admin na UI). E concede o módulo
-- 'radar' ao perfil Admin (perfil_modulos.modulo_id não é FK — o registry mora no
-- código, mas a grant precisa existir na tabela).
-- =============================================================================

insert into radar_config (chave, valor) values
  ('custos', jsonb_build_object(
    'dominio_claude', 0.10,          -- R$ por empresa pesquisada
    'contato_apollo', 1.20,          -- R$ por contato revelado (ajustar ao plano)
    'protesto_sp', 0.36,
    'protesto_nacional', 3.50
  )),
  ('ttl_dias', jsonb_build_object(
    'dominio', 180, 'dominio_sem_dados', 360,
    'contatos', 180, 'contatos_sem_dados', 360,
    'protestos_cliente', 30, 'protestos_prospeccao', 90
  )),
  ('orcamento', jsonb_build_object(
    'teto_mensal_total', 5000,       -- R$ — bloqueia execução ao estourar
    'alerta_percentual', 0.8,        -- notifica admins em 80%
    'max_itens_por_lote', 2000
  )),
  -- A SELEÇÃO É LOCAL (packages/core/src/radar/cargos.ts): a busca do Apollo é
  -- gratuita e traz a empresa inteira, e é aqui que se decide quem vale revelar —
  -- porque revelar é o que cobra. Filtrar na API não funciona: person_titles e
  -- person_seniorities se combinam por OR, e person_departments nem existe.
  ('cargos_alvo', jsonb_build_object(
    -- Casam por TRECHO, sem acento/caixa. Precisam de pt E en: o Apollo devolve
    -- "Engineering Director" e "Comptroller" tanto quanto "Diretor de Engenharia".
    -- NÃO ponha 'manager' solto — traz todo "Construction Manager" da obra de volta.
    'titulos', jsonb_build_array(
      'sócio','socio','proprietário','proprietario','fundador','CEO','diretor',
      'diretor financeiro','CFO','gerente financeiro','financeiro','controller','controladoria',
      'gerente administrativo','suprimentos','compras','comprador','procurement',
      'engenheiro','engenharia','gerente de obras','diretor de obras','planejamento',
      'COO','diretor executivo','sócio-diretor',
      'director','chief','head of','owner','founder','partner','engineering',
      'administrative','financial','finance','treasury','comptroller',
      'purchasing','supply chain','controlling'),
    -- Departamento NÃO qualifica nem elimina: só desempata. Se qualificasse,
    -- `master_operations` traria a obra inteira pela porta dos fundos.
    'departamentos', jsonb_build_array('finance','operations','engineering','procurement','executive'),
    -- A ORDEM importa: é a prioridade do corte por max_contatos_por_empresa.
    'senioridades', jsonb_build_array('owner','founder','c_suite','partner','vp','head','director','manager'),
    -- Entram sem depender do título: o alto escalão costuma vir em inglês, e um
    -- C-level perdido por grafia é o pior erro possível aqui.
    'senioridades_qualificam', jsonb_build_array('owner','founder','c_suite','partner'),
    -- Donos e financeiro furam a fila, à frente até de senioridade maior.
    'prioritarios', jsonb_build_object(
      'senioridades', jsonb_build_array('owner','founder','partner'),
      'departamentos', jsonb_build_array('finance'),
      'titulos', jsonb_build_array(
        'sócio','socio','sócio-diretor','proprietário','proprietario','fundador','founder','owner',
        'CFO','financeiro','financeira','finance','controladoria','controller','comptroller','tesouraria')
    ),
    'max_contatos_por_empresa', 8,
    'max_paginas_busca', 3          -- 100 por página; acima disso é improvável achar sócio
  )),
  ('apollo', jsonb_build_object('revelar_telefone_em_lote', true, 'bulk_size', 10)),
  ('protestos', jsonb_build_object('clientes_sempre_nacional', true, 'prospeccao_incluir_fora_sp_default', false))
on conflict (chave) do nothing;

-- Concede o módulo 'radar' ao perfil Admin (idempotente).
insert into perfil_modulos (perfil_id, modulo_id)
select p.id, 'radar'
from perfis p
where p.nome = 'Admin'
  and not exists (
    select 1 from perfil_modulos pm where pm.perfil_id = p.id and pm.modulo_id = 'radar'
  );
