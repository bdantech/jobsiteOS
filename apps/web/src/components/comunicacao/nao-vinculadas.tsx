'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link2, Mail, MessageCircle, Search, X } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { createClient } from '@/lib/supabase/client'
import { ignorarConversaAction, vincularConversaAction } from '@/actions/comunicacao'
import { buscarNaoVinculadas, type NaoVinculada } from './queries'
import { desde, identificadorLegivel } from './format'

/**
 * A fila de identificação (§4). UMA TELA, um clique.
 *
 * ── O NOME VEM PRÉ-PREENCHIDO, E ISSO NÃO É DETALHE ────────────────────────
 * O `pushName` do WhatsApp e o display name do e-mail são o que a própria pessoa
 * escolheu se chamar. Pedir para digitar do zero é o atrito que faz a fila
 * acumular — e uma fila de identificação acumulada é a mesma coisa que não ter
 * fila nenhuma.
 *
 * ── VINCULAR CRIA O CONTATO OFICIAL ────────────────────────────────────────
 * Não é só apontar para a empresa: o contato passa a existir, com base legal
 * derivada, e as mensagens já recebidas migram para a thread dele. Tudo numa
 * transação — meia vinculação seria um contato criado com a conversa órfã, e a
 * pessoa vincularia de novo criando um segundo contato.
 */
export function FilaNaoVinculadas() {
  const qc = useQueryClient()
  const fila = useQuery({ queryKey: ['comunicacao', 'nao-vinculadas'], queryFn: buscarNaoVinculadas })

  if (fila.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    )
  }

  const linhas = fila.data ?? []
  if (linhas.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Ninguém esperando identificação.</p>
        <p className="mt-1">Toda conversa recebida está vinculada a uma empresa.</p>
      </div>
    )
  }

  return (
    <ul className="space-y-3">
      {linhas.map((n) => (
        <li key={n.id}>
          <CartaoVinculacao
            n={n}
            onResolvida={() => {
              void qc.invalidateQueries({ queryKey: ['comunicacao'] })
            }}
          />
        </li>
      ))}
    </ul>
  )
}

interface EmpresaAchada {
  id: string
  cnpj: string
  nome: string
}

function CartaoVinculacao({ n, onResolvida }: { n: NaoVinculada; onResolvida: () => void }) {
  const [busca, setBusca] = React.useState('')
  const [empresa, setEmpresa] = React.useState<EmpresaAchada | null>(null)
  const [nome, setNome] = React.useState(n.nome_sugerido ?? '')
  const [cargo, setCargo] = React.useState('')
  const [ocupado, setOcupado] = React.useState(false)
  const [achadas, setAchadas] = React.useState<EmpresaAchada[]>([])

  const Icone = n.canal === 'email' ? Mail : MessageCircle

  async function procurar(termo: string) {
    setBusca(termo)
    const t = termo.trim()
    if (t.length < 3) {
      setAchadas([])
      return
    }
    const supabase = createClient()
    // Por CNPJ quando o que foi digitado são dígitos; por nome no resto. Uma busca
    // só por nome não acha nada quando a pessoa cola um CNPJ, que é o caso comum
    // de quem está identificando alguém a partir de uma assinatura de e-mail.
    const digitos = t.replace(/\D/g, '')
    const q =
      digitos.length >= 8
        ? supabase.from('empresas').select('id, cnpj, razao_social, nome_fantasia').ilike('cnpj', `${digitos}%`)
        : supabase
            .from('empresas')
            .select('id, cnpj, razao_social, nome_fantasia')
            .or(`razao_social.ilike.%${t}%,nome_fantasia.ilike.%${t}%`)

    const { data } = await q.limit(8)
    setAchadas(
      (data ?? []).map((e) => ({
        id: e.id,
        cnpj: e.cnpj,
        nome: e.razao_social ?? e.nome_fantasia ?? e.cnpj,
      })),
    )
  }

  async function vincular() {
    if (!empresa || !nome.trim()) return
    setOcupado(true)
    try {
      const r = await vincularConversaAction({
        id: n.id,
        empresa_id: empresa.id,
        nome: nome.trim(),
        cargo: cargo.trim() || null,
      })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      toast.success('Contato criado e conversa vinculada.')
      onResolvida()
    } finally {
      setOcupado(false)
    }
  }

  async function ignorar() {
    setOcupado(true)
    try {
      const r = await ignorarConversaAction({ id: n.id })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      onResolvida()
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icone className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="font-medium">
            {n.nome_sugerido ?? identificadorLegivel(n.canal, n.identificador_externo)}
          </span>
          {n.nome_sugerido ? (
            <span className="text-sm text-muted-foreground">
              {identificadorLegivel(n.canal, n.identificador_externo)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="h-5 text-[10px]">
            {n.qtd_mensagens} msg{n.qtd_mensagens === 1 ? '' : 's'}
          </Badge>
          <span>{desde(n.ultima_mensagem_em)}</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-3">
          <Label className="text-xs">Empresa</Label>
          {empresa ? (
            <div className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span>
                {empresa.nome} <span className="text-muted-foreground">{formatCnpj(empresa.cnpj)}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setEmpresa(null)}>
                trocar
              </Button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                  value={busca}
                  onChange={(e) => void procurar(e.target.value)}
                  placeholder="Nome ou CNPJ"
                  className="h-9 pl-8"
                />
              </div>
              {achadas.length > 0 ? (
                <ul className="mt-1 max-h-40 overflow-y-auto rounded border">
                  {achadas.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setEmpresa(e)
                          setAchadas([])
                        }}
                        className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        {e.nome} <span className="text-muted-foreground">{formatCnpj(e.cnpj)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>

        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Nome do contato</Label>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Cargo (opcional)</Label>
          <Input value={cargo} onChange={(e) => setCargo(e.target.value)} className="h-9" />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={vincular} disabled={!empresa || !nome.trim() || ocupado}>
          <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Vincular
        </Button>
        <Button size="sm" variant="ghost" onClick={ignorar} disabled={ocupado}>
          <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Ignorar
        </Button>
        <p className="self-center text-xs text-muted-foreground">
          Ignorar tira da fila. Se a pessoa escrever de novo, ela volta.
        </p>
      </div>
    </div>
  )
}
