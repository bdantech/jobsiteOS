import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { CatalogoAvisos, type LinhaCatalogo } from '@/components/admin/notificacoes/catalogo'

export const metadata: Metadata = { title: 'Notificações' }

// Volume e leitura dos últimos 30 dias: estático, congelaria no horário do build.
export const dynamic = 'force-dynamic'

/**
 * O catálogo de avisos (0262): todo tipo que a plataforma sabe emitir, quem recebe
 * cada um, por qual canal, e quanto dele é lido.
 *
 * Lido com a sessão de quem abre: a RLS das tabelas é admin-only, e o layout de
 * /admin já recusou quem não é.
 */
export default async function NotificacoesPage() {
  const supabase = await createClient()

  const [tipos, regras, numeros, config, perfis] = await Promise.all([
    supabase.from('notificacao_tipos').select('tipo, modulo, nome, descricao, gravidade, ativo, titulo_modelo'),
    supabase
      .from('notificacao_regras')
      .select('tipo_evento, perfil_id, usuario_id, papel, canais, frequencia, ativo'),
    supabase.rpc('app_notificacao_numeros'),
    supabase.from('notificacao_config').select('silencio_inicio, silencio_fim').eq('id', true).maybeSingle(),
    supabase.from('perfis').select('id, nome'),
  ])

  const nomePerfil = new Map((perfis.data ?? []).map((p) => [p.id, p.nome]))
  const numerosPorTipo = new Map((numeros.data ?? []).map((n) => [n.tipo, n]))
  const regrasPorTipo = new Map<string, NonNullable<typeof regras.data>>()
  for (const r of regras.data ?? []) regrasPorTipo.set(r.tipo_evento, [...(regrasPorTipo.get(r.tipo_evento) ?? []), r])

  const linhas: LinhaCatalogo[] = (tipos.data ?? []).map((t) => {
    const rs = (regrasPorTipo.get(t.tipo) ?? []).filter((r) => r.ativo)
    const n = numerosPorTipo.get(t.tipo)
    return {
      tipo: t.tipo,
      modulo: t.modulo,
      nome: t.nome,
      descricao: t.descricao,
      critico: t.gravidade === 'critica',
      ativo: t.ativo,
      personalizado: Boolean(t.titulo_modelo),
      destinos: rs.map((r) => ({
        rotulo: r.perfil_id ? (nomePerfil.get(r.perfil_id) ?? 'Perfil') : r.usuario_id ? 'Pessoa' : (r.papel ?? ''),
        papel: r.papel,
        resumo: r.frequencia === 'resumo_diario',
      })),
      canais: [...new Set(rs.flatMap((r) => r.canais))],
      enviados: Number(n?.enviados ?? 0),
      lidos: Number(n?.lidos ?? 0),
      resumidos: Number(n?.resumidos ?? 0),
    }
  })

  return (
    <CatalogoAvisos
      linhas={linhas}
      silencio={{ inicio: config.data?.silencio_inicio ?? 20, fim: config.data?.silencio_fim ?? 8 }}
    />
  )
}
