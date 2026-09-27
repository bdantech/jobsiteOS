'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CAUSAS_SINISTRO, CAUSA_SINISTRO_LABELS, type CausaSinistro } from '@jobsiteos/core'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { criarSinistroAction } from '@/actions/cobranca-gestao'
import { buscarTitulosVencidos, gestaoKeys, type TituloVencido } from './gestao-queries'
import { brl, cnpj, data } from './format'

/**
 * Novo sinistro: escolher o COMPRADOR (o grupo do sacado) e os títulos.
 *
 * Um sinistro é de um grupo só — a franquia é por comprador (§7.3), e fatiar por SPE
 * faria cada fatia cair abaixo dela. Por isso a tela começa pelo grupo e só oferece os
 * títulos dele; a RPC recusa de novo se alguém mandar dois grupos.
 *
 * Causa e Data da Perda ficam em branco por padrão: a RPC tira as duas do relógio da
 * apólice (insolvência registrada muda a causa e a data). Preencher aqui é exceção.
 */
export function NovoSinistroDialog({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const router = useRouter()
  const qc = useQueryClient()
  const titulos = useQuery({
    queryKey: gestaoKeys.titulosVencidos(),
    queryFn: buscarTitulosVencidos,
    enabled: aberto,
  })
  const [busca, setBusca] = React.useState('')
  const [grupo, setGrupo] = React.useState<string | null>(null)
  const [marcados, setMarcados] = React.useState<Set<string>>(new Set())
  const [causa, setCausa] = React.useState<'auto' | CausaSinistro>('auto')
  const [dataPerda, setDataPerda] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)

  React.useEffect(() => {
    if (!aberto) {
      setBusca('')
      setGrupo(null)
      setMarcados(new Set())
      setCausa('auto')
      setDataPerda('')
    }
  }, [aberto])

  const grupos = React.useMemo(() => {
    const m = new Map<string, { matriz: string; nome: string | null; qtd: number; valor: number; itens: TituloVencido[] }>()
    for (const t of titulos.data ?? []) {
      const g = m.get(t.sacado_matriz_cnpj) ?? { matriz: t.sacado_matriz_cnpj, nome: null, qtd: 0, valor: 0, itens: [] }
      if (t.sacado_cnpj === t.sacado_matriz_cnpj || !g.nome) g.nome = t.sacado_nome ?? g.nome
      g.qtd++
      g.valor += t.valor_face
      g.itens.push(t)
      m.set(t.sacado_matriz_cnpj, g)
    }
    return [...m.values()].sort((a, b) => b.valor - a.valor)
  }, [titulos.data])

  const termo = busca.trim().toLowerCase()
  const soDigitos = termo.replace(/\D/g, '')
  const filtrados = termo
    ? grupos.filter(
        (g) =>
          (g.nome ?? '').toLowerCase().includes(termo) ||
          (soDigitos.length >= 3 && g.itens.some((i) => i.sacado_cnpj.includes(soDigitos))),
      )
    : grupos
  const escolhido = grupos.find((g) => g.matriz === grupo) ?? null
  const selecionados = escolhido?.itens.filter((i) => marcados.has(i.id)) ?? []

  // Se todos os títulos marcados estão na mesma cobrança, o sinistro nasce ligado a ela
  // (é de lá que saem as notificações e a prova de entrega do dossiê).
  const cobrancas = new Set(selecionados.map((s) => s.cobranca_ativa_id).filter(Boolean))
  const cobrancaId = cobrancas.size === 1 ? ([...cobrancas][0] as string) : undefined

  async function criar() {
    setEnviando(true)
    const r = await criarSinistroAction({
      titulo_ids: selecionados.map((s) => s.id),
      cobranca_id: cobrancaId,
      causa: causa === 'auto' ? undefined : causa,
      data_perda: dataPerda || undefined,
    })
    setEnviando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(`Sinistro ${r.data.codigo ?? ''} aberto com o checklist do dossiê.`)
    void qc.invalidateQueries({ queryKey: gestaoKeys.all })
    onFechar()
    router.push(`/cobranca/sinistros/${r.data.id}`)
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? onFechar() : null)}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo sinistro</DialogTitle>
          <DialogDescription>
            Um sinistro consolida os títulos de UM comprador (o grupo inteiro do sacado): a franquia é por comprador.
          </DialogDescription>
        </DialogHeader>

        {titulos.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !escolhido ? (
          <div className="space-y-2">
            <Input placeholder="Buscar sacado por razão social ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {filtrados.slice(0, 100).map((g) => (
                <li key={g.matriz}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      setGrupo(g.matriz)
                      // Por padrão, todos os títulos do grupo já em cobrança: é o caso comum.
                      setMarcados(new Set(g.itens.filter((i) => i.cobranca_ativa_id).map((i) => i.id)))
                    }}
                  >
                    <span>
                      {g.nome ?? 'Sacado'} <span className="font-mono text-xs text-muted-foreground">{cnpj(g.matriz)}</span>
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {g.qtd} vencido(s) · {brl(g.valor)}
                    </span>
                  </button>
                </li>
              ))}
              {filtrados.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum grupo com títulos vencidos.</li>
              ) : null}
            </ul>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">
                {escolhido.nome} <span className="font-mono text-xs text-muted-foreground">{cnpj(escolhido.matriz)}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setGrupo(null)}>
                Trocar sacado
              </Button>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="w-8 px-2 py-1">
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos"
                        checked={selecionados.length === escolhido.itens.length}
                        onChange={(e) =>
                          setMarcados(e.target.checked ? new Set(escolhido.itens.map((i) => i.id)) : new Set())
                        }
                      />
                    </th>
                    <th className="px-2 py-1 text-left font-medium">Título</th>
                    <th className="px-2 py-1 text-left font-medium">Devedora</th>
                    <th className="px-2 py-1 text-left font-medium">Vencimento</th>
                    <th className="px-2 py-1 text-right font-medium">Atraso</th>
                    <th className="px-2 py-1 text-right font-medium">Face</th>
                    <th className="px-2 py-1 text-left font-medium">Cobrança</th>
                  </tr>
                </thead>
                <tbody>
                  {escolhido.itens.map((t) => (
                    <tr key={t.id} className="border-t border-border">
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Título ${t.numero ?? t.externo_id}`}
                          checked={marcados.has(t.id)}
                          onChange={(e) => {
                            const n = new Set(marcados)
                            if (e.target.checked) n.add(t.id)
                            else n.delete(t.id)
                            setMarcados(n)
                          }}
                        />
                      </td>
                      <td className="px-2 py-1">
                        {t.numero ?? t.externo_id}
                        {!t.coberto_apolice ? <span className="ml-1 text-amber-600">(não segurado)</span> : null}
                      </td>
                      <td className="px-2 py-1">{t.sacado_nome ?? cnpj(t.sacado_cnpj)}</td>
                      <td className="px-2 py-1">{data(t.vencimento)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{t.dias_atraso ?? '—'} d</td>
                      <td className="px-2 py-1 text-right tabular-nums">{brl(t.valor_face)}</td>
                      <td className="px-2 py-1">{t.cobranca_ativa_codigo ?? <span className="text-muted-foreground">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Causa</Label>
                <Select value={causa} onValueChange={(v) => setCausa(v as 'auto' | CausaSinistro)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Do relógio da apólice (recomendado)</SelectItem>
                    {CAUSAS_SINISTRO.map((c) => (
                      <SelectItem key={c} value={c}>
                        {CAUSA_SINISTRO_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="sin-perda">Data da Perda (opcional)</Label>
                <Input id="sin-perda" type="date" value={dataPerda} onChange={(e) => setDataPerda(e.target.value)} />
                <p className="text-[11px] text-muted-foreground">Em branco: a do relógio (D+180, ou a data da decisão na insolvência).</p>
              </div>
            </div>

            <p className="text-sm">
              {selecionados.length} título(s) · <strong>{brl(selecionados.reduce((s, t) => s + t.valor_face, 0))}</strong>
              {cobrancas.size > 1 ? (
                <span className="ml-2 text-xs text-amber-600">
                  títulos de {cobrancas.size} cobranças diferentes — o sinistro não ficará ligado a nenhuma delas
                </span>
              ) : null}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={() => void criar()} disabled={enviando || selecionados.length === 0}>
            {enviando ? 'Abrindo…' : 'Abrir sinistro'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
