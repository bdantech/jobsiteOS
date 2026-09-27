'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, FileArchive, ShieldAlert } from 'lucide-react'
import { CANAL_ENTREGA_LABELS, PAPEL_NOTIFICACAO_COBRANCA_LABELS, STATUS_ENTREGA_LABELS, type CanalEntrega, type PapelNotificacaoCobranca, type StatusEntrega } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { gerarDossieAction, type DossieGerado } from '@/actions/cobranca-gestao'
import { buscarSinistro, gestaoKeys, type SinistroDetalhe as Detalhe } from './gestao-queries'
import { abrirArquivo } from './sinistro-arquivos'
import { causaLabel, diasAte } from './sinistros-lista'
import { SinistroAcoes } from './sinistro-acoes'
import { ChecklistDossie } from './sinistro-checklist'
import { CalculoPerda } from './sinistro-perda'
import { CustosSinistro, SolicitacoesSinistro } from './sinistro-extras'
import { brl, cnpj, corDoPrazo, data, dataHora, prazoTexto, sinistroEstagioLabel } from './format'

/**
 * Ficha do sinistro (§7). De cima para baixo, na ordem em que o prazo morde:
 *
 *   1. os prazos (Data da Perda → limite de envio → resposta prevista) e o próximo ato;
 *   2. o checklist do dossiê (cl. 22208.00) e o botão que monta o ZIP;
 *   3. a conta da perda, aberta, linha a linha (§7.3);
 *   4. a prova de entrega das notificações — sem ela o envio trava;
 *   5. o que a seguradora pediu depois (30 dias cada) e os custos (cl. 20700.20).
 */
export function SinistroDetalhe({ id }: { id: string }) {
  const q = useQuery({ queryKey: gestaoKeys.sinistro(id), queryFn: () => buscarSinistro(id) })

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }
  if (!q.data) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Sinistro não encontrado.{' '}
          <Link href="/cobranca/sinistros" className="text-primary hover:underline">
            Voltar à lista
          </Link>
        </CardContent>
      </Card>
    )
  }

  const d = q.data
  return (
    <div className="space-y-4">
      <Cabecalho d={d} />
      <SinistroAcoes d={d} />
      <ChecklistDossie d={d} />
      <Dossie d={d} />
      <CalculoPerda d={d} />
      <ProvaDeEntrega d={d} />
      <SolicitacoesSinistro d={d} />
      <CustosSinistro d={d} />
      <TitulosDoSinistro d={d} />
    </div>
  )
}

function Cabecalho({ d }: { d: Detalhe }) {
  const s = d.sinistro
  const correndo = s.estagio === 'preparacao' || s.estagio === 'notificado'
  const diasEnvio = diasAte(s.data_limite_envio)
  const diasResposta = diasAte(s.resposta_prevista_em)
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" aria-hidden />
              <h1 className="text-lg font-semibold">{s.codigo ?? 'Sinistro'}</h1>
              <Badge variant="info">{sinistroEstagioLabel(s.estagio)}</Badge>
              <Badge variant="neutral">{causaLabel(s.causa)}</Badge>
              <Badge variant="neutral">modo {s.modo_envio === 'api' ? 'API' : 'manual'}</Badge>
            </div>
            <div className="mt-1 text-sm">
              {d.sacado_razao_social ?? 'Sacado'}{' '}
              <span className="font-mono text-xs text-muted-foreground">{cnpj(s.sacado_matriz_cnpj)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Apólice {d.apolice?.numero ?? '—'} ({d.apolice?.seguradora ?? '—'})
              {d.cobranca ? (
                <>
                  {' · '}
                  <Link href={`/cobranca/cobrancas/${d.cobranca.id}`} className="text-primary hover:underline">
                    {d.cobranca.codigo}
                  </Link>
                </>
              ) : (
                ' · sem cobrança vinculada'
              )}
              {s.protocolo_externo ? ` · protocolo ${s.protocolo_externo}` : ''}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Valor de face</div>
            <div className="text-lg font-semibold tabular-nums">{brl(s.valor_total_face)}</div>
            <div className="text-xs text-muted-foreground">indenização estimada {brl(s.indenizacao_estimada)}</div>
            {s.indenizacao_recebida !== null ? (
              <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                recebida {brl(s.indenizacao_recebida)}
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Prazo rotulo="Data da Perda" valor={data(s.data_perda)} />
          <Prazo
            rotulo="Limite de envio (Perda + 6 meses)"
            valor={data(s.data_limite_envio)}
            extra={correndo ? prazoTexto(diasEnvio) : s.enviado_em ? `enviado em ${data(s.enviado_em)}` : null}
            cor={correndo ? corDoPrazo(diasEnvio) : undefined}
            destaque={correndo && diasEnvio !== null && diasEnvio <= 5}
          />
          <Prazo
            rotulo="Seguradora notificada"
            valor={data(s.notificado_em)}
            extra={s.notificado_em ? null : 'ainda não notificada'}
          />
          <Prazo
            rotulo="Resposta prevista (envio + 120 d)"
            valor={data(s.resposta_prevista_em)}
            extra={s.resposta_prevista_em && !s.respondido_em ? prazoTexto(diasResposta) : s.respondido_em ? `respondido em ${data(s.respondido_em)}` : null}
          />
        </div>
        {s.motivo_recusa ? (
          <p className="rounded-md bg-red-50 p-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">
            Recusado: {s.motivo_recusa}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Prazo({
  rotulo,
  valor,
  extra,
  cor,
  destaque,
}: {
  rotulo: string
  valor: string
  extra?: string | null
  cor?: string
  destaque?: boolean
}) {
  return (
    <div className={cn('rounded-md border p-3', destaque ? 'border-destructive bg-red-50 dark:bg-red-950/40' : 'border-border')}>
      <div className="text-xs text-muted-foreground">{rotulo}</div>
      <div className="font-medium tabular-nums">{valor}</div>
      {extra ? <div className={cn('text-xs tabular-nums', cor ?? 'text-muted-foreground')}>{extra}</div> : null}
    </div>
  )
}

function Dossie({ d }: { d: Detalhe }) {
  const qc = useQueryClient()
  const s = d.sinistro
  const [gerando, setGerando] = React.useState(false)
  const [ultimo, setUltimo] = React.useState<DossieGerado | null>(null)

  async function gerar() {
    setGerando(true)
    const r = await gerarDossieAction(s.id)
    setGerando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    setUltimo(r.data)
    if (r.data.pendencias.length) toast.warning(`Dossiê gerado com ${r.data.pendencias.length} pendência(s).`)
    else toast.success('Dossiê gerado.')
    void qc.invalidateQueries({ queryKey: gestaoKeys.sinistro(s.id) })
  }

  const caminho = ultimo?.dossie_path ?? s.dossie_path
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileArchive className="h-4 w-4" aria-hidden />
          Dossiê
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          ZIP com o índice (<code>00-indice.pdf</code>, com o SHA-256 de cada arquivo), o sumário executivo — partes,
          títulos, cronologia da cobrança e memória da perda — e os arquivos do checklist. É o pacote que vai para a
          seguradora, por e-mail ou pela API. Os itens automáticos são montados nesta geração.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void gerar()} disabled={gerando}>
            {gerando ? 'Gerando… (pode levar alguns minutos)' : caminho ? 'Gerar de novo' : 'Gerar dossiê'}
          </Button>
          {caminho ? (
            <Button size="sm" variant="outline" onClick={() => void abrirArquivo(caminho)}>
              <Download className="mr-1 h-4 w-4" />
              Baixar ZIP
            </Button>
          ) : null}
          {s.dossie_gerado_em ? (
            <span className="text-xs text-muted-foreground">
              gerado em {dataHora(s.dossie_gerado_em)}
              {s.dossie_hash ? <> · sha256 <span className="font-mono">{s.dossie_hash.slice(0, 16)}…</span></> : null}
            </span>
          ) : null}
        </div>
        {ultimo ? (
          <div className="space-y-1">
            {ultimo.itens_gerados.length ? (
              <p className="text-xs text-muted-foreground">Itens montados pelo sistema: {ultimo.itens_gerados.join(', ')}.</p>
            ) : null}
            {ultimo.pendencias.length ? (
              <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                <p className="font-medium">Pendências — impedem o envio:</p>
                <ul className="list-disc pl-5">
                  {ultimo.pendencias.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">Sem pendências no checklist.</p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

/**
 * §4: a prova de entrega de cada notificação enviada é item obrigatório do dossiê. A
 * RPC trava o `enviado` enquanto faltar — ou até alguém justificar a ausência, e a
 * justificativa vai no corpo do envio. Aqui a pessoa vê QUAL falta antes de tentar.
 */
function ProvaDeEntrega({ d }: { d: Detalhe }) {
  if (!d.cobranca) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Prova de entrega das notificações</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Sinistro sem cobrança vinculada: não há notificações do sistema para comprovar.
        </CardContent>
      </Card>
    )
  }
  const faltando = d.notificacoes.filter((n) => n.status !== 'falhou' && !n.tem_prova)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Prova de entrega das notificações</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {d.notificacoes.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma notificação enviada nesta cobrança.</p>
        ) : (
          <>
            {faltando.length > 0 ? (
              <p className="text-destructive">
                {faltando.length} notificação(ões) sem prova de entrega. O envio do sinistro fica bloqueado até
                registrar o AR/certidão{' '}
                <Link href={`/cobranca/cobrancas/${d.cobranca.id}`} className="underline">
                  na cobrança
                </Link>{' '}
                ou justificar a ausência no envio.
                {d.sinistro.justificativa_prova_entrega ? ' (Há uma justificativa registrada.)' : ''}
              </p>
            ) : (
              <p className="text-emerald-700 dark:text-emerald-400">Todas as notificações enviadas têm prova de entrega.</p>
            )}
            <ul className="divide-y divide-border rounded-md border border-border">
              {d.notificacoes.map((n) => (
                <li key={n.id} className={cn('space-y-1 px-3 py-2', !n.tem_prova && n.status !== 'falhou' && 'bg-red-50 dark:bg-red-950/40')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{n.destinatario_razao_social}</span>{' '}
                      <span className="text-xs text-muted-foreground">
                        {PAPEL_NOTIFICACAO_COBRANCA_LABELS[n.papel as PapelNotificacaoCobranca] ?? n.papel} · rodada {n.rodada}
                      </span>
                    </span>
                    {n.tem_prova ? <Badge variant="success">entregue</Badge> : <Badge variant="critical">sem prova</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {n.entregas.length === 0 ? <span>nenhum canal registrado</span> : null}
                    {n.entregas.map((e) => (
                      <span key={e.id} className="rounded border border-border px-1.5 py-0.5">
                        {CANAL_ENTREGA_LABELS[e.canal as CanalEntrega] ?? e.canal}:{' '}
                        {STATUS_ENTREGA_LABELS[e.status as StatusEntrega] ?? e.status}
                        {e.codigo_rastreio ? ` · ${e.codigo_rastreio}` : ''}
                        {e.comprovante_path ? (
                          <button type="button" className="ml-1 text-primary underline" onClick={() => void abrirArquivo(e.comprovante_path!)}>
                            comprovante
                          </button>
                        ) : null}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function TitulosDoSinistro({ d }: { d: Detalhe }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Títulos do sinistro ({d.titulos.length})</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Título</th>
              <th className="px-3 py-2 text-left font-medium">Devedora</th>
              <th className="px-3 py-2 text-left font-medium">Cedente</th>
              <th className="px-3 py-2 text-left font-medium">Vencimento</th>
              <th className="px-3 py-2 text-right font-medium">Face</th>
              <th className="px-3 py-2 text-right font-medium">Valor cedido</th>
              <th className="px-3 py-2 text-left font-medium">Cobertura</th>
            </tr>
          </thead>
          <tbody>
            {d.titulos.map((t) => (
              <tr key={t.titulo_id} className="border-t border-border">
                <td className="px-3 py-2">{t.numero ?? t.externo_id ?? '—'}</td>
                <td className="px-3 py-2">{t.sacado_nome ?? cnpj(t.sacado_cnpj)}</td>
                <td className="px-3 py-2">{t.cedente_nome ?? '—'}</td>
                <td className="px-3 py-2">{data(t.vencimento)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{brl(t.valor_face)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {t.valor_cedido === null ? <span className="text-amber-600">não informado</span> : brl(t.valor_cedido)}
                </td>
                <td className="px-3 py-2">
                  {t.coberto_apolice === false ? <Badge variant="warning">não segurado</Badge> : <Badge variant="neutral">segurado</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
