'use client'

import * as React from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EficaciaFontes } from './eficacia'
import { FunilFornecedores } from './funil'
import { PainelFornecedores } from './painel'

/**
 * Cadastro de Fornecedores (04l).
 *
 * Fornecedores que emitem NF contra nossos sacados e não estão na plataforma são
 * demanda latente de antecipação — a lista existia desde o 04 e era morta. Aqui ela
 * ganha dono, munição de abordagem e um motor de descoberta de contato.
 *
 * Três abas, e a ordem é a ordem das perguntas: quanto tenho e quanto gastei → em
 * quem ligo agora → qual fonte está pagando. A última é do gestor: ela decide
 * política de provedor, não trabalho do dia.
 */

type Aba = 'painel' | 'funil' | 'eficacia'

export function CadastroDeFornecedores({
  ehGestor,
  vendedorId,
  nomeUsuario,
}: {
  ehGestor: boolean
  vendedorId: string | null
  nomeUsuario: string | null
}) {
  const [aba, setAba] = React.useState<Aba>('funil')

  const abas: { id: Aba; rotulo: string; visivel: boolean }[] = [
    { id: 'funil', rotulo: 'Funil', visivel: true },
    { id: 'painel', rotulo: 'Meu painel', visivel: true },
    { id: 'eficacia', rotulo: 'Eficácia das fontes', visivel: ehGestor },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Cadastro de Fornecedores</h1>
        <p className="text-sm text-muted-foreground">
          Quem emite nota contra nossos sacados e ainda não está na plataforma. Entra por
          volume, sai por cadastro — e o cadastro é detectado no sync, não marcado à mão.
        </p>
      </div>

      <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
        <TabsList>
          {abas.filter((a) => a.visivel).map((a) => (
            <TabsTrigger key={a.id} value={a.id}>{a.rotulo}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {aba === 'funil' ? (
        <FunilFornecedores ehGestor={ehGestor} vendedorId={vendedorId} nomeUsuario={nomeUsuario} />
      ) : null}
      {aba === 'painel' ? <PainelFornecedores originadorId={vendedorId} /> : null}
      {aba === 'eficacia' && ehGestor ? <EficaciaFontes /> : null}
    </div>
  )
}
