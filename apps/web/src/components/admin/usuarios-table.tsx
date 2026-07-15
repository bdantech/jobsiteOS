'use client'

import { useState, useTransition } from 'react'
import { MoreHorizontal, ShieldCheck, UserCheck, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { definirAtivoUsuarioAction, definirPerfilUsuarioAction } from '@/actions/admin'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface UsuarioLinha {
  id: string
  nome: string
  email: string
  perfil_id: string | null
  ativo: boolean
  must_change_password: boolean
  criado_em: string
}

export interface PerfilOpcao {
  id: string
  nome: string
  concedeAdmin: boolean
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  const primeira = partes[0]?.[0] ?? '?'
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : ''
  return (primeira + ultima).toUpperCase()
}

export function UsuariosTable({
  usuarios,
  perfis,
  usuarioAtualId,
}: {
  usuarios: UsuarioLinha[]
  perfis: PerfilOpcao[]
  usuarioAtualId: string
}) {
  const [pending, startTransition] = useTransition()
  // Which row is mid-flight. Disabling only that row's controls (instead of the
  // whole table) keeps the UI honest about what is actually being changed.
  const [emAndamento, setEmAndamento] = useState<string | null>(null)

  function alterarPerfil(usuario: UsuarioLinha, perfilId: string) {
    if (perfilId === usuario.perfil_id) return

    setEmAndamento(usuario.id)
    startTransition(async () => {
      const resultado = await definirPerfilUsuarioAction({
        usuario_id: usuario.id,
        perfil_id: perfilId,
      })
      setEmAndamento(null)

      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }

      const perfil = perfis.find((p) => p.id === perfilId)
      toast.success(`Perfil de ${usuario.nome} alterado para ${perfil?.nome ?? 'novo perfil'}.`)
    })
  }

  function alterarAtivo(usuario: UsuarioLinha, ativo: boolean) {
    setEmAndamento(usuario.id)
    startTransition(async () => {
      const resultado = await definirAtivoUsuarioAction({ usuario_id: usuario.id, ativo })
      setEmAndamento(null)

      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }

      toast.success(ativo ? `${usuario.nome} foi reativado.` : `${usuario.nome} foi desativado.`)
    })
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Usuário</TableHead>
            <TableHead>Perfil</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[52px]">
              <span className="sr-only">Ações</span>
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {usuarios.map((usuario) => {
            const ehVoce = usuario.id === usuarioAtualId
            const linhaOcupada = pending && emAndamento === usuario.id

            return (
              <TableRow key={usuario.id} className={cn(!usuario.ativo && 'opacity-60')}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="text-xs">{iniciais(usuario.nome)}</AvatarFallback>
                    </Avatar>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{usuario.nome}</span>
                        {ehVoce ? (
                          <span className="shrink-0 text-xs text-muted-foreground">(você)</span>
                        ) : null}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">{usuario.email}</div>
                    </div>
                  </div>
                </TableCell>

                <TableCell>
                  <Select
                    value={usuario.perfil_id ?? undefined}
                    onValueChange={(valor) => alterarPerfil(usuario, valor)}
                    disabled={linhaOcupada || perfis.length === 0}
                  >
                    <SelectTrigger className="w-[190px]">
                      <SelectValue placeholder="Sem perfil" />
                    </SelectTrigger>
                    <SelectContent>
                      {perfis.map((perfil) => (
                        <SelectItem key={perfil.id} value={perfil.id}>
                          <span className="flex items-center gap-1.5">
                            {perfil.nome}
                            {perfil.concedeAdmin ? (
                              <ShieldCheck
                                className="h-3.5 w-3.5 text-primary"
                                aria-label="Concede acesso à Administração"
                              />
                            ) : null}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>

                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <Badge variant={usuario.ativo ? 'default' : 'secondary'}>
                      {usuario.ativo ? 'Ativo' : 'Inativo'}
                    </Badge>
                    {usuario.must_change_password && usuario.ativo ? (
                      <span className="text-xs text-muted-foreground">Senha pendente</span>
                    ) : null}
                  </div>
                </TableCell>

                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={linhaOcupada}
                        aria-label={`Ações para ${usuario.nome}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>

                    <DropdownMenuContent align="end">
                      {usuario.ativo ? (
                        <DropdownMenuItem
                          // Deactivating yourself would log you out on the next
                          // request. The server refuses it too.
                          disabled={ehVoce}
                          onSelect={() => alterarAtivo(usuario, false)}
                          className="text-destructive focus:text-destructive"
                        >
                          <UserX className="mr-2 h-4 w-4" />
                          Desativar
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => alterarAtivo(usuario, true)}>
                          <UserCheck className="mr-2 h-4 w-4" />
                          Reativar
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}
