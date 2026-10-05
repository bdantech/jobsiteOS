'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRight, Check, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { decidirSugestaoCadastroAction } from '@/actions/qualidade'
import { empresasKeys } from '@/components/empresas/queries'
import { AnaliseModal } from './analise-modal'
import { buscarSugestoesCadastro, qualidadeKeys } from './queries'

/**
 * SUGESTÕES DE CADASTRO (05C §11) — o que a análise das conversas achou DIFERENTE do que
 * está cadastrado.
 *
 * O que é aditivo (contato novo, telefone novo, cargo vazio) o sistema já gravou sozinho.
 * Isto aqui é o resto: campo preenchido com valor diferente. Sobrescrever sem perguntar
 * seria deixar uma frase mal transcrita apagar um cadastro bom — então vira proposta, com
 * o valor de hoje ao lado do sugerido, e alguém decide.
 *
 * Some quando não há sugestão: uma caixa vazia em toda empresa seria ruído.
 */

const CAMPO_LABELS: Record<string, string> = {
  nome: 'Nome',
  cargo: 'Cargo',
  email: 'E-mail',
  telefone: 'Telefone',
}

export function SugestoesCadastro({ empresaId }: { empresaId: string }) {
  const qc = useQueryClient()
  const [ocupada, setOcupada] = React.useState<string | null>(null)
  const [analise, setAnalise] = React.useState<string | null>(null)
  const consulta = useQuery({
    queryKey: qualidadeKeys.sugestoes(empresaId),
    queryFn: () => buscarSugestoesCadastro(empresaId),
  })

  const lista = consulta.data ?? []
  if (lista.length === 0) return null

  async function decidir(id: string, aceitar: boolean) {
    setOcupada(id)
    const r = await decidirSugestaoCadastroAction({ id, aceitar })
    setOcupada(null)
    if (!r.ok) return void toast.error(r.message)
    toast.success(aceitar ? 'Cadastro atualizado.' : 'Sugestão recusada.')
    await qc.invalidateQueries({ queryKey: qualidadeKeys.sugestoes(empresaId) })
    // Aceitar muda o contato: a aba Contatos e a ficha precisam reler.
    if (aceitar) {
      await qc.invalidateQueries({ queryKey: empresasKeys.contatos(empresaId) })
      await qc.invalidateQueries({ queryKey: empresasKeys.detalhe(empresaId) })
    }
  }

  return (
    <section className="space-y-2 rounded-lg border border-border bg-card p-4">
      <header className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold">Sugestões de cadastro</h3>
          <p className="text-xs text-muted-foreground">
            A análise das conversas encontrou dados diferentes dos cadastrados. Nada foi
            sobrescrito: aceite o que estiver certo.
          </p>
        </div>
      </header>
      <ul className="divide-y divide-border">
        {lista.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 text-sm">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-xs text-muted-foreground">
                {CAMPO_LABELS[s.campo] ?? s.campo}
                {s.contato_nome ? ` de ${s.contato_nome}` : ''}
                {s.analise_id ? (
                  <>
                    {' · '}
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-foreground"
                      onClick={() => setAnalise(s.analise_id)}
                    >
                      de onde veio
                    </button>
                  </>
                ) : null}
              </p>
              <p className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground line-through decoration-muted-foreground/50">
                  {s.valor_atual || '(vazio)'}
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" aria-label="passaria a ser" />
                <span className="font-medium">{s.valor_sugerido}</span>
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" className="h-7" disabled={ocupada === s.id} onClick={() => void decidir(s.id, true)}>
                <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
                Aceitar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                disabled={ocupada === s.id}
                onClick={() => void decidir(s.id, false)}
              >
                <X className="mr-1 h-3.5 w-3.5" aria-hidden />
                Recusar
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {analise ? <AnaliseModal analiseId={analise} aberto onOpenChange={(a) => !a && setAnalise(null)} /> : null}
    </section>
  )
}
