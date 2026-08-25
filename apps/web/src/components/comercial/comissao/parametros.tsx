'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Lock, Plus } from 'lucide-react'
import {
  GRUPO_PARAMETRO_LABELS,
  PARAMETROS_COMISSAO,
  UNIDADE_PARAMETRO_SUFIXO,
  type ParametroCatalogado,
  type Tables,
  type UnidadeParametro,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { salvarParametroAction } from '@/actions/comercial'
import {
  buscarCompetencias,
  buscarParametros,
  comissaoKeys,
  type ParametroComVendedor,
} from '../queries-comissao'
import { data as fmtData, numero } from './format'

/**
 * Regras de comissão: os parâmetros, com vigência, geral e por vendedor.
 *
 * Não existe EDITAR. Publicar é abrir uma vigência nova e encerrar a anterior no mesmo
 * dia — editar o valor de uma linha vigente desde março reprecificaria março inteiro em
 * silêncio, que é o erro mais caro que esta tela poderia permitir.
 *
 * A tela lista o CATÁLOGO inteiro, inclusive o que ninguém publicou. Uma tela que só
 * mostra o publicado esconde justamente o parâmetro esquecido — e o esquecido é o que
 * faz alguém não receber, sem erro nenhum aparecer em lugar nenhum.
 *
 * `vigente_ate` no banco é EXCLUSIVO; aqui mostramos a véspera, que é o que uma pessoa lê
 * como "até".
 */

const brlOuNumero = (valor: number, unidade: string): string => {
  if (unidade === 'BRL' || unidade === 'BRL_PER_MM') {
    return `${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}${
      unidade === 'BRL_PER_MM' ? '/MM' : ''
    }`
  }
  if (unidade === 'BOOL') return valor ? 'ligado' : 'desligado'
  const sufixo = UNIDADE_PARAMETRO_SUFIXO[unidade as UnidadeParametro] ?? ''
  return `${numero(valor)}${sufixo ? ` ${sufixo}` : ''}`
}

/** O último dia coberto: `vigente_ate` é exclusivo, então mostramos a véspera. */
function ateInclusive(vigenteAte: string | null): string {
  if (!vigenteAte) return '— vigente'
  const d = new Date(`${vigenteAte}T12:00:00`)
  d.setDate(d.getDate() - 1)
  return `até ${d.toLocaleDateString('pt-BR')}`
}

function PublicarDialog({
  aberto, onOpenChange, catalogo, vendedores, onSalvo, competenciaFechadaAte,
}: {
  aberto: ParametroCatalogado | null
  onOpenChange: (v: boolean) => void
  catalogo: readonly ParametroCatalogado[]
  vendedores: readonly Tables<'vendedores'>[]
  onSalvo: () => void
  competenciaFechadaAte: string | null
}) {
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const p = aberto

  /*
   * O default é o primeiro dia do mês corrente OU o dia seguinte à última competência
   * fechada — o que for maior. Oferecer "hoje" numa competência já fechada faria a pessoa
   * preencher o formulário inteiro para receber uma recusa no fim.
   */
  const hoje = new Date().toISOString().slice(0, 10)
  const minimo = React.useMemo(() => {
    if (!competenciaFechadaAte) return hoje
    const d = new Date(`${competenciaFechadaAte}T12:00:00`)
    d.setMonth(d.getMonth() + 1)
    const primeiroAberto = d.toISOString().slice(0, 10)
    return primeiroAberto > hoje ? primeiroAberto : hoje
  }, [competenciaFechadaAte, hoje])

  if (!p) return null
  void catalogo

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            setSalvando(true)
            setErro(null)
            const r = await salvarParametroAction({
              chave: p.chave,
              vendedor_id: String(fd.get('vendedor_id') ?? '') || null,
              valor: Number(fd.get('valor')),
              unidade: p.unidade,
              vigente_de: String(fd.get('vigente_de') ?? '') || undefined,
            })
            setSalvando(false)
            if (!r.ok) return setErro(r.message)
            toast.success('Parâmetro publicado. A vigência anterior foi encerrada no mesmo dia.')
            onOpenChange(false)
            onSalvo()
          }}
        >
          <DialogHeader>
            <DialogTitle>Publicar — {p.rotulo}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <p className="text-sm text-muted-foreground">{p.descricao}</p>

            {p.aceitaOverride ? (
              <div className="space-y-1.5">
                <Label htmlFor="param-vendedor">Aplicar a</Label>
                <select
                  id="param-vendedor"
                  name="vendedor_id"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Toda a empresa (parâmetro geral)</option>
                  {vendedores.filter((v) => v.ativo).map((v) => (
                    <option key={v.id} value={v.id}>{v.nome} (override pessoal)</option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
                Prazo é sempre GERAL: um sunset diferente por pessoa faria a mesma conta ter
                duas idades. Só taxa aceita override por vendedor.
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="param-valor">
                Valor {UNIDADE_PARAMETRO_SUFIXO[p.unidade] ? `(${UNIDADE_PARAMETRO_SUFIXO[p.unidade]})` : ''}
              </Label>
              <Input id="param-valor" name="valor" type="number" step="any" required className="tabular-nums" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="param-de">Vigente a partir de</Label>
              <Input id="param-de" name="vigente_de" type="date" required defaultValue={minimo} min={minimo} />
              <p className="text-xs text-muted-foreground">
                Competência fechada é imutável — não dá para publicar dentro dela. O que já
                foi lançado guarda o parâmetro que valia no dia do fato gerador.
              </p>
            </div>
          </div>
          {erro ? <p className="pb-2 text-sm text-destructive">{erro}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={salvando}>{salvando ? 'Publicando…' : 'Publicar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function Parametros({ vendedores }: { vendedores: readonly Tables<'vendedores'>[] }) {
  const qc = useQueryClient()
  const [escopo, setEscopo] = React.useState<'geral' | 'override'>('geral')
  const [publicando, setPublicando] = React.useState<ParametroCatalogado | null>(null)

  const params = useQuery({ queryKey: comissaoKeys.parametros(), queryFn: buscarParametros })
  const competencias = useQuery({ queryKey: comissaoKeys.competencias(), queryFn: buscarCompetencias })

  if (params.isPending) return <Skeleton className="h-96 w-full" />

  const todos = params.data ?? []
  const hoje = new Date().toISOString().slice(0, 10)
  const vigenteDe = (chave: string, vendedorId: string | null): ParametroComVendedor | undefined =>
    todos.find(
      (p) =>
        p.chave === chave &&
        p.vendedor_id === vendedorId &&
        p.vigente_de <= hoje &&
        (p.vigente_ate === null || p.vigente_ate > hoje),
    )

  const fechadaAte = competencias.data?.[0]?.competencia ?? null
  const grupos = [...new Set(PARAMETROS_COMISSAO.map((p) => p.grupo))]
  const overrides = todos.filter((p) => p.vendedor_id !== null)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Regras de comissão</CardTitle>
              <CardDescription>
                Parâmetro tem VIGÊNCIA: mudar o valor hoje não reprecifica o que já foi
                lançado. Publicar abre uma vigência nova e encerra a anterior — nada é
                editado no lugar.
                {fechadaAte ? (
                  <span className="mt-1 flex items-center gap-1 text-xs">
                    <Lock className="h-3 w-3" aria-hidden />
                    Competências até {fmtData(fechadaAte)} estão fechadas e não aceitam
                    publicação retroativa.
                  </span>
                ) : null}
              </CardDescription>
            </div>
            <Tabs value={escopo} onValueChange={(v) => setEscopo(v as 'geral' | 'override')}>
              <TabsList>
                <TabsTrigger value="geral">Geral</TabsTrigger>
                <TabsTrigger value="override">Por vendedor ({overrides.length})</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {escopo === 'geral' ? (
            <div className="divide-y">
              {grupos.map((g) => (
                <section key={g}>
                  <h3 className="bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                    {GRUPO_PARAMETRO_LABELS[g]}
                  </h3>
                  <ul className="divide-y">
                    {PARAMETROS_COMISSAO.filter((p) => p.grupo === g).map((p) => {
                      const atual = vigenteDe(p.chave, null)
                      return (
                        <li key={p.chave} className="flex flex-wrap items-start justify-between gap-3 px-4 py-2.5">
                          <div className="min-w-[16rem] flex-1">
                            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                              {p.rotulo}
                              {p.desativado ? (
                                <Badge variant="secondary" className="text-[10px]">desativado</Badge>
                              ) : null}
                              {!atual && !p.desativado ? (
                                <Badge variant="outline" className="text-[10px]">não publicado</Badge>
                              ) : null}
                            </p>
                            <p className="text-xs text-muted-foreground">{p.descricao}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm tabular-nums">
                              {atual ? brlOuNumero(atual.valor, atual.unidade) : '—'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {atual
                                ? `de ${fmtData(atual.vigente_de)} ${ateInclusive(atual.vigente_ate)}`
                                : 'sem vigência'}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={p.desativado}
                            title={
                              p.desativado
                                ? 'Fora de escopo neste ciclo (§11). O valor fica registrado para ser revisado, não usado.'
                                : undefined
                            }
                            onClick={() => setPublicando(p)}
                          >
                            <Plus className="mr-1 h-3 w-3" aria-hidden /> Publicar
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          ) : overrides.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Nenhum override por vendedor. Publique um parâmetro de TAXA escolhendo uma
              pessoa em &quot;Aplicar a&quot; — prazos não aceitam override.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-normal">Vendedor</th>
                    <th scope="col" className="px-3 py-2 font-normal">Parâmetro</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Valor</th>
                    <th scope="col" className="px-3 py-2 font-normal">Vigência</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {overrides.map((o) => (
                    <tr key={o.id}>
                      <td className="px-3 py-2">{o.vendedores?.nome ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {PARAMETROS_COMISSAO.find((p) => p.chave === o.chave)?.rotulo ?? o.chave}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {brlOuNumero(o.valor, o.unidade)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-muted-foreground">
                        de {fmtData(o.vigente_de)} {ateInclusive(o.vigente_ate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Prêmio de transição, carência de migração e reativação de dormente estão
        DESATIVADOS neste ciclo. Os valores combinados ficam registrados de propósito: um
        parâmetro que só aparece quando alguém o liga é um parâmetro que ninguém revisa.
      </p>

      <PublicarDialog
        aberto={publicando}
        onOpenChange={(v) => !v && setPublicando(null)}
        catalogo={PARAMETROS_COMISSAO}
        vendedores={vendedores}
        competenciaFechadaAte={fechadaAte}
        onSalvo={() => void qc.invalidateQueries({ queryKey: ['comercial'] })}
      />
    </div>
  )
}
