import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MODULES, grantedModuleGroups } from './index.ts'

/**
 * O que este teste protege são as duas ordens que NÃO podem se misturar: a da sidebar
 * web (seções e ordem dentro delas) e a do MODULES, que decide a tab bar e a tela
 * inicial do mobile. Arrumar uma mexendo na outra muda o app de quem usa o celular sem
 * que ninguém perceba.
 */

const TODOS = MODULES.map((m) => m.id)

function desenho(ids: readonly string[]) {
  return grantedModuleGroups(ids).map((g) => [g.label, g.modules.map((m) => m.id)])
}

test('admin vê as cinco seções, na ordem da jornada', () => {
  assert.deepEqual(desenho(TODOS), [
    [null, ['empresas']],
    ['Prospecção', ['mercado', 'radar']],
    ['Vendas', ['comercial', 'antecipacao', 'comunicacao', 'agentes']],
    ['Risco e recuperação', ['credito', 'cobranca', 'juridico']],
    ['Sistema', ['admin']],
  ])
})

test('notificações não ganha item na sidebar — o sino é a porta', () => {
  const ids = desenho(TODOS).flatMap(([, m]) => m as string[])
  assert.ok(!ids.includes('notificacoes'))
})

test('seção sem módulo liberado não aparece (SDR não vê Risco nem Sistema)', () => {
  assert.deepEqual(desenho(['comercial', 'comunicacao', 'empresas', 'mercado', 'notificacoes']), [
    [null, ['empresas']],
    ['Prospecção', ['mercado']],
    ['Vendas', ['comercial', 'comunicacao']],
  ])
})

test('a ordem do MODULES (tela inicial do mobile) continua a mesma', () => {
  assert.deepEqual(TODOS, [
    'mercado',
    'radar',
    'antecipacao',
    'credito',
    'comercial',
    'agentes',
    'juridico',
    'cobranca',
    'comunicacao',
    'empresas',
    'admin',
    'notificacoes',
  ])
})
