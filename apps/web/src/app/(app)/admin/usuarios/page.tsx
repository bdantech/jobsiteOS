import type { Metadata } from 'next'
import { AlertCircle } from 'lucide-react'
import { requireSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { UsuariosTable, type UsuarioLinha, type PerfilOpcao } from '@/components/admin/usuarios-table'
import { NovoUsuarioDialog } from '@/components/admin/novo-usuario-dialog'

export const metadata: Metadata = {
  title: 'Usuários',
}

/**
 * Reads run on the USER-SCOPED client, not the service role: the caller is an
 * admin (the layout guaranteed it), and `perfis` is gated by app_is_admin()
 * under RLS — so the database re-checks the authorization instead of us
 * switching it off. Only the WRITES need the service role (see actions/admin.ts).
 */
export default async function UsuariosPage() {
  const { user } = await requireSessionContext()

  const supabase = await createClient()

  const [usuariosResult, perfisResult, modulosResult] = await Promise.all([
    supabase
      .from('usuarios')
      .select('id, nome, email, perfil_id, ativo, must_change_password, criado_em')
      .order('nome'),
    supabase.from('perfis').select('id, nome').order('nome'),
    supabase.from('perfil_modulos').select('perfil_id').eq('modulo_id', 'admin'),
  ])

  if (usuariosResult.error || perfisResult.error || modulosResult.error) {
    return (
      <Card className="border-destructive/50">
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <AlertCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
          <div>
            <CardTitle className="text-base">Não foi possível carregar os usuários</CardTitle>
            <CardDescription>
              Ocorreu um erro ao consultar o banco de dados. Recarregue a página e tente novamente.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>
    )
  }

  const perfisAdmin = new Set(modulosResult.data.map((m) => m.perfil_id))

  const usuarios: UsuarioLinha[] = usuariosResult.data.map((u) => ({
    id: u.id,
    nome: u.nome,
    email: u.email,
    perfil_id: u.perfil_id,
    ativo: u.ativo,
    must_change_password: u.must_change_password,
    criado_em: u.criado_em,
  }))

  const perfis: PerfilOpcao[] = perfisResult.data.map((p) => ({
    id: p.id,
    nome: p.nome,
    concedeAdmin: perfisAdmin.has(p.id),
  }))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Usuários</h2>
          <p className="text-sm text-muted-foreground">
            {usuarios.length === 1 ? '1 usuário cadastrado' : `${usuarios.length} usuários cadastrados`}
          </p>
        </div>

        <NovoUsuarioDialog perfis={perfis} />
      </div>

      {perfis.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nenhum perfil cadastrado</CardTitle>
            <CardDescription>
              Crie um perfil de acesso antes de cadastrar usuários — um usuário sem perfil não
              enxerga nenhum módulo.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {usuarios.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CardTitle className="text-base">Nenhum usuário cadastrado</CardTitle>
            <CardDescription>
              Clique em &quot;Novo usuário&quot; para cadastrar o primeiro acesso.
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <UsuariosTable usuarios={usuarios} perfis={perfis} usuarioAtualId={user.id} />
      )}
    </div>
  )
}
