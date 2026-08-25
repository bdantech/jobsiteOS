'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { buscarVendedoresVisiveis, comercialKeys } from './queries'
import { Extrato } from './comissao/extrato'
import { FilaAceite } from './comissao/fila-aceite'
import { Historico } from './comissao/historico'
import { MesCorrente } from './comissao/mes-corrente'
import { Reclassificacao } from './comissao/reclassificacao'
import { Simulador } from './comissao/simulador'
import { competenciaCorrente, useExtratoLive } from './comissao/use-extrato-live'
import { ComissoesAntigas } from './comissao/modelo-anterior'

/**
 * A aba Comissões (04k §7).
 *
 * O motor v2 substitui as regras do 04g — mas NÃO recalcula o que o 04g já apurou. As
 * competências antigas continuam sendo lidas da tabela antiga, marcadas como "modelo
 * anterior": mudar o número de uma folha já paga é pior que mostrar dois modelos.
 *
 * A ordem das abas é a ordem das perguntas: quanto tenho este mês → como foi ao longo do
 * ano → por que este valor. O extrato é a tela central, mas ela não é a primeira porque
 * a pergunta que traz a pessoa aqui é o número, e o extrato é a resposta ao "por quê"
 * que vem depois.
 */

type Aba = 'mes' | 'historico' | 'extrato' | 'simulador' | 'reclassificacao' | 'aceites' | 'anterior'

export function Comissoes({
  ehGestor,
  vendedorId,
}: {
  ehGestor: boolean
  vendedorId: string | null
}) {
  const [aba, setAba] = React.useState<Aba>('mes')
  /*
   * O seletor de vendedor só existe para gestor, e o default é CONSOLIDADO. Abrir num
   * vendedor arbitrário faria o gestor achar que o total da empresa é o daquela pessoa —
   * e o consolidado é justamente a pergunta que só ele pode fazer.
   */
  const [verVendedor, setVerVendedor] = React.useState<string>(ehGestor ? '' : (vendedorId ?? ''))
  const [competencia, setCompetencia] = React.useState<string>(competenciaCorrente())

  const visiveis = useQuery({
    queryKey: comercialKeys.visiveis(),
    queryFn: buscarVendedoresVisiveis,
    enabled: ehGestor,
  })

  const alvo = verVendedor || null
  const ehCorrente = competencia === competenciaCorrente()
  const aoVivo = useExtratoLive(competencia, ehCorrente)

  const abas: { id: Aba; rotulo: string; visivel: boolean }[] = [
    { id: 'mes', rotulo: 'Mês corrente', visivel: true },
    { id: 'historico', rotulo: 'Histórico', visivel: true },
    { id: 'extrato', rotulo: 'Extrato', visivel: true },
    { id: 'aceites', rotulo: 'Fila de aceite', visivel: true },
    { id: 'simulador', rotulo: 'Simulador', visivel: ehGestor },
    { id: 'reclassificacao', rotulo: 'Reclassificação', visivel: ehGestor },
    { id: 'anterior', rotulo: 'Modelo anterior', visivel: true },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Comissões</h1>
          <p className="text-sm text-muted-foreground">
            O lançamento nasce na conversão da NF, em VOP. Provisionado ainda não é fechado,
            fechado ainda não é aprovado, e aprovado ainda não é pago.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {ehGestor ? (
            <div className="space-y-1">
              <label htmlFor="ver-vendedor" className="text-xs text-muted-foreground">Ver</label>
              <select
                id="ver-vendedor"
                value={verVendedor}
                onChange={(e) => setVerVendedor(e.target.value)}
                className="h-9 w-56 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Consolidado (todos)</option>
                {(visiveis.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>{v.nome}</option>
                ))}
              </select>
            </div>
          ) : null}
          {aba === 'extrato' ? (
            <div className="space-y-1">
              <label htmlFor="competencia" className="text-xs text-muted-foreground">Competência</label>
              <Input
                id="competencia"
                type="month"
                value={competencia.slice(0, 7)}
                onChange={(e) => setCompetencia(`${e.target.value}-01`)}
                className="w-44"
              />
            </div>
          ) : null}
        </div>
      </div>

      <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
        <TabsList className="flex-wrap">
          {abas.filter((a) => a.visivel).map((a) => (
            <TabsTrigger key={a.id} value={a.id}>{a.rotulo}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {aba === 'mes' ? <MesCorrente vendedorId={alvo} aoVivo={aoVivo && ehCorrente} /> : null}
      {aba === 'historico' ? (
        <Historico
          vendedorId={alvo}
          ehGestor={ehGestor}
          onAbrirCompetencia={(c) => {
            setCompetencia(c)
            setAba('extrato')
          }}
        />
      ) : null}
      {aba === 'extrato' ? (
        <Extrato
          competencia={competencia}
          vendedorId={alvo}
          aoVivo={aoVivo}
          mostrarVendedor={alvo === null}
        />
      ) : null}
      {aba === 'aceites' ? <FilaAceite /> : null}
      {aba === 'simulador' && ehGestor ? <Simulador /> : null}
      {aba === 'reclassificacao' && ehGestor ? <Reclassificacao /> : null}
      {aba === 'anterior' ? <ComissoesAntigas /> : null}

      {aba === 'mes' || aba === 'extrato' ? (
        <Card>
          <CardContent className="py-3 text-xs text-muted-foreground">
            <strong>VOP</strong> = valor cedido × dias de antecipação ÷ dias de referência.
            Uma antecipação de 45 dias imobiliza uma vez e meia o que uma de 30 imobiliza —
            pagar as duas igual premiaria a operação mais barata para nós na mesma medida
            que a mais cara.
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
