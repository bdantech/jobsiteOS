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
  ('cargos_alvo', jsonb_build_object(
    'titulos', jsonb_build_array(
      'sócio','socio','proprietário','proprietario','fundador','CEO','diretor',
      'diretor financeiro','CFO','gerente financeiro','financeiro','controller','controladoria',
      'gerente administrativo','suprimentos','compras','comprador','procurement',
      'engenheiro','engenharia','gerente de obras','diretor de obras','planejamento',
      'COO','diretor executivo','sócio-diretor'),
    'departamentos', jsonb_build_array('finance','operations','engineering','procurement','executive'),
    'senioridades', jsonb_build_array('owner','founder','c_suite','partner','vp','head','director','manager'),
    'max_contatos_por_empresa', 4
  )),
  ('apollo', jsonb_build_object('revelar_telefone_em_lote', false, 'bulk_size', 10)),
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
