-- ─────────────────────────────────────────────────────────────────────────────
-- Apagar os domínios que são do CONTADOR, não da empresa
--
-- A contabilidade abre a empresa e cadastra o próprio e-mail na Receita. A cascata de
-- resolução (§3) pegava esse e-mail na etapa 1 e adotava o domínio — e ele passa em
-- todas as validações que existem: resolve no DNS, responde HTTP, tem MX. O problema
-- nunca foi o domínio ser falso; é ele ser de outra empresa. Enriquecer por ele traz o
-- headcount e os contatos do escritório contábil, com a mesma cara de dado apurado.
--
-- A regra nova vive em packages/core/src/radar/dominio.ts (motivoDescarteDominio) e
-- vale para as quatro origens da cascata. Isto aqui é só a limpeza do que já entrou:
-- 4 empresas e 6 linhas do universo, todas com origem `rfb`.
--
-- O predicado abaixo é uma CÓPIA da regra do core, e isso é aceitável exatamente
-- porque roda uma vez e morre. Se algum dia virar rotina, tem que virar função — duas
-- cópias vivas da mesma regra é a regra que diverge.
--
-- Nenhuma das quatro tinha headcount ou contato enriquecido, então não há dado
-- contaminado a desfazer: o domínio some e a cascata tenta de novo no próximo lote.
-- `dominio_origem = 'manual'` é preservado, como em todo o resto do fluxo — decisão
-- humana não é revista por heurística.
-- ─────────────────────────────────────────────────────────────────────────────

update public.empresas set
  dominio = null,
  dominio_origem = null,
  dominio_confianca = null,
  dominio_validado_em = null,
  dominio_evidencia = null
where dominio is not null
  and coalesce(dominio_origem, '') <> 'manual'
  and (dominio ~ 'contab|contad|conteis' or dominio like '%.cnt.br');

update public.mercado_universo set
  dominio = null,
  dominio_origem = null,
  dominio_confianca = null
where dominio is not null
  and coalesce(dominio_origem, '') <> 'manual'
  and (dominio ~ 'contab|contad|conteis' or dominio like '%.cnt.br');
