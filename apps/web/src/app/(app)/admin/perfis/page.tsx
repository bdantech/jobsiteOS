import type { Metadata } from 'next'
import { AlertCircle } from 'lucide-react'
import { MODULES } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  PerfisManager,
  type ModuloOpcao,
  type PerfilDetalhe,
} from '@/components/admin/perfis-manager'

export const metadata: Metadata = {
  title: 'Perfis',
}

export default async function PerfisPage() {
  await requireSessionContext()

  const supabase = await createClient()

  const [perfisResult, modulosResult, usuariosResult] = await Promise.all([
    supabase.from('perfis').select('id, nome, descricao, criado_em').order('nome'),
    supabase.from('perfil_modulos').select('perfil_id, modulo_id'),
    supabase.from('usuarios').select('perfil_id'),
  ])

  if (perfisResult.error || modulosResult.error || usuariosResult.error) {
    return (
      <Card className="border-destructive/50">
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <AlertCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
          <div>
            <CardTitle className="text-base">Não foi possível carregar os perfis</CardTitle>
            <CardDescription>
              Ocorreu um erro ao consultar o banco de dados. Recarregue a página e tente novamente.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>
    )
  }

  const modulosPorPerfil = new Map<string, string[]>()
  for (const linha of modulosResult.data) {
    const lista = modulosPorPerfil.get(linha.perfil_id) ?? []
    lista.push(linha.modulo_id)
    modulosPorPerfil.set(linha.perfil_id, lista)
  }

  const usuariosPorPerfil = new Map<string, number>()
  for (const usuario of usuariosResult.data) {
    if (!usuario.perfil_id) continue
    usuariosPorPerfil.set(usuario.perfil_id, (usuariosPorPerfil.get(usuario.perfil_id) ?? 0) + 1)
  }

  const perfis: PerfilDetalhe[] = perfisResult.data.map((perfil) => {
    // Intersect with the registry, exactly as getSessionContext() does: a
    // modulo_id left behind by a removed module grants nothing, so it must not
    // be shown as if it did.
    const concedidos = (modulosPorPerfil.get(perfil.id) ?? []).filter((id) =>
      MODULES.some((m) => m.id === id),
    )

    return {
      id: perfil.id,
      nome: perfil.nome,
      descricao: perfil.descricao,
      modulos: concedidos,
      totalUsuarios: usuariosPorPerfil.get(perfil.id) ?? 0,
    }
  })

  /**
   * MODULES itself must NOT cross into the client bundle: an AppModule carries
   * its tools, each with a zod schema and a server-side execute() closure.
   * Project it down to the three serializable fields the UI actually renders.
   */
  const modulos: ModuloOpcao[] = MODULES.map((m) => ({
    id: m.id,
    nome: m.name,
    rota: m.route,
    webOnly: m.webOnly ?? false,
  }))

  // Drives the client-side lockout hint. The server enforces the rule regardless.
  const perfisComAdmin = perfis.filter((p) => p.modulos.includes('admin')).length

  return (
    <PerfisManager perfis={perfis} modulos={modulos} perfisComAdmin={perfisComAdmin} />
  )
}
