'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Gavel, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
import { createClient } from '@/lib/supabase/client'
import { rodarProtestoFornecedorAction } from '@/actions/antecipacao'
import { formatarDataHora, formatarMoedaExata } from './format'
import { antecipacaoKeys } from './queries'

/**
 * Protesto do fornecedor, consultado a partir do FUNIL (§ prompt 04).
 *
 * A hipótese comercial é que fornecedor com protesto antecipa mais — é dinheiro
 * parado e um caminho de crédito a menos. Enquanto ela não estiver medida, o
 * protesto entra como sinal na tela e como variável de faixa, nunca como porta de
 * exclusão.
 *
 * Consulta PAGA e por CNPJ: o fornecedor de aquisição não existe em `empresas`, e
 * exigir a promoção antes inverteria a ordem da decisão — é o protesto que ajuda a
 * decidir quem vale promover.
 */

interface Custos {
  sp: number
  nacional: number
}

async function buscarCustoProtesto(): Promise<Custos> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('antecipacao_custo_protesto' as never)
  if (error) throw new Error(error.message)
  const c = data as unknown as { sp?: number; nacional?: number } | null
  return { sp: Number(c?.sp ?? 0), nacional: Number(c?.nacional ?? 0) }
}

export interface ProtestoFornecedorProps {
  cnpj: string
  uf: string | null
  temProtesto: boolean
  valor: number | null
  /** `null` = nunca consultamos. Diferente de "consultado e limpo". */
  consultadoEm: string | null
}

export function ProtestoFornecedor({
  cnpj,
  uf,
  temProtesto,
  valor,
  consultadoEm,
}: ProtestoFornecedorProps) {
  const qc = useQueryClient()
  const [confirmando, setConfirmando] = React.useState(false)
  const [disparando, setDisparando] = React.useState(false)

  const { data: custos } = useQuery({
    queryKey: [...antecipacaoKeys.all, 'custo-protesto'],
    queryFn: buscarCustoProtesto,
    staleTime: 60 * 60_000,
  })

  // O roteamento do lote manda para o endpoint de SP quando a UF é SP e para o
  // nacional no resto — inclusive quando a UF ainda é desconhecida, porque o lookup
  // cadastral não respondeu. Mostrar o preço do caso otimista seria mentir por
  // omissão justo na tela que pede aprovação de gasto.
  const emSp = uf === 'SP'
  const custo = custos ? (emSp ? custos.sp : custos.nacional) : null

  const jaConsultado = consultadoEm !== null

  async function consultar() {
    setDisparando(true)
    const r = await rodarProtestoFornecedorAction(cnpj)
    setDisparando(false)
    setConfirmando(false)

    if (!r.ok) {
      toast.error(r.message)
      return
    }
    if (!r.data.enfileirado) {
      toast.error(r.data.aviso ?? 'Não foi possível disparar a consulta.')
      return
    }
    // Assíncrono de propósito: o worker devolve 202, consulta a DirectD e só depois
    // reclassifica o funil. Prometer resultado imediato produziria "cliquei e não
    // mudou nada".
    toast.success('Consultando protesto. O funil é reclassificado logo em seguida.')
    void qc.invalidateQueries({ queryKey: antecipacaoKeys.fornecedor(cnpj) })
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Gavel className="h-4 w-4 text-muted-foreground" aria-hidden />
                <CardTitle className="text-base">Protesto</CardTitle>
                {jaConsultado &&
                  (temProtesto ? (
                    <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
                      Com protesto
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Sem protesto
                    </Badge>
                  ))}
              </div>
              <CardDescription>
                {jaConsultado ? (
                  <>
                    Consultado em {formatarDataHora(consultadoEm)}
                    {temProtesto && valor !== null ? (
                      <>
                        {' '}
                        · <strong>{formatarMoedaExata(valor)}</strong> em protestos
                      </>
                    ) : null}
                    . Entra como variável nas regras de faixa.
                  </>
                ) : (
                  <>
                    Nunca consultamos este CNPJ — o que <strong>não</strong> quer dizer que
                    esteja limpo. A consulta é paga e entra como variável nas regras de faixa.
                  </>
                )}
              </CardDescription>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setConfirmando(true)}
              disabled={disparando}
            >
              {jaConsultado ? 'Consultar de novo' : 'Consultar protesto'}
              {custo !== null ? ` · ${formatarMoedaExata(custo)}` : ''}
            </Button>
          </div>
        </CardHeader>

        {jaConsultado && temProtesto ? (
          <CardContent className="pt-0">
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                Protesto é sinal de <strong>caixa apertado</strong>, e a leitura comercial é
                que isso aumenta o interesse em antecipar. Não é motivo de descarte por si
                só — a decisão de crédito é do sacado, não do fornecedor.
              </p>
            </div>
          </CardContent>
        ) : null}
      </Card>

      <Dialog open={confirmando} onOpenChange={setConfirmando}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Consultar protesto</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Consulta paga na DirectD{' '}
                  {custo !== null ? (
                    <>
                      — <strong>{formatarMoedaExata(custo)}</strong>{' '}
                      {emSp ? '(base SP)' : '(base nacional)'}.
                    </>
                  ) : (
                    '.'
                  )}
                </p>
                {!emSp && (
                  <p className="text-xs">
                    {uf
                      ? `O fornecedor é de ${uf}, fora da base de SP.`
                      : 'A UF deste CNPJ ainda não foi enriquecida, então vai pela base nacional.'}
                  </p>
                )}
                {jaConsultado && (
                  <p className="text-xs">
                    Já consultado em {formatarDataHora(consultadoEm)} — isto cobra de novo.
                  </p>
                )}
                <p className="text-xs">
                  O funil é reclassificado em seguida: o protesto é variável das regras de
                  faixa, e consultar sem reclassificar deixaria o dado novo com a faixa velha.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmando(false)} disabled={disparando}>
              Cancelar
            </Button>
            <Button onClick={() => void consultar()} disabled={disparando}>
              <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden />
              {disparando ? 'Disparando…' : 'Consultar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
