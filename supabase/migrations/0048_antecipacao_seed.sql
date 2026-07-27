-- =============================================================================
-- 0048 — Antecipação: seeds, grant do módulo, regras de notificação
--
-- Idempotente (on conflict do nothing / not exists): re-rodar não sobrescreve o
-- que o operador ajustou na UI. As regras de faixa v1 são um PONTO DE PARTIDA —
-- a tela de métricas por faixa existe justamente para regulá-las com dados.
-- =============================================================================

-- ─── Settings do módulo ──────────────────────────────────────────────────────
insert into antecipacao_config (chave, valor) values
  ('funil', jsonb_build_object(
    -- Abaixo disto a nota não é operável: sai das faixas com motivo 'expirada'.
    'minimo_operavel_dias', 7,
    -- Janela de vencimento considerada "saudável" pelas regras seed.
    'janela_vencimento_min_dias', 15,
    'janela_vencimento_max_dias', 120
  )),
  ('economia', jsonb_build_object(
    -- Taxa mensal (%) usada quando o sacado não tem snapshot de crédito.
    'taxa_mensal_padrao', 1.99
  )),
  ('disparo', jsonb_build_object(
    'cooldown_dias_padrao', 7,
    -- Toque manual do vendedor também conta para o cooldown (§9).
    'considerar_toque_manual', true
  )),
  ('supressao', jsonb_build_object(
    'soft_dias_padrao', 90
  )),
  ('sync', jsonb_build_object(
    -- Colchão da janela: buscamos desde o último sync bem-sucedido MENOS isto.
    -- A sobreposição é segura porque o processamento é idempotente por access_key.
    'sobreposicao_horas', 6,
    'page_size', 200,
    -- Primeira execução (sem sync anterior): quantos dias trazer.
    'janela_inicial_dias', 60
  )),
  ('lookup_cadastral', jsonb_build_object(
    'max_tentativas', 10,
    'max_por_execucao', 300,
    -- ReceitaWS free: 3 req/min. É o último recurso e leva throttle rígido.
    'receitaws_intervalo_ms', 21000
  ))
on conflict (chave) do nothing;

-- ─── Regras de faixa v1 ──────────────────────────────────────────────────────
-- Avaliadas alta → boa → media; a primeira que casa define a faixa.

-- ALTA: fornecedor já é da casa, sacado aprovado e com limite que cobre a nota.
insert into faixa_regras (faixa, versao, definicao, ativa)
values (
  'alta', 1,
  '{
    "operador": "e",
    "condicoes": [
      { "variavel": "fornecedor_cadastrado", "operador": "igual", "valor": true },
      { "variavel": "sacado_credito_status", "operador": "igual", "valor": "APPROVED" },
      { "variavel": "sacado_limite_cobre_nota", "operador": "igual", "valor": true },
      { "variavel": "dias_para_vencimento", "operador": "entre", "valor": [15, 120] }
    ]
  }'::jsonb,
  true
) on conflict (faixa, versao) do nothing;

-- BOA: o sacado é aprovado, mas o fornecedor ainda não está na plataforma —
-- aquisição com o crédito já resolvido do outro lado.
insert into faixa_regras (faixa, versao, definicao, ativa)
values (
  'boa', 1,
  '{
    "operador": "e",
    "condicoes": [
      { "variavel": "sacado_credito_status", "operador": "igual", "valor": "APPROVED" },
      { "variavel": "fornecedor_cadastrado", "operador": "igual", "valor": false },
      { "variavel": "dias_para_vencimento", "operador": "entre", "valor": [15, 120] }
    ]
  }'::jsonb,
  true
) on conflict (faixa, versao) do nothing;

-- MEDIA: o sacado existe na base mas o crédito ainda não está aprovado — vale
-- trabalhar, começando pelo crédito.
insert into faixa_regras (faixa, versao, definicao, ativa)
values (
  'media', 1,
  '{
    "operador": "e",
    "condicoes": [
      { "variavel": "sacado_cadastrado", "operador": "igual", "valor": true },
      { "variavel": "sacado_credito_status", "operador": "diferente", "valor": "APPROVED" },
      { "variavel": "dias_para_vencimento", "operador": "maior_ou_igual", "valor": 15 }
    ]
  }'::jsonb,
  true
) on conflict (faixa, versao) do nothing;

-- ─── Régua de disparo: existe, desligada ─────────────────────────────────────
-- Tudo off. O modo sombra deste prompt só gera outbox quando alguém liga um canal
-- — e mesmo assim nada sai. Os templates são placeholders simples (§6).
insert into faixa_disparos (faixa, email_habilitado, whatsapp_habilitado, cooldown_dias,
                            assunto_email, template_email, template_whatsapp) values
  ('alta', false, false, 7,
   'Antecipe suas notas contra {sacado_principal}',
   'Olá, {fornecedor_nome}.

Identificamos {qtd_notas} nota(s) sua(s) contra {sacado_principal}, somando {valor_total}, com prazo para antecipação.

Podemos adiantar esse recebível hoje. Respondendo esta mensagem, retornamos com a simulação.',
   'Olá, {fornecedor_nome}! Vi que você tem {qtd_notas} nota(s) contra {sacado_principal} ({valor_total}). Consigo antecipar esse valor — quer que eu simule?'),
  ('boa', false, false, 10,
   'Suas notas contra {sacado_principal} podem virar caixa hoje',
   'Olá, {fornecedor_nome}.

{sacado_principal} já é cliente da nossa plataforma, e você tem {qtd_notas} nota(s) contra ela, no total de {valor_total}.

Como o crédito do sacado já está aprovado, a antecipação sai rápido. Quer conhecer as condições?',
   'Olá, {fornecedor_nome}! {sacado_principal} já opera conosco e você tem {qtd_notas} nota(s) ({valor_total}) contra ela. Posso te mostrar as condições de antecipação?'),
  ('media', false, false, 14,
   'Antecipação de recebíveis — {fornecedor_nome}',
   'Olá, {fornecedor_nome}.

Você tem {qtd_notas} nota(s) contra {sacado_principal}, no total de {valor_total}.

Estamos analisando o crédito do sacado. Se fizer sentido para você, avisamos assim que a antecipação estiver liberada.',
   'Olá, {fornecedor_nome}! Você tem {qtd_notas} nota(s) contra {sacado_principal} ({valor_total}). Estamos avaliando o crédito — quer que eu te avise quando liberar?')
on conflict (faixa) do nothing;

-- ─── O módulo precisa existir no perfil Admin ────────────────────────────────
-- Sem isto o módulo é invisível: a sidebar renderiza grantedModules(), a RLS
-- responde app_tem_modulo('antecipacao') com false, e a IA não recebe as tools.
insert into perfil_modulos (perfil_id, modulo_id)
select p.id, 'antecipacao'
from perfis p
where p.nome in ('Admin', 'Comercial')
on conflict (perfil_id, modulo_id) do nothing;

-- ─── Regras de notificação (§7) ──────────────────────────────────────────────
insert into notificacao_regras (tipo_evento, perfil_id, ativo)
select v.tipo, p.id, true
from (values
  ('sacado.limite_insuficiente', 'Admin'),
  ('sacado.limite_insuficiente', 'Crédito'),
  ('nf.convertida',              'Comercial'),
  ('sacado.credito_alterado',    'Crédito'),
  ('nf.faixa_alterada',          'Comercial')
) as v(tipo, perfil)
join perfis p on p.nome = v.perfil
where not exists (
  select 1 from notificacao_regras r where r.tipo_evento = v.tipo and r.perfil_id = p.id
);
