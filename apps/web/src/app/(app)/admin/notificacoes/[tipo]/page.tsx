import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Previa } from '@/actions/notificacoes-admin'
import { DetalheAviso, type RegraDoAviso } from '@/components/admin/notificacoes/detalhe'

export const metadata: Metadata = { title: 'Notificação' }
export const dynamic = 'force-dynamic'

/**
 * Um tipo de aviso: o texto, quem recebe e o histórico de quem mudou o quê.
 *
 * A prévia inicial já vem renderizada com o último evento real do tipo — é o que
 * mostra, antes de qualquer clique, como o aviso chega hoje.
 */
export default async function AvisoPage({ params }: { params: Promise<{ tipo: string }> }) {
  const { tipo: tipoParam } = await params
  const tipo = decodeURIComponent(tipoParam)
  const supabase = await createClient()

  const { data: aviso } = await supabase
    .from('notificacao_tipos')
    .select('tipo, modulo, nome, descricao, gravidade, ativo, titulo_modelo, corpo_modelo, url_modelo')
    .eq('tipo', tipo)
    .maybeSingle()
  if (!aviso) notFound()

  const [regras, perfis, pessoas, previa, historico] = await Promise.all([
    supabase
      .from('notificacao_regras')
      .select('id, perfil_id, usuario_id, papel, canais, frequencia, respeita_silencio, dedup_horas, fallback_admin, ativo')
      .eq('tipo_evento', tipo)
      .order('criado_em'),
    supabase.from('perfis').select('id, nome').order('nome'),
    supabase.from('usuarios').select('id, nome').eq('ativo', true).order('nome'),
    supabase.rpc('app_notificacao_previa', {
      p_tipo: tipo,
      p_titulo: aviso.titulo_modelo ?? undefined,
      p_corpo: aviso.corpo_modelo ?? undefined,
      p_url: aviso.url_modelo ?? undefined,
    }),
    supabase
      .from('notificacao_historico')
      .select('id, tabela, acao, antes, depois, usuario_id, criado_em')
      .or(`registro.eq.${tipo},depois->>tipo_evento.eq.${tipo},antes->>tipo_evento.eq.${tipo}`)
      .order('criado_em', { ascending: false })
      .limit(30),
  ])

  const nomeDe = new Map((pessoas.data ?? []).map((p) => [p.id, p.nome]))

  return (
    <DetalheAviso
      aviso={aviso}
      regras={(regras.data ?? []) as RegraDoAviso[]}
      perfis={perfis.data ?? []}
      pessoas={pessoas.data ?? []}
      previaInicial={previa.data as unknown as Previa}
      historico={(historico.data ?? []).map((h) => ({
        id: h.id,
        quando: h.criado_em,
        quem: h.usuario_id ? (nomeDe.get(h.usuario_id) ?? 'Alguém') : 'Sistema',
        descricao: descreverMudanca(h.tabela, h.acao, h.antes, h.depois),
      }))}
    />
  )
}

function descreverMudanca(tabela: string, acao: string, antes: unknown, depois: unknown): string {
  const a = (antes ?? {}) as Record<string, unknown>
  const d = (depois ?? {}) as Record<string, unknown>
  if (tabela === 'notificacao_tipos') {
    if (a.ativo !== d.ativo) return d.ativo ? 'Retomou o aviso' : 'Pausou o aviso'
    return 'Alterou o texto'
  }
  if (acao === 'criou') return 'Criou uma regra'
  if (acao === 'excluiu') return 'Excluiu uma regra'
  return 'Alterou uma regra'
}
