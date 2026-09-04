'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link2, Unlink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { vincularSacadoAction } from '@/actions/comercial'
import {
  buscarContasCliente,
  buscarSacadosSemConta,
  comissaoKeys,
  type SacadoSemConta,
} from '../queries-comissao'
import { brlCurto, data as fmtData } from './format'

/**
 * Quem está operando sem conta.
 *
 * Esta tela existe porque o problema que ela resolve não emite sintoma. Uma NF faturada
 * contra um CNPJ que o sistema não liga a nenhum cliente converte normalmente, sai do
 * funil normalmente, e o motor de comissão termina com zero lançamentos porque
 * `empresa_id` é nulo. Não há erro, não há alerta — só um extrato menor do que devia.
 *
 * `app_holding_do_sacado` já deduz três coisas sozinha: o próprio CNPJ, a filial (mesma
 * raiz) e a SPE do grupo econômico. O que sobra aqui é o que dedução nenhuma alcança — a
 * SPE que é joint venture e por isso foi separada do grupo de propósito, o CNPJ que nem
 * está na base da Receita, o empreendimento que a gestão sabe de quem é e o dado público
 * não diz. Para esses, a única régua possível é uma pessoa olhar e dizer.
 */

function CNPJ({ valor }: { valor: string }) {
  const d = valor.replace(/\D/g, '').padStart(14, '0')
  return (
    <span className="tabular-nums">
      {`${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`}
    </span>
  )
}

function VincularDialog({
  sacado, onOpenChange, onFeito,
}: {
  sacado: SacadoSemConta | null
  onOpenChange: (v: boolean) => void
  onFeito: () => void
}) {
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const [busca, setBusca] = React.useState('')
  const [escolha, setEscolha] = React.useState('')

  const contas = useQuery({
    queryKey: comissaoKeys.contasCliente(),
    queryFn: buscarContasCliente,
    enabled: sacado !== null,
    staleTime: 5 * 60_000,
  })

  React.useEffect(() => {
    if (sacado) {
      setBusca('')
      setEscolha('')
      setErro(null)
    }
  }, [sacado])

  const termo = busca.trim().toLowerCase()
  const filtradas = (contas.data ?? []).filter(
    (c) =>
      termo === '' ||
      (c.razao_social ?? '').toLowerCase().includes(termo) ||
      c.cnpj.includes(termo.replace(/\D/g, '')),
  )

  return (
    <Dialog open={sacado !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!sacado) return
            const fd = new FormData(e.currentTarget)
            setSalvando(true)
            setErro(null)
            const r = await vincularSacadoAction({
              cnpj: sacado.cnpj,
              empresa_id: escolha,
              motivo: String(fd.get('motivo') ?? ''),
            })
            setSalvando(false)
            if (!r.ok) return setErro(r.message)
            toast.success('Vinculado. As cessões que ainda não passaram pelo motor passam a ter conta.')
            onFeito()
          }}
        >
          <DialogHeader>
            <DialogTitle>Vincular a uma conta</DialogTitle>
            <DialogDescription>
              {sacado?.nome ?? 'Este CNPJ'} passa a operar por baixo da conta escolhida. Vale para
              as cessões que ainda não foram lançadas — o que já está no extrato guarda a conta do
              dia em que converteu.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="busca-conta">Conta destino</Label>
              <Input
                id="busca-conta"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Filtrar por nome ou CNPJ…"
                autoComplete="off"
              />
              <select
                size={8}
                value={escolha}
                onChange={(e) => setEscolha(e.target.value)}
                className="w-full rounded-md border border-input bg-background p-1 text-sm"
              >
                {filtradas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.razao_social ?? c.cnpj}
                    {c.estagio === 'ex_cliente' ? ' (ex-cliente)' : ''}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {contas.isLoading
                  ? 'Carregando contas…'
                  : `${filtradas.length} conta(s). Só cliente ou ex-cliente pode receber um vínculo — as outras o motor ignoraria.`}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="motivo-vinculo">Por que este CNPJ é desta conta</Label>
              <Input
                id="motivo-vinculo"
                name="motivo"
                required
                minLength={3}
                placeholder="Ex.: é a SPE do empreendimento, aberta em sociedade com o dono do terreno."
              />
              <p className="text-xs text-muted-foreground">
                Obrigatório. É a única explicação que vai existir quando alguém contestar a folha —
                o parentesco não está em lugar nenhum do dado público, senão o sistema já teria
                achado sozinho.
              </p>
            </div>

            {erro ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {erro}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando || escolha === ''}>
              {salvando ? 'Vinculando…' : 'Vincular'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SacadosSemConta() {
  const qc = useQueryClient()
  const [alvo, setAlvo] = React.useState<SacadoSemConta | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: comissaoKeys.semConta(),
    queryFn: buscarSacadosSemConta,
  })

  if (isLoading) return <Skeleton className="h-64 w-full" />

  const lista = data ?? []
  const volume = lista.reduce((s, x) => s + x.volume, 0)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Unlink className="h-4 w-4" aria-hidden />
            Operando sem conta
          </CardTitle>
          <CardDescription>
            {lista.length === 0
              ? 'Todo CNPJ que converteu cessão resolve para uma conta. Nada aqui é bom sinal.'
              : `${lista.length} CNPJ(s) converteram ${brlCurto(volume)} e não pertencem a conta nenhuma — `
                + 'nem por CNPJ, nem por filial, nem por grupo econômico. Enquanto não tiverem dono, '
                + 'esse volume não paga comissão a ninguém.'}
          </CardDescription>
        </CardHeader>

        {lista.length > 0 ? (
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Sacado</th>
                    <th className="px-4 py-2 text-right font-medium">Cessões</th>
                    <th className="px-4 py-2 text-right font-medium">Volume</th>
                    <th className="px-4 py-2 text-right font-medium">Cedentes</th>
                    <th className="px-4 py-2 text-right font-medium">Última</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {lista.map((s) => (
                    <tr key={s.cnpj} className="border-b last:border-0">
                      <td className="px-4 py-2">
                        <div className="font-medium">{s.nome ?? '— sem nome na nota —'}</div>
                        <div className="text-xs text-muted-foreground">
                          <CNPJ valor={s.cnpj} />
                          {/*
                            O estágio do cadastro é a explicação mais frequente e a menos
                            óbvia: a empresa EXISTE, só não é cliente — e a régua da conta
                            só enxerga cliente e ex-cliente.
                          */}
                          {s.cadastro_estagio ? (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              cadastrada como {s.cadastro_estagio}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="ml-2 text-[10px]">sem cadastro</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{s.cessoes}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">
                        {brlCurto(s.volume)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{s.cedentes}</td>
                      <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                        {fmtData(s.ultima)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => setAlvo(s)}>
                          <Link2 className="mr-2 h-3.5 w-3.5" aria-hidden />
                          Vincular
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardContent className="py-3 text-xs text-muted-foreground">
          O vínculo é uma <strong>afirmação de identidade</strong>, não de titularidade: ele diz que
          este CNPJ é desta conta, e por isso não tem vigência. Quem recebe pela conta continua
          sendo decidido pela carteira — e uma conta vinculada ainda precisa de classificação
          (ativo × passivo) para gerar lançamento.
        </CardContent>
      </Card>

      <VincularDialog
        sacado={alvo}
        onOpenChange={(v) => { if (!v) setAlvo(null) }}
        onFeito={() => {
          setAlvo(null)
          void qc.invalidateQueries({ queryKey: comissaoKeys.semConta() })
        }}
      />
    </div>
  )
}
