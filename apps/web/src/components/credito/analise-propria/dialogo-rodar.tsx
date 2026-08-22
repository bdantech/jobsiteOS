'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Gavel, PlayCircle, RefreshCw } from 'lucide-react'
import { protestoVencido, type OpcoesProtesto } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { buscarPreviaProtestos, empresasKeys } from '@/components/empresas/queries'
import { brl } from './resultado'

/**
 * O que perguntar antes de rodar a análise.
 *
 * ─── POR QUE ISTO VIROU UM DIÁLOGO ──────────────────────────────────────────
 * Rodar a análise deixou de ser só ler documentos: agora ela consulta protesto antes,
 * porque protesto é fator do scorecard e o scorecard é o teto 5. Consultar é PAGO e é por
 * CNPJ — então o clique passou a ter preço, e clique com preço mostra o preço antes.
 *
 * ─── A MATRIZ NÃO É PERGUNTADA; AS SPEs SÃO ─────────────────────────────────
 * A matriz é uma só e sempre importa: ela entra sozinha, e só é reconsultada se a última
 * consulta já venceu a janela de recência. Perguntar "quer consultar a matriz?" seria
 * pedir para a pessoa decidir algo que tem uma resposta certa.
 *
 * As SPEs são o contrário: podem ser dezenas, e quais delas importam é julgamento. O corte
 * por ano de criação é o mesmo que a ficha da empresa já usa — a mesma pergunta merece a
 * mesma forma, e quem já respondeu numa reconhece na outra.
 */

const ANO_ATUAL = new Date().getFullYear()
const ANOS = Array.from({ length: ANO_ATUAL - 1999 }, (_, i) => ANO_ATUAL - i)

export function DialogoRodarAnalise({
  aberto,
  onOpenChange,
  empresaId,
  temGrupo,
  protestoConsultadoEm,
  recenciaDias,
  anosAtrasPadrao,
  jaTemPropria,
  rodando,
  onConfirmar,
}: {
  aberto: boolean
  onOpenChange: (a: boolean) => void
  empresaId: string | null
  temGrupo: boolean
  protestoConsultadoEm: string | null
  recenciaDias: number
  anosAtrasPadrao: number
  jaTemPropria: boolean
  rodando: boolean
  onConfirmar: (protestos: OpcoesProtesto) => void
}) {
  const [incluirSpes, setIncluirSpes] = React.useState(false)
  const [modoSpes, setModoSpes] = React.useState<'ano' | 'afiancadas'>('ano')
  const [anoMin, setAnoMin] = React.useState(ANO_ATUAL - anosAtrasPadrao)

  const afiancadas = incluirSpes && modoSpes === 'afiancadas'
  const anoEfetivo = incluirSpes && !afiancadas ? anoMin : null

  const matrizVencida = protestoVencido(protestoConsultadoEm, recenciaDias, new Date())

  const previa = useQuery({
    queryKey: empresasKeys.previaProtestos(empresaId ?? '', incluirSpes, anoEfetivo, afiancadas),
    queryFn: () => buscarPreviaProtestos(empresaId as string, incluirSpes, anoEfetivo, afiancadas),
    enabled: aberto && !!empresaId,
  })

  /*
   * A prévia conta a matriz SEMPRE (é o comportamento do RPC do Radar). Quando ela não vai
   * ser reconsultada, o custo real é um CNPJ a menos — e mostrar o número cheio faria a
   * tela cobrar por algo que não vai acontecer.
   */
  const qtdBruta = previa.data?.qtd ?? 0
  const custoBruto = previa.data?.custo_estimado ?? 0
  const porCnpj = qtdBruta > 0 ? custoBruto / qtdBruta : 0
  const qtd = matrizVencida ? qtdBruta : Math.max(0, qtdBruta - 1)
  const custo = matrizVencida ? custoBruto : Math.max(0, custoBruto - porCnpj)

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{jaTemPropria ? 'Rodar a análise de novo' : 'Rodar nossa análise'}</DialogTitle>
          <DialogDescription>
            Antes de ler os documentos, o protesto é consultado e o score, recalculado — é
            por ele que o protesto chega ao limite.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <Gavel className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="space-y-0.5">
              <p className="font-medium">Protesto da matriz</p>
              <p className="text-xs text-muted-foreground">
                {matrizVencida
                  ? protestoConsultadoEm
                    ? `Última consulta em ${new Date(protestoConsultadoEm).toLocaleDateString('pt-BR')}, fora da janela de ${recenciaDias} dias. Será consultada.`
                    : 'Nunca consultada. Será consultada — e isso não é o mesmo que "sem protesto".'
                  : `Consultada em ${new Date(protestoConsultadoEm as string).toLocaleDateString('pt-BR')}, dentro da janela de ${recenciaDias} dias. Será reaproveitada, sem custo.`}
              </p>
            </div>
          </div>

          {temGrupo ? (
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="analise-spes">Incluir SPEs do grupo</Label>
                <p className="text-xs text-muted-foreground">
                  Uma consulta por SPE. Escolha quais importam.
                </p>
              </div>
              <Switch id="analise-spes" checked={incluirSpes} onCheckedChange={setIncluirSpes} />
            </div>
          ) : (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              Esta empresa não está em nenhum grupo econômico — não há SPEs a consultar.
            </p>
          )}

          {incluirSpes ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Quais SPEs</Label>
                <Select value={modoSpes} onValueChange={(v) => setModoSpes(v as 'ano' | 'afiancadas')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ano">Ativas, por ano de criação</SelectItem>
                    <SelectItem value="afiancadas">Somente as afiançadas</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {modoSpes === 'ano' ? (
                <div className="space-y-1">
                  <Label>Criadas a partir de</Label>
                  <Select value={String(anoMin)} onValueChange={(v) => setAnoMin(Number(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {ANOS.map((a) => (
                        <SelectItem key={a} value={String(a)}>
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Só SPEs com início de atividade nesse ano ou depois. Obra antiga já
                    entregue raramente muda a leitura de risco de hoje.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  As SPEs marcadas no monitoramento mensal de protesto — a mesma pergunta já
                  respondida à mão. Zero aqui significa que ninguém marcou nenhuma ainda.
                </p>
              )}
            </div>
          ) : null}

          <div className="rounded-md bg-muted/50 p-3 text-sm">
            {!empresaId ? (
              <span className="text-muted-foreground">
                Sem empresa cadastrada: a análise roda, mas sem consulta de protesto.
              </span>
            ) : previa.isPending ? (
              <span className="text-muted-foreground">Calculando estimativa…</span>
            ) : qtd === 0 ? (
              <span className="text-muted-foreground">
                Nenhuma consulta nova — nada será cobrado.
              </span>
            ) : (
              <span>
                <strong>{qtd}</strong> consulta(s) de protesto · custo estimado{' '}
                <strong>{brl(custo)}</strong>
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={rodando}
            onClick={() =>
              onConfirmar({
                incluir_spes: incluirSpes,
                ano_min: anoEfetivo,
                somente_afiancadas: afiancadas,
              })
            }
          >
            {jaTemPropria ? (
              <RefreshCw className="mr-1.5 size-3.5" aria-hidden />
            ) : (
              <PlayCircle className="mr-1.5 size-3.5" aria-hidden />
            )}
            {rodando ? 'Iniciando…' : 'Consultar e analisar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
