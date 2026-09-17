'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Download, FileText } from 'lucide-react'
import type { Tables } from '@jobsiteos/core'
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
import { toast } from 'sonner'
import { baixarDocAnalise, buscarCreditoConfig, creditoKeys } from '../queries'

/**
 * O diálogo de envio à seguradora, com a escolha dos documentos.
 *
 * ─── POR QUE ESCOLHER, SE TODOS JÁ VÊM MARCADOS ─────────────────────────────
 * Marcar tudo por padrão é a resposta certa na maioria dos casos e o motivo de a lista
 * existir é a minoria: a pasta de uma análise acumula coisas que são NOSSAS e não da
 * seguradora — uma relação de faturamento que o cliente mandou por WhatsApp, um
 * balancete rascunhado, um arquivo anexado no tipo errado. Mandar dado de terceiro é
 * irreversível, e o único momento em que dá para reparar é este.
 *
 * A tela não decide por ninguém: ela mostra o que vai sair, com o nome do arquivo, e
 * deixa desmarcar. É a mesma lógica do diálogo de protestos e do de custo do envio —
 * cerimônia proporcional ao que não dá para desfazer.
 *
 * ─── O QUE JÁ FOI ──────────────────────────────────────────────────────────
 * Documento já aceito pela seguradora aparece marcado como tal e NÃO vem pré-marcado:
 * reenviar o mesmo balanço não é erro, mas também não é o que alguém quis fazer ao abrir
 * este diálogo. Quem quiser reenviar, marca.
 */

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

interface TipoDoc {
  id: string
  label: string
}

export function DialogoEnviarSeguradora({
  aberto,
  onOpenChange,
  nome,
  docs,
  limiteSolicitado,
  enviando,
  onConfirmar,
  modo = 'envio',
}: {
  aberto: boolean
  onOpenChange: (v: boolean) => void
  nome: string
  docs: Tables<'analise_docs'>[]
  /** O que o COMERCIAL pediu ao abrir a análise. É só o ponto de partida. */
  limiteSolicitado: number | null
  enviando: boolean
  /** No modo `documentos` o limite vem `0` e o chamador o ignora: não há pedido a abrir. */
  onConfirmar: (docIds: string[], limite: number) => void
  /**
   * `envio` abre o pedido de cobertura (paga o buyer) e leva a papelada junto.
   * `documentos` só manda a papelada, por e-mail, de uma análise que JÁ foi.
   *
   * Um diálogo com dois modos, e não dois diálogos: a lista de documentos — com o estado
   * de cada um, o botão de abrir e a regra de pré-marcação — é a mesma coisa nos dois
   * casos, e duas cópias dela divergiriam no primeiro ajuste.
   */
  modo?: 'envio' | 'documentos'
}) {
  const soDocumentos = modo === 'documentos'
  const config = useQuery({
    queryKey: creditoKeys.config(),
    queryFn: buscarCreditoConfig,
    enabled: aberto,
  })
  const rotulos = React.useMemo(() => {
    const tipos = (config.data?.docs as { tipos?: TipoDoc[] } | undefined)?.tipos ?? []
    return new Map(tipos.map((t) => [t.id, t.label]))
  }, [config.data])

  /**
   * A seleção nasce de novo a cada abertura, e não vive num estado que sobrevive ao
   * fechamento: um diálogo que "lembra" o que foi desmarcado da última vez mandaria
   * menos do que a pessoa espera na vez seguinte, sem dizer nada.
   */
  const [marcados, setMarcados] = React.useState<Set<string>>(new Set())
  React.useEffect(() => {
    if (!aberto) return
    setMarcados(new Set(docs.filter((d) => !d.enviado_seguradora_em).map((d) => d.id)))
  }, [aberto, docs])

  /*
   * O LIMITE NASCE DO QUE O COMERCIAL PEDIU, E TERMINA NO QUE O ANALISTA DECIDE.
   *
   * Quem digitou o número original abriu a análise no funil, antes de existir balanço,
   * exposição ou protesto na mesa. Quem aperta este botão leu tudo isso. Herdar o valor
   * é o certo — ninguém deveria redigitar o que já está lá —, mas travá-lo faria a
   * Atradius receber um pedido que a pessoa que o enviou não defende.
   *
   * Renasce a cada abertura, pelo mesmo motivo da seleção de documentos: um campo que
   * guarda o que foi digitado e abandonado na vez anterior manda um número que ninguém
   * conferiu nesta.
   */
  const [limite, setLimite] = React.useState('')
  React.useEffect(() => {
    if (!aberto) return
    setLimite(limiteSolicitado != null && limiteSolicitado > 0 ? String(limiteSolicitado) : '')
  }, [aberto, limiteSolicitado])

  const limiteNum = Number(limite.replace(',', '.'))
  const limiteValido = Number.isFinite(limiteNum) && limiteNum > 0
  const mudou = limiteValido && limiteNum !== Number(limiteSolicitado ?? 0)

  const [baixando, setBaixando] = React.useState<string | null>(null)
  async function baixar(id: string, caminho: string, nomeArquivo: string | null) {
    setBaixando(id)
    try {
      window.open(await baixarDocAnalise(caminho, nomeArquivo), '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível abrir o documento.')
    } finally {
      setBaixando(null)
    }
  }

  const alternar = (id: string) =>
    setMarcados((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(id)) proximo.delete(id)
      else proximo.add(id)
      return proximo
    })

  const escolhidos = [...marcados]

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {soDocumentos ? 'Reenviar documentos por e-mail' : 'Enviar à seguradora'}
          </DialogTitle>
          <DialogDescription>
            {soDocumentos ? (
              <>
                O pedido de cobertura <strong>não é reaberto</strong> e nada aqui é cobrado — sai
                só a papelada, por e-mail, para os endereços configurados em Crédito ›
                Configurações.
              </>
            ) : (
              <>
                O envio resolve o cadastro do buyer na Atradius, e{' '}
                <strong>essa consulta pode ser cobrada</strong> — uma vez por CNPJ que ainda não
                tem cadastro. Depois disso o pedido de cobertura é submetido e a decisão chega
                pelo acompanhamento automático.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-md border p-3 text-sm">{nome}</p>

        {/* Sem limite no reenvio: não há pedido a abrir, e um campo aqui convidaria a
            "corrigir" um número que a Atradius já recebeu e não reescreve. */}
        <div className={soDocumentos ? 'hidden' : 'space-y-1.5'}>
          <Label htmlFor="limite-envio">Limite a pedir</Label>
          <Input
            id="limite-envio"
            type="number"
            min={1}
            step={1000}
            inputMode="numeric"
            value={limite}
            onChange={(e) => setLimite(e.target.value)}
            className="tabular-nums"
          />
          <p className="text-xs text-muted-foreground">
            {limiteValido ? (
              <>
                {BRL.format(limiteNum)}
                {mudou ? (
                  <>
                    {' '}
                    · substitui os{' '}
                    <strong>{BRL.format(Number(limiteSolicitado ?? 0))}</strong> que o comercial
                    pediu, e o novo valor fica registrado na análise
                  </>
                ) : (
                  ' · foi o que o comercial pediu'
                )}
              </>
            ) : (
              <span className="text-destructive">
                Informe um limite maior que zero — é ele que vai no pedido.
              </span>
            )}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">
              {soDocumentos ? 'Documentos a reenviar' : 'Documentos que vão junto'}
            </p>
            {docs.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground text-muted-foreground"
                  onClick={() => setMarcados(new Set(docs.map((d) => d.id)))}
                >
                  marcar todos
                </button>
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground text-muted-foreground"
                  onClick={() => setMarcados(new Set())}
                >
                  nenhum
                </button>
              </div>
            )}
          </div>

          {docs.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              {soDocumentos
                ? 'Nenhum documento anexado à análise — não há o que reenviar.'
                : 'Nenhum documento anexado. O pedido sai assim mesmo — a papelada vai por e-mail depois, pela mesma cobertura.'}
            </p>
          ) : (
            <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
              {docs.map((d) => (
                <li key={d.id}>
                  <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-muted/40">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={marcados.has(d.id)}
                      onChange={() => alternar(d.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm">
                        <FileText className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate">{rotulos.get(d.tipo) ?? d.tipo}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {d.nome_arquivo ?? d.arquivo_url}
                        </span>
                        {/*
                          Conferir ANTES de mandar é a razão de este diálogo existir — e
                          "é este arquivo mesmo?" não se responde pelo nome quando a pasta
                          tem três PDFs parecidos. O botão para o clique no label para não
                          desmarcar o documento que a pessoa quis abrir.
                        */}
                        <button
                          type="button"
                          className="shrink-0 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                          disabled={baixando === d.id}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            void baixar(d.id, d.arquivo_url, d.nome_arquivo)
                          }}
                        >
                          <Download className="mr-0.5 inline size-3" aria-hidden />
                          {baixando === d.id ? 'abrindo…' : 'abrir'}
                        </button>
                      </span>
                      {d.enviado_seguradora_em ? (
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-500">
                          <CheckCircle2 className="size-3" aria-hidden />
                          já enviado em{' '}
                          {new Date(d.enviado_seguradora_em).toLocaleDateString('pt-BR')}
                        </span>
                      ) : d.envio_seguradora_erro ? (
                        <span className="mt-0.5 flex items-start gap-1 text-[11px] text-destructive">
                          <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
                          {d.envio_seguradora_erro}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <p className="self-center text-xs text-muted-foreground">
            {escolhidos.length === 0
              ? 'Nenhum documento vai junto.'
              : `${escolhidos.length} de ${docs.length} documento(s).`}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => onConfirmar(escolhidos, soDocumentos ? 0 : limiteNum)}
              disabled={enviando || (soDocumentos ? escolhidos.length === 0 : !limiteValido)}
            >
              {enviando ? 'Enviando…' : soDocumentos ? 'Reenviar' : 'Enviar'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
