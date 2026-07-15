'use client'

import { useState, useTransition } from 'react'
import { Pencil, Plus, Shield, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { excluirPerfilAction } from '@/actions/admin'
import { PerfilDialog } from '@/components/admin/perfil-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface ModuloOpcao {
  id: string
  nome: string
  rota: string
  webOnly: boolean
}

export interface PerfilDetalhe {
  id: string
  nome: string
  descricao: string | null
  modulos: string[]
  totalUsuarios: number
}

export function PerfisManager({
  perfis,
  modulos,
  perfisComAdmin,
}: {
  perfis: PerfilDetalhe[]
  modulos: ModuloOpcao[]
  perfisComAdmin: number
}) {
  const [editando, setEditando] = useState<PerfilDetalhe | null>(null)
  const [criando, setCriando] = useState(false)
  const [excluindo, setExcluindo] = useState<PerfilDetalhe | null>(null)
  const [pending, startTransition] = useTransition()

  const nomesPorModulo = new Map(modulos.map((m) => [m.id, m.nome]))

  function confirmarExclusao(perfil: PerfilDetalhe) {
    startTransition(async () => {
      const resultado = await excluirPerfilAction({ perfil_id: perfil.id })

      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }

      toast.success(`Perfil "${perfil.nome}" excluído.`)
      setExcluindo(null)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Perfis</h2>
          <p className="text-sm text-muted-foreground">
            Cada perfil concede acesso a um conjunto de módulos.
          </p>
        </div>

        <Button onClick={() => setCriando(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Novo perfil
        </Button>
      </div>

      {perfis.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CardTitle className="text-base">Nenhum perfil cadastrado</CardTitle>
            <CardDescription>
              Crie um perfil para poder cadastrar usuários e conceder acesso aos módulos.
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {perfis.map((perfil) => {
            const ehAdmin = perfil.modulos.includes('admin')
            // The last perfil that still grants 'admin' is load-bearing: without
            // it nobody can ever reach this screen again.
            const ehUltimoAdmin = ehAdmin && perfisComAdmin <= 1

            return (
              <Card key={perfil.id} className="flex flex-col">
                <CardHeader className="gap-1">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {perfil.nome}
                      {ehAdmin ? (
                        <Shield
                          className="h-4 w-4 text-primary"
                          aria-label="Concede acesso à Administração"
                        />
                      ) : null}
                    </CardTitle>
                  </div>
                  <CardDescription>
                    {perfil.descricao?.trim() || 'Sem descrição.'}
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col gap-3">
                  {perfil.modulos.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nenhum módulo concedido — quem usa este perfil não enxerga nada.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {perfil.modulos.map((id) => (
                        <Badge key={id} variant="secondary">
                          {nomesPorModulo.get(id) ?? id}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="mt-auto flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Users className="h-4 w-4" aria-hidden="true" />
                    {perfil.totalUsuarios === 1
                      ? '1 usuário'
                      : `${perfil.totalUsuarios} usuários`}
                  </div>
                </CardContent>

                <CardFooter className="gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditando(perfil)}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    Editar
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={ehUltimoAdmin || perfil.totalUsuarios > 0}
                    title={
                      ehUltimoAdmin
                        ? 'É o último perfil com acesso à Administração.'
                        : perfil.totalUsuarios > 0
                          ? 'Há usuários vinculados a este perfil.'
                          : undefined
                    }
                    onClick={() => setExcluindo(perfil)}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Excluir
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      )}

      <PerfilDialog
        aberto={criando}
        onAbertoChange={setCriando}
        perfil={null}
        modulos={modulos}
        perfisComAdmin={perfisComAdmin}
      />

      <PerfilDialog
        // Remount per perfil so the form's defaultValues re-initialise instead of
        // keeping the previously edited perfil's state.
        key={editando?.id ?? 'nenhum'}
        aberto={editando !== null}
        onAbertoChange={(aberto) => !aberto && setEditando(null)}
        perfil={editando}
        modulos={modulos}
        perfisComAdmin={perfisComAdmin}
      />

      <Dialog
        open={excluindo !== null}
        onOpenChange={(aberto) => !aberto && !pending && setExcluindo(null)}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Excluir perfil</DialogTitle>
            <DialogDescription>
              O perfil <strong>{excluindo?.nome}</strong> será excluído permanentemente. Esta ação
              não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExcluindo(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => excluindo && confirmarExclusao(excluindo)}
            >
              {pending ? 'Excluindo…' : 'Excluir perfil'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
