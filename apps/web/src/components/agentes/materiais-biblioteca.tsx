'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Eye, FileStack, Pencil, Plus, TrendingDown } from 'lucide-react'
import { TIPO_MATERIAL_LABELS, type TipoMaterial } from '@jobsiteos/core'
import { Badge, STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { salvarMaterialAction } from '@/actions/agentes-gestao'
import { cn } from '@/lib/utils'
import { inteiro, pct } from './gestao-format'
import { MaterialForm, payloadDoMaterial } from './materiais-form'
import { MaterialPrevia } from './materiais-previa'
import {
  buscarDesempenho,
  buscarMateriais,
  gestaoAgentesKeys,
  type DesempenhoMaterial,
  type Material,
} from './queries-gestao'
import { SomenteGestores } from './somente-gestores'

/**
 * A BIBLIOTECA DE MATERIAIS (§5, §11.4) — o que o agente pode mandar, e se mandar adianta.
 *
 * ─── APOSENTAR COM BASE EM NÚMERO ───────────────────────────────────────────
 * "Material que nunca converte deve ser aposentado com base em número." O uso vem de duas
 * fontes: `vezes_usado` (contador vitalício na linha) e a taxa de resposta do painel de
 * desempenho — o mesmo contato respondeu em até 3 dias depois do envio — nos últimos
 * 90 dias. A sugestão de aposentar exige VOLUME (10 envios ou mais): com três envios,
 * zero respostas é ruído, não evidência. E é sugestão: quem desativa é o gestor.
 */

const JANELA_USO_DIAS = 90
const ENVIOS_MINIMOS = 10
const TAXA_PISO = 0.05

export function MateriaisTela() {
  return (
    <SomenteGestores titulo="A biblioteca de materiais">
      <Biblioteca />
    </SomenteGestores>
  )
}

function Biblioteca() {
  const qc = useQueryClient()
  const [editando, setEditando] = React.useState<Material | 'novo' | null>(null)
  const [previa, setPrevia] = React.useState<Material | null>(null)
  const [busca, setBusca] = React.useState('')
  const [desativando, setDesativando] = React.useState<string | null>(null)

  const materiais = useQuery({ queryKey: gestaoAgentesKeys.materiais(), queryFn: buscarMateriais })
  const uso = useQuery({
    queryKey: gestaoAgentesKeys.desempenho(JANELA_USO_DIAS),
    queryFn: () => buscarDesempenho(JANELA_USO_DIAS),
  })

  const usoPorMaterial = React.useMemo(
    () => new Map<string, DesempenhoMaterial>((uso.data?.materiais ?? []).map((m) => [m.material_id, m])),
    [uso.data],
  )

  const lista = React.useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const todos = materiais.data ?? []
    if (!termo) return todos
    return todos.filter((m) =>
      [m.nome, m.descricao, m.quando_usar, ...(m.tags ?? [])].some((t) => t.toLowerCase().includes(termo)),
    )
  }, [materiais.data, busca])

  const aposentar = React.useMemo(() => {
    const comUso = (uso.data?.materiais ?? []).filter((m) => m.enviados > 0)
    const totalEnv = comUso.reduce((s, m) => s + m.enviados, 0)
    const totalResp = comUso.reduce((s, m) => s + m.respondidos, 0)
    const media = totalEnv > 0 ? totalResp / totalEnv : 0
    // Abaixo de metade da média da biblioteca, ou abaixo de 5% — o que for maior.
    const corte = Math.max(TAXA_PISO, media / 2)
    const ativos = new Set((materiais.data ?? []).filter((m) => m.ativo).map((m) => m.id))
    return comUso
      .filter((m) => ativos.has(m.material_id) && m.enviados >= ENVIOS_MINIMOS && (m.taxa_resposta ?? 0) < corte)
      .map((m) => ({ ...m, corte }))
  }, [uso.data, materiais.data])

  async function desativar(id: string) {
    const m = (materiais.data ?? []).find((x) => x.id === id)
    if (!m) return
    setDesativando(id)
    const r = await salvarMaterialAction(payloadDoMaterial(m, { ativo: false }))
    setDesativando(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(`“${m.nome}” desativado. O agente deixa de vê-lo no próximo ciclo.`)
    void qc.invalidateQueries({ queryKey: gestaoAgentesKeys.materiais() })
  }

  if (materiais.isPending) return <Skeleton className="h-96 w-full" />
  if (materiais.isError) {
    return (
      <div className={cn('rounded-lg border p-4 text-sm', STATUS_SUPERFICIE.critical)}>
        Não foi possível carregar a biblioteca: {materiais.error.message}
      </div>
    )
  }

  const todos = materiais.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl space-y-1">
          <h2 className="text-lg font-semibold">Materiais de apoio</h2>
          <p className="text-sm text-muted-foreground">
            O que os agentes podem mandar por e-mail e WhatsApp. Cada material diz QUANDO é o certo —
            é por esse campo que o agente escolhe.
          </p>
        </div>
        <Button onClick={() => setEditando('novo')}>
          <Plus className="mr-2 h-4 w-4" aria-hidden /> Novo material
        </Button>
      </div>

      {aposentar.length > 0 ? (
        <div className={cn('space-y-2 rounded-lg border p-3 text-sm', STATUS_SUPERFICIE.warning)}>
          <p className="flex items-center gap-2 font-medium">
            <TrendingDown className="h-4 w-4" aria-hidden /> Candidatos a aposentar
          </p>
          <p className="text-xs">
            Muitos envios e pouca resposta nos últimos {JANELA_USO_DIAS} dias (pelo menos {ENVIOS_MINIMOS}{' '}
            envios e resposta abaixo de {pct(aposentar[0]?.corte ?? TAXA_PISO)}, metade da média da
            biblioteca ou 5%, o que for maior).
          </p>
          <ul className="space-y-1">
            {aposentar.map((m) => (
              <li key={m.material_id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>{m.nome}</strong> — {inteiro(m.enviados)} envios, {inteiro(m.respondidos)} respostas (
                  {pct(m.taxa_resposta)})
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={desativando === m.material_id}
                  onClick={() => void desativar(m.material_id)}
                >
                  {desativando === m.material_id ? 'Desativando…' : 'Desativar'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {todos.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <div className="rounded-full bg-muted p-3">
            <FileStack className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="font-medium">A biblioteca está vazia</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Sem material, o agente não tem o que anexar — só escreve texto livre. Comece pela
              apresentação institucional e um texto de “como funciona”.
            </p>
          </div>
          <Button onClick={() => setEditando('novo')}>
            <Plus className="mr-2 h-4 w-4" aria-hidden /> Novo material
          </Button>
        </div>
      ) : (
        <>
          <Input
            className="max-w-sm"
            placeholder="Buscar por nome, descrição, quando usar ou tag"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {uso.isError ? (
            <p className="text-xs text-muted-foreground">
              A taxa de resposta não carregou ({uso.error.message}); o contador de uso continua abaixo.
            </p>
          ) : null}
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead>Quando usar</TableHead>
                  <TableHead>Canais</TableHead>
                  <TableHead className="text-right">Usado</TableHead>
                  <TableHead className="text-right">Resposta ({JANELA_USO_DIAS}d)</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((m) => {
                  const u = usoPorMaterial.get(m.id)
                  return (
                    <TableRow key={m.id} className={cn(!m.ativo && 'opacity-60')}>
                      <TableCell className="max-w-[240px] align-top">
                        <p className="font-medium">{m.nome}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant="neutral">{TIPO_MATERIAL_LABELS[m.tipo as TipoMaterial] ?? m.tipo}</Badge>
                          {!m.ativo ? <Badge variant="warning">Inativo</Badge> : null}
                          {(m.tags ?? []).map((t) => (
                            <Badge key={t} variant="outline">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[360px] align-top text-sm text-muted-foreground">
                        <p className="line-clamp-3">{m.quando_usar}</p>
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        {m.canais.map((c) => (c === 'email' ? 'E-mail' : 'WhatsApp')).join(', ')}
                      </TableCell>
                      <TableCell className="text-right align-top tabular-nums">{inteiro(m.vezes_usado)}</TableCell>
                      <TableCell className="text-right align-top tabular-nums">
                        {u ? (
                          <span title={`${u.respondidos} de ${u.enviados} envios com resposta em até 3 dias`}>
                            {pct(u.taxa_resposta)}
                            <span className="block text-xs text-muted-foreground">
                              {inteiro(u.respondidos)}/{inteiro(u.enviados)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">sem envios</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => setPrevia(m)}
                            aria-label="Pré-visualizar"
                          >
                            <Eye className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => setEditando(m)}
                            aria-label="Editar"
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {lista.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      Nenhum material casa com “{busca}”.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            “Usado” é o contador de todos os tempos. A resposta conta o mesmo contato escrevendo em até 3
            dias depois do envio — sinal de leitura, não de conversão.
          </p>
        </>
      )}

      <MaterialForm
        aberto={editando !== null}
        material={editando === 'novo' ? null : editando}
        onFechar={() => setEditando(null)}
      />
      <MaterialPrevia material={previa} onFechar={() => setPrevia(null)} />
    </div>
  )
}
