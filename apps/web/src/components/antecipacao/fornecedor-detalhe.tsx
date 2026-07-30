'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ExternalLink, History, SearchX, UserPlus } from 'lucide-react'
import {
  EVENTO_LABELS,
  FAIXA_LABELS,
  TIPAGEM_DESCRICOES,
  TIPAGEM_LABELS,
  formatCnpj,
  type Faixa,
  type Tipagem,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { FichaVoltar } from '@/components/ficha/ficha'
import { CadastroRfb } from '@/components/cadastro/cadastro-rfb'
import { EmpresaContatos } from '@/components/empresas/empresa-contatos'
import { promoverFornecedorAction } from '@/actions/antecipacao'
import { NotaCard } from './nota-card'
import { ProtestoFornecedor } from './protesto-fornecedor'
import { FAIXA_BADGE, TIPAGEM_BADGE, formatarDataHora, formatarInteiro, formatarMoeda } from './format'
import { antecipacaoKeys, buscarDetalheFornecedor } from './queries'

/**
 * Todas as notas de um fornecedor, com o histórico de toques.
 *
 * Existe porque o FORNECEDOR é a unidade de abordagem: antes de ligar, alguém
 * precisa ver as cinco notas dele de uma vez, o total, e se já houve toque esta
 * semana. Sem esta tela, o vendedor liga com a informação de UM card e descobre as
 * outras quatro notas durante a ligação.
 */
export function FornecedorDetalhe({ cnpj }: { cnpj: string }) {
  const qc = useQueryClient()
  const [promovendo, setPromovendo] = React.useState(false)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: antecipacaoKeys.fornecedor(cnpj),
    queryFn: () => buscarDetalheFornecedor(cnpj),
  })

  /**
   * Fornecedor de AQUISIÇÃO não vira `empresas` no sync, e isso é decisão: são
   * centenas de CNPJs por semana que ninguém trabalha, e criar empresa para todos
   * transformaria o CRM num espelho da carteira de notas dos clientes.
   *
   * Mas a decisão só se sustenta se houver a porta manual — que é este botão.
   * Promover cria a empresa a partir do cadastro já enriquecido, e é a partir daí
   * que existem contatos, timeline e toques para este fornecedor.
   */
  async function promover(): Promise<string | null> {
    setPromovendo(true)
    // `promoverFornecedorAction`, e não a de Mercado: aquela autoriza por `/mercado` e
    // esbarra em mais duas policies (ver 0068). Com um usuário Admin as duas
    // funcionam; com o perfil Comercial, só esta.
    const r = await promoverFornecedorAction(cnpj)
    setPromovendo(false)
    if (!r.ok) {
      toast.error(r.message)
      return null
    }
    void qc.invalidateQueries({ queryKey: antecipacaoKeys.fornecedor(cnpj) })
    return r.data?.id ?? null
  }

  async function promoverPeloBotao() {
    const id = await promover()
    if (id) toast.success('Fornecedor promovido — agora ele tem ficha, contatos e histórico.')
  }

  /**
   * A promoção como CONSEQUÊNCIA de adicionar contato, não como pré-requisito.
   *
   * `contatos.empresa_id` é NOT NULL, então tecnicamente a empresa precisa existir
   * antes. Mas exigir que a pessoa lembre disso — promover, esperar, voltar, aí sim
   * cadastrar — é o tipo de passo que faz o contato simplesmente não ser cadastrado.
   * Um fornecedor com contato é, por definição, um fornecedor que alguém trabalha:
   * ele merece a ficha.
   */
  async function promoverParaContato(): Promise<string | null> {
    const id = await promover()
    if (id) toast.success('Fornecedor promovido para Empresas junto com o contato.')
    return id
  }

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-52 w-full rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro ao carregar o fornecedor.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { fornecedor, notas, toques } = data

  if (notas.length === 0) {
    return (
      <div className="space-y-4">
        <FichaVoltar href="/antecipacao">Funil</FichaVoltar>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-20 text-center">
            <div className="rounded-full bg-muted p-3">
              <SearchX className="h-6 w-6 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-lg font-medium">Nenhuma nota para este CNPJ</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Ele pode não ter notas sincronizadas, ou você pode não ter acesso a elas.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const primeira = notas[0]
  const nome = fornecedor?.fornecedor_nome ?? primeira?.fornecedor_nome ?? formatCnpj(cnpj)
  const tipagem = (fornecedor?.fornecedor_tipagem ?? primeira?.fornecedor_tipagem) as Tipagem | null
  const empresaId = fornecedor?.fornecedor_empresa_id ?? primeira?.fornecedor_empresa_id ?? null

  const valorTotal = notas.reduce((s, n) => s + Number(n.valor ?? 0), 0)
  const receitaTotal = notas.reduce((s, n) => s + Number(n.receita_esperada ?? 0), 0)
  const vivas = notas.filter((n) => n.faixa !== null)

  return (
    <div className="space-y-4">
      <FichaVoltar href="/antecipacao">Funil</FichaVoltar>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-lg">{nome}</CardTitle>
              <CardDescription className="font-mono tabular-nums">{formatCnpj(cnpj)}</CardDescription>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {tipagem && (
                  <Badge className={TIPAGEM_BADGE[tipagem]} title={TIPAGEM_DESCRICOES[tipagem]}>
                    {TIPAGEM_LABELS[tipagem]}
                  </Badge>
                )}
                {fornecedor?.melhor_faixa && (
                  <Badge className={FAIXA_BADGE[fornecedor.melhor_faixa as Faixa]}>
                    Melhor faixa: {FAIXA_LABELS[fornecedor.melhor_faixa as Faixa]}
                  </Badge>
                )}
                {fornecedor?.fornecedor_suprimido && (
                  <Badge variant="outline" className="text-destructive">
                    Suprimido
                  </Badge>
                )}
              </div>
            </div>

            {empresaId ? (
              <Button variant="outline" asChild>
                <Link href={`/empresas/${empresaId}`}>
                  <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                  Company 360
                </Link>
              </Button>
            ) : (
              <Button variant="outline" onClick={() => void promoverPeloBotao()} disabled={promovendo}>
                <UserPlus className="mr-2 h-4 w-4" aria-hidden />
                {promovendo ? 'Promovendo…' : 'Promover para Empresas'}
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Notas (total)</dt>
              <dd className="text-lg font-medium tabular-nums">{formatarInteiro(notas.length)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Notas em faixa</dt>
              <dd className="text-lg font-medium tabular-nums">{formatarInteiro(vivas.length)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Valor total</dt>
              <dd className="text-lg font-medium tabular-nums">{formatarMoeda(valorTotal)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Receita esperada</dt>
              <dd className="text-lg font-medium tabular-nums text-emerald-700 dark:text-emerald-300">
                {formatarMoeda(receitaTotal)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/*
       * Cadastro antes de contatos, e contatos antes das notas: é a ordem da
       * decisão. "Vale a pena?" (capital, idade, situação) → "para quem eu ligo?"
       * → "sobre o quê?".
       */}
      <CadastroRfb cnpj={cnpj} />

      {/*
       * Protesto entre o cadastro e os contatos: é a segunda pergunta do "vale a
       * pena?" e a que custa dinheiro para responder.
       */}
      <ProtestoFornecedor
        cnpj={cnpj}
        uf={primeira?.fornecedor_uf ?? null}
        temProtesto={primeira?.fornecedor_tem_protesto ?? false}
        valor={primeira?.fornecedor_protesto_valor ?? null}
        consultadoEm={primeira?.fornecedor_protesto_em ?? null}
      />

      {/*
       * O mesmo componente com ou sem empresa. Sem ela, `aoPrecisarDeEmpresa` promove
       * no momento de salvar — a promoção deixa de ser um passo que a pessoa precisa
       * lembrar de fazer antes e vira consequência de cadastrar o contato.
       */}
      <EmpresaContatos empresaId={empresaId} aoPrecisarDeEmpresa={promoverParaContato} />

      {toques.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" aria-hidden />
              <CardTitle className="text-base">Histórico de toques</CardTitle>
            </div>
            <CardDescription>
              Toques manuais do time e mensagens geradas em modo sombra. O cooldown da régua enxerga
              os dois — é o que evita a automação atropelar quem acabou de ligar.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {toques.map((t) => {
                const payload = (t.payload ?? {}) as Record<string, unknown>
                return (
                  <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 px-6 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{EVENTO_LABELS[t.tipo] ?? t.tipo}</p>
                      <p className="text-xs text-muted-foreground">
                        {typeof payload.resumo === 'string' ? payload.resumo : '—'}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatarDataHora(t.criado_em)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Notas ({formatarInteiro(notas.length)})
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {notas.map((n) => (
            <NotaCard key={n.access_key} nota={n} minimoOperavel={7} />
          ))}
        </div>
      </section>
    </div>
  )
}
