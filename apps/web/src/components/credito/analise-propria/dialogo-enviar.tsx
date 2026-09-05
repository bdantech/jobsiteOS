'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, FileText } from 'lucide-react'
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
import { buscarCreditoConfig, creditoKeys } from '../queries'

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

interface TipoDoc {
  id: string
  label: string
}

export function DialogoEnviarSeguradora({
  aberto,
  onOpenChange,
  nome,
  docs,
  enviando,
  onConfirmar,
}: {
  aberto: boolean
  onOpenChange: (v: boolean) => void
  nome: string
  docs: Tables<'analise_docs'>[]
  enviando: boolean
  onConfirmar: (docIds: string[]) => void
}) {
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
          <DialogTitle>Enviar à seguradora</DialogTitle>
          <DialogDescription>
            O envio resolve o cadastro do buyer na Atradius, e{' '}
            <strong>essa consulta pode ser cobrada</strong> — uma vez por CNPJ que ainda não tem
            cadastro. Depois disso o pedido de cobertura é submetido e a decisão chega pelo
            acompanhamento automático.
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-md border p-3 text-sm">{nome}</p>

        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">Documentos que vão junto</p>
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
              Nenhum documento anexado. O pedido sai assim mesmo — a seguradora aceita anexo
              depois, pela mesma cobertura.
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
                      <span className="block truncate text-xs text-muted-foreground">
                        {d.nome_arquivo ?? d.arquivo_url}
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
            <Button onClick={() => onConfirmar(escolhidos)} disabled={enviando}>
              {enviando ? 'Enviando…' : 'Enviar'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
