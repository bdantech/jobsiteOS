'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, FileUp, Landmark } from 'lucide-react'
import {
  COBRANCA_ESTAGIOS_ENCERRADOS,
  PROTESTO_SITUACAO_LABELS,
  PROTESTO_SITUACOES,
  type ProtestoSituacao,
  type Tables,
} from '@jobsiteos/core'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  atualizarTituloProtestoAction,
  criarRemessaProtestoAction,
  gerarArquivoRemessaAction,
  instrucaoCancelamentoAction,
  marcarRemessaEnviadaAction,
  processarRetornoProtestoAction,
} from '@/actions/cobranca'
import { cn } from '@/lib/utils'
import { ArquivoLink } from './cobranca-detalhe-comum'
import { brl, data, dataHora } from './format'
import {
  buscarConfigCobranca,
  buscarRemessas,
  buscarTitulosDaCobranca,
  cobrancaKeys,
  numeroDoTitulo,
  subirArquivoCobranca,
  type CardCobranca,
  type RemessaComTitulos,
  type TituloDaCobranca,
} from './queries'

/**
 * Protesto (§8). Não há API pública de auto-serviço: com convênio de apresentante no
 * CRA da UF, o sistema monta a planilha, a pessoa envia pelo portal e sobe o retorno.
 * Sem convênio a remessa ainda pode ser montada — o aviso diz que ela não tem por onde
 * sair até o convênio existir.
 *
 * O que esta aba mais precisa mostrar é o que está ERRADO: título quitado com protesto
 * ainda de pé. Protesto não retirado depois do pagamento vira dano moral contra nós, e
 * a regularização do sacado fica travada até cada um ter instrução ou "não se aplica".
 */

const TOM_SITUACAO: Record<ProtestoSituacao, BadgeProps['variant']> = {
  enviado: 'info',
  apontado: 'warning',
  protestado: 'critical',
  pago_em_cartorio: 'success',
  retirado: 'neutral',
  sustado: 'neutral',
  rejeitado: 'neutral',
}

const TIPO_REMESSA: Record<string, string> = {
  apresentacao: 'Apresentação',
  desistencia: 'Desistência',
  cancelamento: 'Cancelamento',
}

const STATUS_REMESSA: Record<string, string> = {
  rascunho: 'Rascunho',
  enviada: 'Enviada',
  confirmada: 'Retorno processado',
  rejeitada: 'Rejeitada',
}

type ProtestoTitulo = Tables<'protesto_titulos'>

export function AbaProtesto({ cobranca }: { cobranca: CardCobranca }) {
  const id = cobranca.id!
  const remessas = useQuery({ queryKey: cobrancaKeys.protestos(id), queryFn: () => buscarRemessas(id) })
  const titulos = useQuery({ queryKey: cobrancaKeys.titulos(id), queryFn: () => buscarTitulosDaCobranca(id) })
  const config = useQuery({ queryKey: cobrancaKeys.config(), queryFn: buscarConfigCobranca })

  if (remessas.isPending || titulos.isPending) return <Skeleton className="h-64 w-full" />

  const lista = remessas.data ?? []
  const porCt = new Map((titulos.data ?? []).map((t) => [t.id, t]))
  const encerrada = (COBRANCA_ESTAGIOS_ENCERRADOS as readonly string[]).includes(cobranca.estagio ?? '')
  const podeProtestar = !encerrada && cobranca.estagio !== 'rascunho'

  // Títulos de apresentação ainda de pé cujo título foi quitado: a retirada é devida.
  const pendentes = lista
    .filter((r) => r.tipo === 'apresentacao')
    .flatMap((r) => r.protesto_titulos)
    .filter(
      (pt) =>
        ['enviado', 'apontado', 'protestado'].includes(pt.situacao) &&
        !pt.instrucao_cancelamento_em &&
        !pt.instrucao_nao_aplicavel_motivo?.trim() &&
        porCt.get(pt.cobranca_titulo_id ?? '')?.situacao === 'quitado',
    )

  // Já em alguma apresentação que não foi rejeitada: não entra de novo.
  const emProtesto = new Set(
    lista
      .filter((r) => r.tipo === 'apresentacao')
      .flatMap((r) => r.protesto_titulos)
      .filter((pt) => pt.situacao !== 'rejeitado')
      .map((pt) => pt.cobranca_titulo_id),
  )
  const elegiveis = (titulos.data ?? []).filter(
    (t) => ['em_cobranca', 'acordado', 'sinistrado'].includes(t.situacao) && !emProtesto.has(t.id),
  )

  return (
    <div className="space-y-4">
      {pendentes.length > 0 ? (
        <PendenciasRetirada
          key={pendentes.map((p) => p.id).join(',')}
          cobrancaId={id}
          pendentes={pendentes}
          porCt={porCt}
        />
      ) : null}

      {podeProtestar ? (
        <NovaRemessa
          cobrancaId={id}
          elegiveis={elegiveis}
          convenios={(config.data?.protesto.convenios ?? []).filter((c) => c.ativo)}
        />
      ) : (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            {cobranca.estagio === 'rascunho'
              ? 'Protesto só depois da notificação: envie a notificação extrajudicial primeiro.'
              : 'Cobrança encerrada — não há novas remessas.'}
          </CardContent>
        </Card>
      )}

      {lista.map((r) => (
        <RemessaCard key={r.id} r={r} cobrancaId={id} porCt={porCt} encerrada={encerrada} />
      ))}
    </div>
  )
}

// ─── Pendências de retirada ─────────────────────────────────────────────────

function PendenciasRetirada({
  cobrancaId,
  pendentes,
  porCt,
}: {
  cobrancaId: string
  pendentes: ProtestoTitulo[]
  porCt: Map<string, TituloDaCobranca>
}) {
  const qc = useQueryClient()
  const [marcados, setMarcados] = React.useState<Set<string>>(new Set(pendentes.map((p) => p.id)))
  const [tipo, setTipo] = React.useState<'cancelamento' | 'desistencia'>('cancelamento')
  const [motivo, setMotivo] = React.useState('')
  const [ocupado, setOcupado] = React.useState(false)

  async function executar(naoAplicavel: boolean) {
    setOcupado(true)
    const r = await instrucaoCancelamentoAction({
      cobranca_id: cobrancaId,
      protesto_titulo_ids: [...marcados],
      ...(naoAplicavel ? { nao_aplicavel_motivo: motivo.trim() } : { tipo }),
    })
    setOcupado(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    if (r.data.aviso) toast.warning(r.data.aviso)
    else
      toast.success(
        naoAplicavel
          ? 'Marcado como não aplicável.'
          : 'Instrução criada em rascunho, com o arquivo pronto. Envie pelo portal e marque como enviada.',
      )
    setMotivo('')
    void qc.invalidateQueries({ queryKey: cobrancaKeys.protestos(cobrancaId) })
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {pendentes.length} protesto(s) de título já quitado sem instrução de retirada
        </CardTitle>
        <CardDescription>
          Protesto não retirado depois do pagamento vira dano moral contra nós, e a regularização do sacado
          fica bloqueada até cada um ter a instrução enviada — ou um motivo para não se aplicar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="divide-y rounded-md border">
          {pendentes.map((p) => {
            const t = porCt.get(p.cobranca_titulo_id ?? '')
            return (
              <label key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={marcados.has(p.id)}
                  onChange={() => {
                    const s = new Set(marcados)
                    if (s.has(p.id)) s.delete(p.id)
                    else s.add(p.id)
                    setMarcados(s)
                  }}
                />
                <span className="flex-1">
                  {t ? numeroDoTitulo(t) : '—'} · quitado em {data(t?.quitado_em)}
                </span>
                <Badge variant={TOM_SITUACAO[p.situacao as ProtestoSituacao] ?? 'outline'}>
                  {PROTESTO_SITUACAO_LABELS[p.situacao as ProtestoSituacao] ?? p.situacao}
                </Badge>
                <span className="text-xs text-muted-foreground">{p.cartorio ?? ''}</span>
              </label>
            )
          })}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Tipo de instrução</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cancelamento">Cancelamento (já protestado)</SelectItem>
                <SelectItem value="desistencia">Desistência (ainda apontado)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" disabled={ocupado || marcados.size === 0} onClick={() => void executar(false)}>
            Gerar instrução de retirada
          </Button>
          <span className="flex-1" />
          <Input
            className="w-72"
            placeholder="Motivo para não se aplicar (mín. 5 caracteres)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={ocupado || marcados.size === 0 || motivo.trim().length < 5}
            onClick={() => void executar(true)}
          >
            Não se aplica
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Nova remessa ───────────────────────────────────────────────────────────

function NovaRemessa({
  cobrancaId,
  elegiveis,
  convenios,
}: {
  cobrancaId: string
  elegiveis: TituloDaCobranca[]
  convenios: { uf: string; cra: string; modo: 'portal_manual' | 'api' }[]
}) {
  const qc = useQueryClient()
  const [convenio, setConvenio] = React.useState(convenios[0] ? `${convenios[0].uf}|${convenios[0].cra}` : '__livre')
  const [uf, setUf] = React.useState('')
  const [cra, setCra] = React.useState('')
  const [marcados, setMarcados] = React.useState<Set<string>>(new Set())
  const [criando, setCriando] = React.useState(false)

  const livre = convenio === '__livre'
  const escolhido = convenios.find((c) => `${c.uf}|${c.cra}` === convenio)
  const ufFinal = (livre ? uf : (escolhido?.uf ?? '')).toUpperCase().trim()
  const craFinal = (livre ? cra : (escolhido?.cra ?? '')).trim()

  async function criar() {
    setCriando(true)
    const r = await criarRemessaProtestoAction({
      cobranca_id: cobrancaId,
      uf: ufFinal,
      cra: craFinal,
      modo: escolhido?.modo ?? 'portal_manual',
      cobranca_titulo_ids: [...marcados],
    })
    setCriando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    if (r.data.aviso) toast.warning(r.data.aviso)
    else toast.success('Remessa criada com o arquivo pronto para o portal do CRA.')
    setMarcados(new Set())
    void qc.invalidateQueries({ queryKey: cobrancaKeys.protestos(cobrancaId) })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Landmark className="h-4 w-4" aria-hidden />
          Nova remessa de protesto
        </CardTitle>
        <CardDescription>
          A abrangência é estadual: o convênio de uma UF não protesta devedor de outra. A certidão de protesto
          entra depois no item (g) do dossiê de sinistro.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Convênio (UF / CRA)</Label>
            <Select value={convenio} onValueChange={setConvenio}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {convenios.map((c) => (
                  <SelectItem key={`${c.uf}|${c.cra}`} value={`${c.uf}|${c.cra}`}>
                    {c.uf} — {c.cra} {c.modo === 'api' ? '(API)' : '(portal)'}
                  </SelectItem>
                ))}
                <SelectItem value="__livre">Outro (sem convênio cadastrado)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {livre ? (
            <>
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="uf-livre">
                  UF
                </Label>
                <Input id="uf-livre" maxLength={2} value={uf} onChange={(e) => setUf(e.target.value.toUpperCase())} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="cra-livre">
                  CRA
                </Label>
                <Input id="cra-livre" placeholder="CENPROT-SP, CRA-PR…" value={cra} onChange={(e) => setCra(e.target.value)} />
              </div>
            </>
          ) : null}
        </div>
        {livre ? (
          <p className="flex items-start gap-2 rounded-md border border-amber-600/30 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Sem convênio de apresentante com o CRA desta UF (e o e-CNPJ da cessionária), a remessa não tem por
            onde ser enviada. Ela pode ser montada agora, mas só sai depois do convênio — cadastre-o em
            Configurações → Protesto.
          </p>
        ) : null}

        {elegiveis.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum título devido fora de protesto.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {elegiveis.map((t) => (
              <label key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={marcados.has(t.id)}
                  onChange={() => {
                    const s = new Set(marcados)
                    if (s.has(t.id)) s.delete(t.id)
                    else s.add(t.id)
                    setMarcados(s)
                  }}
                />
                <span className="flex-1">
                  {numeroDoTitulo(t)} · venc. {data(t.vencimento_snapshot)}
                  <span className="ml-2 text-xs text-muted-foreground">{t.titulos?.cedente_nome ?? ''}</span>
                </span>
                <span className="tabular-nums">{brl(t.valor_face_snapshot)}</span>
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={criando || marcados.size === 0 || !/^[A-Z]{2}$/.test(ufFinal) || craFinal.length < 2}
            onClick={criar}
          >
            {criando ? 'Criando…' : `Criar remessa com ${marcados.size} título(s)`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Uma remessa ────────────────────────────────────────────────────────────

function RemessaCard({
  r,
  cobrancaId,
  porCt,
  encerrada,
}: {
  r: RemessaComTitulos
  cobrancaId: string
  porCt: Map<string, TituloDaCobranca>
  encerrada: boolean
}) {
  const qc = useQueryClient()
  const [protocolo, setProtocolo] = React.useState('')
  const [ocupado, setOcupado] = React.useState(false)
  const [ignoradas, setIgnoradas] = React.useState<{ linha: number; motivo: string }[] | null>(null)
  const [editando, setEditando] = React.useState<ProtestoTitulo | null>(null)
  const retornoRef = React.useRef<HTMLInputElement>(null)

  function invalidar() {
    void qc.invalidateQueries({ queryKey: cobrancaKeys.protestos(cobrancaId) })
    void qc.invalidateQueries({ queryKey: cobrancaKeys.titulos(cobrancaId) })
    void qc.invalidateQueries({ queryKey: cobrancaKeys.cobranca(cobrancaId) })
  }

  async function marcarEnviada() {
    setOcupado(true)
    const res = await marcarRemessaEnviadaAction(cobrancaId, {
      remessa_id: r.id,
      ...(protocolo.trim() ? { protocolo: protocolo.trim() } : {}),
    })
    setOcupado(false)
    if (!res.ok) {
      toast.error(res.message)
      return
    }
    toast.success(r.tipo === 'apresentacao' ? 'Remessa marcada como enviada; os títulos agora estão protestados.' : 'Instrução de retirada registrada como enviada.')
    invalidar()
  }

  async function gerarArquivo() {
    setOcupado(true)
    const res = await gerarArquivoRemessaAction(cobrancaId, r.id)
    setOcupado(false)
    if (!res.ok) {
      toast.error(res.message)
      return
    }
    toast.success('Arquivo da remessa gerado.')
    invalidar()
  }

  async function subirRetorno(arquivo: File) {
    setOcupado(true)
    try {
      const caminho = await subirArquivoCobranca(`${cobrancaId}/protestos`, arquivo, `retorno-${r.id.slice(0, 8)}`)
      const res = await processarRetornoProtestoAction({ cobranca_id: cobrancaId, remessa_id: r.id, retorno_path: caminho })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      setIgnoradas(res.data.ignoradas)
      toast.success(
        `${res.data.aplicadas} linha(s) aplicada(s)${res.data.ignoradas.length ? `, ${res.data.ignoradas.length} ignorada(s)` : ''}.`,
      )
      invalidar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao processar o retorno.')
    } finally {
      setOcupado(false)
      if (retornoRef.current) retornoRef.current.value = ''
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={r.tipo === 'apresentacao' ? 'default' : 'secondary'}>{TIPO_REMESSA[r.tipo] ?? r.tipo}</Badge>
              {r.uf} — {r.cra}
              <Badge variant="outline">{STATUS_REMESSA[r.status] ?? r.status}</Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Criada {dataHora(r.criado_em)}
              {r.enviada_em ? ` · enviada ${dataHora(r.enviada_em)}` : ''}
              {r.protocolo ? ` · protocolo ${r.protocolo}` : ''}
              {r.retorno_processado_em ? ` · retorno processado ${dataHora(r.retorno_processado_em)}` : ''}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {r.arquivo_path ? (
              <ArquivoLink caminho={r.arquivo_path}>Arquivo da remessa (CSV)</ArquivoLink>
            ) : (
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={ocupado} onClick={gerarArquivo}>
                Gerar arquivo
              </Button>
            )}
            <ArquivoLink caminho={r.retorno_path}>Retorno</ArquivoLink>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {r.status === 'rascunho' && !encerrada ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-64"
              placeholder="Protocolo do portal (opcional)"
              value={protocolo}
              onChange={(e) => setProtocolo(e.target.value)}
            />
            <Button size="sm" disabled={ocupado} onClick={marcarEnviada}>
              Marcar como enviada
            </Button>
          </div>
        ) : null}
        {r.tipo === 'apresentacao' && r.status !== 'rascunho' ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={retornoRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void subirRetorno(f)
              }}
            />
            <Button variant="outline" size="sm" disabled={ocupado} onClick={() => retornoRef.current?.click()}>
              <FileUp className="mr-1 h-4 w-4" aria-hidden />
              Subir retorno do CRA
            </Button>
            <span className="text-xs text-muted-foreground">
              CSV com as colunas id_interno e situação; linhas que não casam com esta remessa são listadas e
              ignoradas.
            </span>
          </div>
        ) : null}
        {ignoradas && ignoradas.length > 0 ? (
          <div className="rounded-md border border-amber-600/30 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="font-semibold">Linhas ignoradas do retorno:</p>
            <ul className="mt-1 list-disc pl-5">
              {ignoradas.map((l) => (
                <li key={`${l.linha}-${l.motivo}`}>
                  Linha {l.linha}: {l.motivo}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Cartório</TableHead>
                <TableHead>Protocolo</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Custas</TableHead>
                <TableHead>Certidão</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.protesto_titulos.map((pt) => {
                const t = porCt.get(pt.cobranca_titulo_id ?? '')
                const st = pt.situacao as ProtestoSituacao
                const quitadoEmPe =
                  r.tipo === 'apresentacao' &&
                  t?.situacao === 'quitado' &&
                  ['enviado', 'apontado', 'protestado'].includes(pt.situacao) &&
                  !pt.instrucao_cancelamento_em &&
                  !pt.instrucao_nao_aplicavel_motivo
                return (
                  <TableRow key={pt.id} className={cn(quitadoEmPe && 'bg-destructive/5')}>
                    <TableCell className="text-xs">
                      {t ? numeroDoTitulo(t) : '—'}
                      {quitadoEmPe ? <span className="block text-[10px] text-destructive">quitado — retirada pendente</span> : null}
                      {pt.instrucao_cancelamento_em ? (
                        <span className="block text-[10px] text-muted-foreground">
                          retirada enviada {data(pt.instrucao_cancelamento_em)}
                        </span>
                      ) : null}
                      {pt.instrucao_nao_aplicavel_motivo ? (
                        <span className="block text-[10px] text-muted-foreground" title={pt.instrucao_nao_aplicavel_motivo}>
                          retirada não se aplica
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={TOM_SITUACAO[st] ?? 'outline'}>{PROTESTO_SITUACAO_LABELS[st] ?? pt.situacao}</Badge>
                      {pt.motivo_rejeicao ? (
                        <span className="block text-[10px] text-muted-foreground">{pt.motivo_rejeicao}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">{pt.cartorio ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{pt.protocolo_cartorio ?? '—'}</TableCell>
                    <TableCell className="text-xs">{data(pt.data_protesto)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{pt.custas === null ? '—' : brl(pt.custas)}</TableCell>
                    <TableCell>
                      <ArquivoLink caminho={pt.certidao_path}>certidão</ArquivoLink>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.tipo === 'apresentacao' && !encerrada ? (
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditando(pt)}>
                          Atualizar
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      {editando ? (
        <AtualizarTituloProtesto pt={editando} cobrancaId={cobrancaId} onFechar={() => setEditando(null)} onSalvo={invalidar} />
      ) : null}
    </Card>
  )
}

function AtualizarTituloProtesto({
  pt,
  cobrancaId,
  onFechar,
  onSalvo,
}: {
  pt: ProtestoTitulo
  cobrancaId: string
  onFechar: () => void
  onSalvo: () => void
}) {
  const [situacao, setSituacao] = React.useState<ProtestoSituacao>(pt.situacao as ProtestoSituacao)
  const [cartorio, setCartorio] = React.useState(pt.cartorio ?? '')
  const [protocolo, setProtocolo] = React.useState(pt.protocolo_cartorio ?? '')
  const [dataProtesto, setDataProtesto] = React.useState(pt.data_protesto ?? '')
  const [custas, setCustas] = React.useState(pt.custas === null ? '' : String(pt.custas))
  const [motivo, setMotivo] = React.useState(pt.motivo_rejeicao ?? '')
  const [certidao, setCertidao] = React.useState<File | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  async function salvar() {
    setSalvando(true)
    try {
      const certidaoPath = certidao ? await subirArquivoCobranca(`${cobrancaId}/protestos`, certidao, `certidao-${pt.id.slice(0, 8)}`) : undefined
      const c = Number(custas.replace(',', '.'))
      const r = await atualizarTituloProtestoAction(cobrancaId, {
        protesto_titulo_id: pt.id,
        situacao,
        ...(cartorio.trim() ? { cartorio: cartorio.trim() } : {}),
        ...(protocolo.trim() ? { protocolo_cartorio: protocolo.trim() } : {}),
        ...(dataProtesto ? { data_protesto: dataProtesto } : {}),
        ...(custas.trim() && Number.isFinite(c) ? { custas: c } : {}),
        ...(motivo.trim() ? { motivo_rejeicao: motivo.trim() } : {}),
        ...(certidaoPath ? { certidao_path: certidaoPath } : {}),
      })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      toast.success(situacao === 'pago_em_cartorio' ? 'Pago em cartório: o título foi quitado na cobrança.' : 'Protesto atualizado.')
      onSalvo()
      onFechar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao atualizar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Atualizar título em protesto</DialogTitle>
          <DialogDescription>
            O que o retorno do CRA não trouxe, ou a certidão que chegou depois. “Pago em cartório” quita o título
            na cobrança.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Situação</Label>
            <Select value={situacao} onValueChange={(v) => setSituacao(v as ProtestoSituacao)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROTESTO_SITUACOES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {PROTESTO_SITUACAO_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pt-data">Data</Label>
            <Input id="pt-data" type="date" value={dataProtesto} onChange={(e) => setDataProtesto(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pt-cartorio">Cartório</Label>
            <Input id="pt-cartorio" value={cartorio} onChange={(e) => setCartorio(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pt-protocolo">Protocolo do cartório</Label>
            <Input id="pt-protocolo" value={protocolo} onChange={(e) => setProtocolo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pt-custas">Custas (R$)</Label>
            <Input id="pt-custas" inputMode="decimal" value={custas} onChange={(e) => setCustas(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pt-certidao">Certidão de protesto</Label>
            <Input
              id="pt-certidao"
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setCertidao(e.target.files?.[0] ?? null)}
            />
          </div>
          {situacao === 'rejeitado' ? (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="pt-motivo">Motivo da rejeição</Label>
              <Input id="pt-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={salvando} onClick={salvar}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
