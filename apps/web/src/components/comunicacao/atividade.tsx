'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, Lock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { createClient } from '@/lib/supabase/client'
import type { PainelAtividade } from '@jobsiteos/core'

/**
 * PAINEL DE ATIVIDADE (§8). Restrito, e a restrição é a decisão de produto.
 *
 * Visível a gestores e a quem tem `vendedor_acessos` — nunca ao próprio vendedor
 * sobre si. Um painel de volume que a pessoa vê sobre si mesma vira meta, e a
 * meta mais fácil de bater aqui é mandar mais mensagem.
 *
 * Pela mesma razão, VOLUME NUNCA APARECE SOZINHO: taxa de resposta, reuniões
 * agendadas e NFs convertidas vêm na mesma linha. Uma tela que só conta mensagens
 * enviadas ensina a mandar mensagem, não a vender.
 *
 * Quem decide o acesso é o RPC (`app_comunicacao_atividade`), não este
 * componente: a view não tem grant para `authenticated`, então não há consulta
 * direta possível.
 */
export function PainelDeAtividade() {
  const [dias, setDias] = React.useState('30')
  const [canal, setCanal] = React.useState('todos')

  const consulta = useQuery({
    queryKey: ['comunicacao', 'atividade', dias, canal],
    queryFn: async (): Promise<PainelAtividade> => {
      const de = new Date(Date.now() - Number(dias) * 86_400_000).toISOString().slice(0, 10)
      const { data, error } = await createClient().rpc('app_comunicacao_atividade', {
        p: { de, canal: canal === 'todos' ? null : canal } as never,
      })
      if (error) throw new Error(error.message)
      const corpo = (data ?? {}) as Partial<PainelAtividade>
      return { tem_acesso: corpo.tem_acesso ?? false, de: corpo.de, ate: corpo.ate, linhas: corpo.linhas ?? [] }
    },
  })

  if (consulta.isLoading) return <Skeleton className="h-64" />

  if (!consulta.data?.tem_acesso) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        <Lock className="mx-auto mb-2 h-5 w-5" aria-hidden />
        <p className="font-medium text-foreground">Este painel não é sobre você.</p>
        <p className="mx-auto mt-1 max-w-lg">
          Ele é de quem coordena — e, de propósito, ninguém vê o próprio volume aqui. Um número de
          mensagens enviadas que a pessoa acompanha sobre si vira meta, e a meta mais fácil de bater
          é mandar mais mensagem.
        </p>
      </div>
    )
  }

  const linhas = consulta.data.linhas

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select value={dias} onValueChange={setDias}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
            <SelectItem value="90">Últimos 90 dias</SelectItem>
          </SelectContent>
        </Select>
        <Select value={canal} onValueChange={setCanal}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os canais</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="email">E-mail</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {linhas.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhuma atividade no período.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pessoa</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead className="text-right">Enviadas</TableHead>
                <TableHead className="text-right">Recebidas</TableHead>
                <TableHead className="text-right">Contatos/dia</TableHead>
                <TableHead className="text-right">Empresas</TableHead>
                {/* O resultado vem SEMPRE ao lado do volume. */}
                <TableHead className="text-right">Taxa de resposta</TableHead>
                <TableHead className="text-right">Reuniões</TableHead>
                <TableHead className="text-right">NFs convertidas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={`${l.vendedor_id}-${l.canal}`}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1.5">
                      {l.vendedor_nome}
                      {l.is_ia ? <Bot className="h-3.5 w-3.5 text-primary" aria-label="Persona de IA" /> : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="h-5 text-[10px]">
                      {l.canal === 'email' ? 'E-mail' : l.canal === 'whatsapp' ? 'WhatsApp' : l.canal}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{l.enviadas}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.recebidas}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.contatos_distintos_dia}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.empresas_tocadas}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{l.taxa_resposta}%</TableCell>
                  <TableCell className="text-right tabular-nums">{l.reunioes_agendadas}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.nfs_convertidas}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
