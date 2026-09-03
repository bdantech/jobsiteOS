-- ============================================================================
-- 0167 — "Fornecedor é funcionário (PJ)" entra na lista de sem interesse
--
-- O motivo mais comum da prospecção de fornecedores não tinha onde ser gravado.
-- Metade das MEs que emitem nota contra uma construtora não são fornecedor
-- nenhum: são pedreiro, mestre de obra e engenheiro contratados como PJ, e a
-- "nota" é o salário do mês. Não há recebível a antecipar ali — o dinheiro é
-- certo, é do próprio contratante, e antecipar salário não é o produto.
--
-- Sem a opção, esse descarte caía em `outro` (com observação livre) ou, pior, em
-- `porte_incompativel` — que diz uma coisa diferente e mais cara: "a régua de
-- porte está trazendo empresa pequena demais". A régua não está errada; a
-- empresa é que não é fornecedora. Contar os dois juntos é calibrar a descoberta
-- contra um problema que ela não tem.
--
-- O CHECK é recriado a partir do estado VIVO do banco (0104 + esta), não da
-- lista da migração original.
-- ============================================================================

alter table public.antecipacao_fornecedor_sem_interesse
  drop constraint antecipacao_fornecedor_sem_interesse_motivo_check;

alter table public.antecipacao_fornecedor_sem_interesse
  add constraint antecipacao_fornecedor_sem_interesse_motivo_check check (motivo in (
    'nao_utiliza_antecipacao',
    'ja_opera_com_outro',
    'caixa_confortavel',
    'nao_quer_plataforma',
    'sem_contato',
    'porte_incompativel',
    'funcionario_pj',
    'outro'
  ));
