import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { canAccessRoute, mapeamentoImportacaoSchema, type Tables } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ImportacaoDetalhe } from '@/components/mercado/importador/importacao-detalhe'
import { MapeamentoForm } from '@/components/mercado/importador/mapeamento-form'
import { sugerirMapeamento } from '@/components/mercado/importador/mapeamento'
import { lerPlanilha } from '@/lib/mercado/importador/planilha'
import { baixarArquivo } from '@/lib/mercado/importador/storage'

export const metadata: Metadata = {
  title: 'Importação — Mercado',
}

/** Quantas linhas do arquivo aparecem na prévia do mapeamento. */
const LINHAS_DA_PREVIA = 5

function ErroDoArquivo({ mensagem }: { mensagem: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <div className="rounded-full bg-destructive/10 p-3">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="text-lg font-medium">Não foi possível ler a planilha</p>
          <p className="max-w-md text-sm text-muted-foreground">{mensagem}</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/mercado/importacoes">Voltar para as importações</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

/**
 * A importação, em duas telas conforme o estado dela:
 *
 *   `mapeando` (ou mapeamento inválido) → o formulário de colunas. O arquivo é
 *      lido AQUI, no servidor, a cada render: os cabeçalhos e a amostra não têm
 *      coluna própria em `importacoes_listas`, e duplicá-los em algum lugar seria
 *      criar uma segunda verdade sobre o mesmo arquivo. A leitura passa pelo
 *      Storage privado (client de serviço, ver lib/mercado/importador/storage.ts),
 *      DEPOIS de a sessão e o módulo já terem sido verificados.
 *
 *   qualquer outro → os contadores, a fila de resolução e o botão de aplicar.
 */
export default async function ImportacaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute('/mercado', grantedModuleIds)) redirect('/sem-acesso')

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('importacoes_listas')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  // RLS devolve zero linhas para quem não tem o módulo, e a guarda acima já
  // tratou esse caso — aqui, ausência é ausência de verdade.
  if (error) throw new Error(error.message)
  if (!data) notFound()

  const importacao: Tables<'importacoes_listas'> = data
  const mapeamento = mapeamentoImportacaoSchema.safeParse(importacao.mapeamento)

  const precisaMapear = importacao.status === 'mapeando' || !mapeamento.success

  if (precisaMapear) {
    if (!importacao.arquivo_url) {
      return <ErroDoArquivo mensagem="Esta importação não tem arquivo associado." />
    }

    try {
      const buffer = await baixarArquivo(importacao.arquivo_url)
      const planilha = lerPlanilha(buffer, importacao.arquivo_url)

      return (
        <div className="space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{importacao.nome}</h1>
            <p className="text-sm text-muted-foreground">
              {planilha.linhas.length.toLocaleString('pt-BR')} linhas,{' '}
              {planilha.cabecalhos.length} colunas. Nada foi gravado ainda.
            </p>
          </div>

          <MapeamentoForm
            importacaoId={importacao.id}
            cabecalhos={planilha.cabecalhos}
            amostra={planilha.linhas.slice(0, LINHAS_DA_PREVIA)}
            sugestao={sugerirMapeamento(planilha.cabecalhos)}
          />
        </div>
      )
    } catch (erro) {
      const mensagem =
        erro instanceof Error ? erro.message : 'Erro desconhecido ao abrir o arquivo.'
      return <ErroDoArquivo mensagem={mensagem} />
    }
  }

  return <ImportacaoDetalhe importacao={importacao} mapeamento={mapeamento.data} />
}
