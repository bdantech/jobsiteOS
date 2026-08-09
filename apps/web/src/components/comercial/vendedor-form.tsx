'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { TIPOS_VENDEDOR, TIPO_VENDEDOR_LABELS, type TipoVendedorId } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { salvarTerritorioAction, salvarVendedorAction } from '@/actions/comercial'
import type { Tables } from '@jobsiteos/core'

/**
 * Cadastro de vendedor — o formulário que faltava, e que agora escreve por RPC com
 * audit, como o resto do sistema.
 *
 * Duas coisas que o formulário decide, e não o usuário:
 *
 *   NÃO EXISTE EXCLUIR. Vendedor se desativa. Apagar levaria junto a explicação de
 *   comissões já pagas — o histórico de carteira aponta para ele.
 *
 *   O TERRITÓRIO É SALVO JUNTO, na mesma submissão. Separá-lo em outra tela produziria
 *   o estado que o roteador mais odeia: originador ativo com território em branco, que
 *   não casa com nada e não diz por quê.
 */

const SETTINGS_POR_TIPO: Record<TipoVendedorId, string> = {
  sdr: 'Direção (in/out/both) e cota semanal.',
  originador: 'Carteira explícita de empresas (definida na ficha de cada empresa).',
  vendedor: 'Sem ajustes nesta versão — metas ficam para a fase 2.',
}

async function buscarUsuarios() {
  const supabase = createClient()
  const { data } = await supabase.from('usuarios').select('id, nome, email').eq('ativo', true).order('nome')
  return data ?? []
}

export interface VendedorFormProps {
  aberto: boolean
  onOpenChange: (v: boolean) => void
  /** null = novo. */
  vendedor: Tables<'vendedores'> | null
  territorio: Tables<'vendedor_territorios'> | null
}

export function VendedorForm({ aberto, onOpenChange, vendedor, territorio }: VendedorFormProps) {
  const qc = useQueryClient()
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const [tipo, setTipo] = React.useState<TipoVendedorId>((vendedor?.tipo as TipoVendedorId) ?? 'sdr')
  const [ehIa, setEhIa] = React.useState(vendedor?.is_ia ?? false)

  const usuarios = useQuery({ queryKey: ['comercial', 'usuarios'], queryFn: buscarUsuarios, enabled: aberto })

  React.useEffect(() => {
    if (!aberto) return
    setTipo((vendedor?.tipo as TipoVendedorId) ?? 'sdr')
    setEhIa(vendedor?.is_ia ?? false)
    setErro(null)
  }, [aberto, vendedor])

  const settings = (vendedor?.settings ?? {}) as { direcao?: string; empresas_por_semana?: number }

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setSalvando(true)
    setErro(null)

    const novasSettings: Record<string, unknown> = { ...(vendedor?.settings as object) }
    if (tipo === 'sdr') {
      novasSettings.direcao = String(fd.get('direcao') ?? 'both')
      const cota = Number(fd.get('cota'))
      if (Number.isFinite(cota) && cota > 0) novasSettings.empresas_por_semana = cota
      else delete novasSettings.empresas_por_semana
    }

    const r = await salvarVendedorAction({
      id: vendedor?.id,
      nome: String(fd.get('nome') ?? ''),
      tipo,
      usuario_id: ehIa ? null : String(fd.get('usuario_id') ?? '') || null,
      is_ia: ehIa,
      email_remetente: String(fd.get('email_remetente') ?? '') || null,
      settings: novasSettings,
      ativo: fd.get('ativo') === 'on',
    })

    if (!r.ok) {
      setSalvando(false)
      setErro(r.message)
      return
    }

    // Território na mesma submissão. Só para originador e SDR: o closer não recebe por
    // território, ele recebe reunião agendada por alguém.
    const id = r.data.id ?? vendedor?.id
    if (id && tipo !== 'vendedor') {
      const ufs = String(fd.get('ufs') ?? '')
        .split(',')
        .map((u) => u.trim().toUpperCase())
        .filter(Boolean)
      const min = fd.get('fat_min') ? Number(fd.get('fat_min')) : null
      const max = fd.get('fat_max') ? Number(fd.get('fat_max')) : null
      const t = await salvarTerritorioAction({
        vendedor_id: id,
        ufs,
        faturamento_min: min,
        faturamento_max: max,
      })
      if (!t.ok) {
        setSalvando(false)
        setErro(t.message)
        return
      }
    }

    setSalvando(false)
    toast.success(vendedor ? 'Vendedor atualizado.' : 'Vendedor cadastrado.')
    void qc.invalidateQueries({ queryKey: ['comercial'] })
    onOpenChange(false)
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={enviar}>
          <DialogHeader>
            <DialogTitle>{vendedor ? 'Editar vendedor' : 'Novo vendedor'}</DialogTitle>
            <DialogDescription>
              Não existe excluir: vendedor se desativa. Apagar levaria junto a explicação de
              comissões já pagas.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="nome">Nome</Label>
              <Input id="nome" name="nome" defaultValue={vendedor?.nome ?? ''} required minLength={2} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tipo">Tipo</Label>
              <select
                id="tipo"
                name="tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoVendedorId)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {TIPOS_VENDEDOR.map((t) => (
                  <option key={t} value={t}>{TIPO_VENDEDOR_LABELS[t]}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{SETTINGS_POR_TIPO[tipo]}</p>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ehIa} onChange={(e) => setEhIa(e.target.checked)} />
              Vendedor de IA (tem nome próprio e não tem login)
            </label>

            {!ehIa && (
              <div className="space-y-1.5">
                <Label htmlFor="usuario_id">Usuário</Label>
                <select
                  id="usuario_id"
                  name="usuario_id"
                  defaultValue={vendedor?.usuario_id ?? ''}
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione…</option>
                  {(usuarios.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>{u.nome} · {u.email}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  É por aqui que &quot;Meu Painel&quot; sabe de quem é o funil.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email_remetente">E-mail remetente (opcional)</Label>
              <Input
                id="email_remetente"
                name="email_remetente"
                type="email"
                defaultValue={vendedor?.email_remetente ?? ''}
              />
            </div>

            {tipo === 'sdr' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="direcao">Direção</Label>
                  <select
                    id="direcao"
                    name="direcao"
                    defaultValue={settings.direcao ?? 'both'}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="out">Saída (recebe da distribuição)</option>
                    <option value="in">Entrada (recebe inbound, criado à mão)</option>
                    <option value="both">Os dois</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cota">Empresas por semana</Label>
                  <Input
                    id="cota"
                    name="cota"
                    type="number"
                    min={1}
                    placeholder="herda a config global"
                    defaultValue={settings.empresas_por_semana ?? ''}
                  />
                </div>
              </div>
            )}

            {tipo !== 'vendedor' && (
              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Território</p>
                <p className="text-xs text-muted-foreground">
                  Em branco NÃO significa &quot;atende tudo&quot;: o roteador ignora território
                  vazio, senão um cadastro incompleto abocanha a base inteira.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="ufs">UFs (separadas por vírgula)</Label>
                  <Input
                    id="ufs"
                    name="ufs"
                    placeholder="SP, MG, PR"
                    defaultValue={(territorio?.ufs ?? []).join(', ')}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="fat_min">Faturamento mínimo</Label>
                    <Input id="fat_min" name="fat_min" type="number" min={0} step="1000"
                      defaultValue={territorio?.faturamento_min ?? ''} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fat_max">Faturamento máximo</Label>
                    <Input id="fat_max" name="fat_max" type="number" min={0} step="1000"
                      defaultValue={territorio?.faturamento_max ?? ''} />
                  </div>
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="ativo" defaultChecked={vendedor?.ativo ?? true} />
              Ativo
            </label>
          </div>

          {erro ? <p className="pb-2 text-sm text-destructive">{erro}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
