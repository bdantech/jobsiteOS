'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, Lock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { createClient } from '@/lib/supabase/client'
import type { PainelAtividade } from '@jobsiteos/core'
import {
  CartaoGrafico,
  GraficoEmpresasPorDia,
  MapaDeCalorPorHora,
  type PontoDia,
  type PontoHora,
} from './atividade-graficos'

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
/**
 * Os canais são os quatro tipos de comunicação do ledger — o pedido é explícito
 * em valer "para qualquer tipo (msg, ligação, reunião)". `interno` fica fora
 * sempre: alerta de plantão não é trabalho comercial de ninguém.
 */
const CANAIS: { valor: string; label: string }[] = [
  { valor: 'todos', label: 'Todos os canais' },
  { valor: 'whatsapp', label: 'WhatsApp' },
  { valor: 'email', label: 'E-mail' },
  { valor: 'ligacao', label: 'Ligações' },
  { valor: 'reuniao', label: 'Reuniões' },
]

interface SeriesAtividade {
  tem_acesso: boolean
  por_dia: PontoDia[]
  por_hora: PontoHora[]
}

export function PainelDeAtividade() {
  const [dias, setDias] = React.useState('30')
  const [canal, setCanal] = React.useState('todos')
  const [direcao, setDirecao] = React.useState('todas')
  const [metrica, setMetrica] = React.useState<'empresas' | 'mensagens'>('empresas')

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

  const series = useQuery({
    queryKey: ['comunicacao', 'atividade', 'series', dias, canal, direcao],
    queryFn: async (): Promise<SeriesAtividade> => {
      const de = new Date(Date.now() - Number(dias) * 86_400_000).toISOString().slice(0, 10)
      const { data, error } = await createClient().rpc('app_comunicacao_atividade_series', {
        p: {
          de,
          canal: canal === 'todos' ? null : canal,
          direcao: direcao === 'todas' ? null : direcao,
        } as never,
      })
      if (error) throw new Error(error.message)
      const corpo = (data ?? {}) as Partial<SeriesAtividade>
      return {
        tem_acesso: corpo.tem_acesso ?? false,
        por_dia: corpo.por_dia ?? [],
        por_hora: corpo.por_hora ?? [],
      }
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
            {CANAIS.map((c) => (
              <SelectItem key={c.valor} value={c.valor}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/*
          Direção separada do canal, e não "WhatsApp enviadas" numa lista só: são
          duas perguntas independentes, e cruzá-las numa lista daria dez opções
          para responder o que dois seletores respondem com sete.
        */}
        <Select value={direcao} onValueChange={setDirecao}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Enviadas e recebidas</SelectItem>
            <SelectItem value="saida">Só enviadas</SelectItem>
            <SelectItem value="entrada">Só recebidas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Os dois desenhos, antes da tabela ────────────────────────────────
        Eles vêm primeiro porque respondem à pergunta de forma ("como o dia da
        equipe se distribui?"), e a tabela responde à de volume. Quem abre esta
        aba está olhando a operação, não conferindo um número.
      */}
      <CartaoGrafico
        titulo={metrica === 'empresas' ? 'Empresas tocadas por dia' : 'Mensagens por dia'}
        descricao={
          metrica === 'empresas'
            ? 'Empresas distintas por dia, empilhadas por vendedor. Conversa ainda não identificada conta como uma — é trabalho feito.'
            : 'Volume de mensagens por dia, empilhado por vendedor.'
        }
      >
        <div className="space-y-3">
          <div className="flex gap-1.5">
            {(['empresas', 'mensagens'] as const).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={metrica === m ? 'default' : 'outline'}
                onClick={() => setMetrica(m)}
              >
                {m === 'empresas' ? 'Empresas' : 'Mensagens'}
              </Button>
            ))}
          </div>
          {series.isLoading ? (
            <Skeleton className="h-52" />
          ) : (
            <GraficoEmpresasPorDia pontos={series.data?.por_dia ?? []} metrica={metrica} />
          )}
        </div>
      </CartaoGrafico>

      <CartaoGrafico
        titulo="Em que horas o trabalho acontece"
        descricao="Mensagens por hora do dia, uma linha por pessoa. Vale para qualquer canal — use os filtros acima."
      >
        {series.isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <MapaDeCalorPorHora pontos={series.data?.por_hora ?? []} />
        )}
      </CartaoGrafico>

      {linhas.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhuma atividade no período.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
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
