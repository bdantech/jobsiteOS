'use client'

import { useState, useTransition } from 'react'
import { Info } from 'lucide-react'
import { toast } from 'sonner'
import { salvarPerfilAction } from '@/actions/admin'
import type { ModuloOpcao, PerfilDetalhe } from '@/components/admin/perfis-manager'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'

/**
 * Create/edit a perfil. One Switch per entry in MODULES — the registry is the
 * only source of what a module is, so this list needs no maintenance when a
 * module is added: it appears here automatically.
 *
 * Hand-rolled state rather than react-hook-form: the payload is a name, a
 * description and a Set of module ids, and the interesting logic (the admin
 * lockout rule) is not a per-field validation. A resolver would add ceremony
 * without buying anything.
 */
export function PerfilDialog({
  aberto,
  onAbertoChange,
  perfil,
  modulos,
  perfisComAdmin,
}: {
  aberto: boolean
  onAbertoChange: (aberto: boolean) => void
  perfil: PerfilDetalhe | null
  modulos: ModuloOpcao[]
  perfisComAdmin: number
}) {
  const [nome, setNome] = useState(perfil?.nome ?? '')
  const [descricao, setDescricao] = useState(perfil?.descricao ?? '')
  const [concedidos, setConcedidos] = useState<string[]>(perfil?.modulos ?? [])
  const [erroNome, setErroNome] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  /**
   * The lockout rule, mirrored client-side purely so the switch is visibly
   * locked instead of failing on save. salvarPerfilAction enforces it for real —
   * this is a hint, not the control.
   */
  const ehUltimoPerfilAdmin =
    perfil !== null && perfil.modulos.includes('admin') && perfisComAdmin <= 1

  function alternar(moduloId: string, ativo: boolean) {
    if (moduloId === 'admin' && !ativo && ehUltimoPerfilAdmin) {
      toast.error(
        'Este é o último perfil com acesso à Administração. Conceda o módulo a outro perfil antes de removê-lo daqui.',
      )
      return
    }

    setConcedidos((atual) =>
      ativo ? [...new Set([...atual, moduloId])] : atual.filter((id) => id !== moduloId),
    )
  }

  function salvar() {
    setErroNome(null)

    startTransition(async () => {
      const resultado = await salvarPerfilAction({
        id: perfil?.id,
        nome,
        descricao: descricao.trim() === '' ? null : descricao,
        modulos: concedidos,
      })

      if (!resultado.ok) {
        const mensagemNome = resultado.fieldErrors?.nome?.[0]
        if (mensagemNome) setErroNome(mensagemNome)
        toast.error(resultado.message)
        return
      }

      toast.success(perfil ? `Perfil "${nome}" atualizado.` : `Perfil "${nome}" criado.`)
      onAbertoChange(false)
    })
  }

  return (
    <Dialog open={aberto} onOpenChange={(proximo) => !pending && onAbertoChange(proximo)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{perfil ? 'Editar perfil' : 'Novo perfil'}</DialogTitle>
          <DialogDescription>
            Defina o nome do perfil e quais módulos ele concede.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="perfil-nome">Nome</Label>
            <Input
              id="perfil-nome"
              value={nome}
              onChange={(e) => {
                setNome(e.target.value)
                setErroNome(null)
              }}
              placeholder="Comercial"
              aria-invalid={erroNome !== null}
              aria-describedby={erroNome ? 'perfil-nome-erro' : undefined}
            />
            {erroNome ? (
              <p id="perfil-nome-erro" className="text-sm font-medium text-destructive">
                {erroNome}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="perfil-descricao">Descrição</Label>
            <Textarea
              id="perfil-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Time de vendas: acessa empresas e notificações."
              rows={2}
            />
          </div>

          <Separator />

          <div className="flex flex-col gap-3">
            <div>
              <h3 className="text-sm font-medium">Módulos</h3>
              <p className="text-sm text-muted-foreground">
                Um usuário deste perfil enxerga apenas os módulos ativados aqui.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {modulos.map((modulo) => {
                const ativo = concedidos.includes(modulo.id)
                const travado = modulo.id === 'admin' && ativo && ehUltimoPerfilAdmin

                return (
                  <div key={modulo.id} className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <Label htmlFor={`modulo-${modulo.id}`} className="cursor-pointer">
                        {modulo.nome}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {modulo.rota}
                        {modulo.webOnly ? ' · apenas web' : ''}
                      </p>
                    </div>

                    <Switch
                      id={`modulo-${modulo.id}`}
                      checked={ativo}
                      disabled={travado}
                      onCheckedChange={(marcado) => alternar(modulo.id, marcado)}
                      aria-label={`Conceder o módulo ${modulo.nome}`}
                    />
                  </div>
                )
              })}
            </div>

            {ehUltimoPerfilAdmin ? (
              <div className="flex gap-2 rounded-md border bg-muted/50 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Este é o último perfil com acesso à Administração. O módulo não pode ser removido
                  daqui — caso contrário ninguém conseguiria administrar o sistema.
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onAbertoChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={pending || nome.trim() === ''}>
            {pending ? 'Salvando…' : 'Salvar perfil'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
