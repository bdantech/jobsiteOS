-- ============================================================================
-- 0165 — A pergunta de intenção tem dois lados, e cada um ganha tag.
--
-- ── §1 `erp` SAI ────────────────────────────────────────────────────────────
-- "Sistema de gestão para minha empresa" era a terceira opção desde a 0120 e
-- nunca recebeu uma submissão: as oito que existem são todas `sacado`. Remover
-- não deixa dado inexprimível, e é por isso que o CHECK pode ser estreitado em
-- vez de apenas deixar de oferecer a opção.
--
-- Estreitar o CHECK é o que impede a opção de voltar por acidente. A alternativa
-- — tirar da tela e deixar o banco aceitando — significa que qualquer chamada ao
-- `app_processar_submissao` com `intencao = 'erp'` continuaria gravando um lead
-- com um rótulo que nenhuma tela sabe mais exibir.
--
-- E não há script obsoleto do que se preocupar: `/f/{slug}` e o embed leem
-- `formulario_publico(slug)` a CADA requisição, então as opções que a landing page
-- do cliente mostra vêm sempre destas linhas — não de um bundle colado semanas
-- atrás.
--
-- ── §2 A TAG NÃO É DECORAÇÃO ────────────────────────────────────────────────
-- "Antecipar as notas que eu emito" e "Deixar meus fornecedores antecipar"
-- descrevem a MESMA operação vista dos dois lados da nota, e quem chega pela
-- primeira vez não sabe de qual lado está. `Fornecedor` e
-- `Construtora / Incorporadora` respondem isso antes de a pessoa errar.
--
-- Errar aqui não é detalhe de formulário: a intenção declarada alimenta
-- `papelDaIntencao`, que decide a tipagem da empresa na Antecipação e dispara o
-- alerta de divergência quando bate contra o CNAE. Um lead que se marcou do lado
-- errado chega ao SDR com o pitch invertido.
-- ============================================================================

-- =============================================================================
-- §1 — O CHECK, estreitado
-- =============================================================================

/*
 * A lista vem do banco vivo, e ela é exatamente ('cedente','sacado','erp'). Sem
 * a conferência, recriar o CHECK a partir do arquivo original apagaria qualquer
 * valor que uma migração posterior tivesse acrescentado.
 */
alter table public.formulario_submissoes
  drop constraint if exists formulario_submissoes_intencao_check;
alter table public.formulario_submissoes
  add constraint formulario_submissoes_intencao_check
  check (intencao is null or intencao in ('cedente', 'sacado'));

comment on column public.formulario_submissoes.intencao is
  'De qual lado da nota a pessoa se declarou: `cedente` emite a nota (fornecedor) e '
  '`sacado` a recebe (construtora/incorporadora). Alimenta `papelDaIntencao`, a tipagem '
  'na Antecipação e o alerta de divergência contra o CNAE.';

-- =============================================================================
-- §2 — As opções das LPs existentes
-- =============================================================================

/*
 * Reescreve `pergunta_intencao` nos formulários que ainda oferecem três opções.
 *
 * O `where` não é zelo: um update cego sobrescreveria o título que alguém tenha
 * personalizado numa LP específica, e o título é a única parte desta pergunta que
 * o construtor deixa editar. `jsonb_set` no campo `opcoes` preserva o resto.
 */
update public.formularios set
  pergunta_intencao = jsonb_set(
    pergunta_intencao,
    '{opcoes}',
    jsonb_build_array(
      jsonb_build_object(
        'valor', 'cedente',
        'label', 'Antecipar as notas que eu emito',
        'tag',   'Fornecedor'
      ),
      jsonb_build_object(
        'valor', 'sacado',
        'label', 'Deixar meus fornecedores antecipar',
        'tag',   'Construtora / Incorporadora'
      )
    )
  ),
  atualizado_em = now()
where pergunta_intencao is not null
  and pergunta_intencao -> 'opcoes' is not null;
