'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Loader2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import {
  CAMPOS_IMPORTACAO,
  CAMPO_IMPORTACAO_LABELS,
  ehCampoMetrica,
  formatCnpj,
  type AnosColunas,
  type CampoImportacao,
  type MapeamentoImportacao,
} from '@jobsiteos/core'
import { salvarMapeamentoAction } from '@/actions/mercado-importacao'
import { STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { extrairLinha, IGNORAR, sugerirAnos, validarMapeamento, type LinhaExtraida } from './mapeamento'
import { formatMrrErp } from './format'
import { importadorKeys } from './queries'

/**
 * O mapeamento de colunas (§5.5).
 *
 * O palpite automático (`sugerirMapeamento`, calculado no servidor) chega pronto,
 * mas nunca é a palavra final: um mapeamento errado aceito em silêncio grava o
 * MRR do ERP na coluna de usuários em milhares de empresas. Por isso a PRÉVIA —
 * as mesmas funções puras que o servidor usará para aplicar (`extrairLinha`)
 * rodam aqui, ao vivo, sobre as primeiras linhas do arquivo. O que a tela mostra
 * é literalmente o que vai ser gravado.
 */

interface MapeamentoFormProps {
  importacaoId: string
  cabecalhos: string[]
  amostra: Record<string, string>[]
  sugestao: MapeamentoImportacao
}

/** Uma coluna da tabela de prévia. Métrica rende uma por ANO; o resto, uma por campo. */
interface ColunaPrevia {
  chave: string
  titulo: string
  valor: (extraida: LinhaExtraida) => string
}

const moeda = (v: number): string =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/** Ordem das colunas na prévia — a leitura de negócio, não a da planilha. */
const CAMPOS_PREVIA: CampoImportacao[] = [...CAMPOS_IMPORTACAO]

function valorDaPrevia(
  campo: CampoImportacao,
  extraida: ReturnType<typeof extrairLinha>,
): string {
  switch (campo) {
    case 'cnpj':
      return extraida.cnpj
        ? formatCnpj(extraida.cnpj)
        : extraida.cnpj_bruto
          ? `${extraida.cnpj_bruto} (inválido)`
          : '—'
    case 'razao_social':
      return extraida.razao_social ?? '—'
    case 'nome_fantasia':
      return extraida.nome_fantasia ?? '—'
    case 'uf':
      return extraida.uf ?? '—'
    case 'municipio':
      return extraida.municipio ?? '—'
    case 'erp_atual':
      return extraida.erp_atual ?? '—'
    case 'erp_mrr':
      return formatMrrErp(extraida.erp_mrr)
    case 'erp_detalhes.qtd_usuarios':
      return extraida.erp_detalhes.qtd_usuarios?.toString() ?? '—'
    case 'erp_detalhes.usuarios_ativos':
      return extraida.erp_detalhes.usuarios_ativos?.toString() ?? '—'
    case 'erp_detalhes.qtd_sistemas':
      return extraida.erp_detalhes.qtd_sistemas?.toString() ?? '—'
    case 'erp_detalhes.canal':
      return extraida.erp_detalhes.canal ?? '—'
    case 'erp_detalhes.modalidade':
      return extraida.erp_detalhes.modalidade ?? '—'
    case 'churn_erp_concorrente':
      return extraida.churn_erp_concorrente === null
        ? '—'
        : extraida.churn_erp_concorrente
          ? 'Sim'
          : 'Não'
    case 'contato.nome':
      return extraida.contato?.nome ?? '—'
    case 'contato.email':
      return extraida.contato?.email ?? '—'
    case 'contato.telefone':
      return extraida.contato?.telefone ?? '—'
    case 'contato.cargo':
      return extraida.contato?.cargo ?? '—'
    // Os de série não passam por aqui: a prévia deles é por coluna/ano (ver
    // `colunasPrevia`), porque "Faturamento" sem o ano ao lado não diz nada.
    case 'faturamento_anual':
    case 'funcionarios':
    case 'patrimonio_liquido':
      return '—'
  }
}

export function MapeamentoForm({
  importacaoId,
  cabecalhos,
  amostra,
  sugestao,
}: MapeamentoFormProps) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [mapeamento, setMapeamento] = React.useState<MapeamentoImportacao>(sugestao)
  // O ano detectado no cabeçalho de cada coluna de métrica. É palpite como o resto:
  // fica editável ao lado do campo, e sem ele a importação não avança.
  const [anos, setAnos] = React.useState<AnosColunas>(() => sugerirAnos(sugestao))
  const [salvando, setSalvando] = React.useState(false)

  const problema = validarMapeamento(mapeamento, anos)

  const camposUsados = React.useMemo(() => {
    const contagem = new Map<CampoImportacao, number>()
    for (const campo of Object.values(mapeamento)) {
      if (campo) contagem.set(campo, (contagem.get(campo) ?? 0) + 1)
    }
    return contagem
  }, [mapeamento])

  // Métrica repetida NÃO é duplicata: são anos diferentes da mesma série, e o
  // conflito de verdade (mesma métrica no mesmo ano) já é barrado por validarMapeamento.
  const duplicados = [...camposUsados.entries()]
    .filter(([campo, n]) => n > 1 && !ehCampoMetrica(campo))
    .map(([campo]) => campo)

  const linhasPrevia = React.useMemo(
    () => amostra.map((linha) => extrairLinha(linha, mapeamento, anos)),
    [amostra, mapeamento, anos],
  )

  // Só as colunas mapeadas entram na prévia: 40 colunas de planilha em uma tabela
  // de 20 campos canônicos não é prévia, é ruído.
  const colunasPrevia = React.useMemo<ColunaPrevia[]>(() => {
    const simples: ColunaPrevia[] = CAMPOS_PREVIA.filter(
      (campo) => camposUsados.has(campo) && !ehCampoMetrica(campo),
    ).map((campo) => ({
      chave: campo,
      titulo: CAMPO_IMPORTACAO_LABELS[campo],
      valor: (extraida) => valorDaPrevia(campo, extraida),
    }))

    const series: ColunaPrevia[] = Object.entries(mapeamento)
      .filter(([, campo]) => ehCampoMetrica(campo))
      .map(([coluna, campo]) => {
        const ano = anos[coluna]
        const rotulo = CAMPO_IMPORTACAO_LABELS[campo as CampoImportacao].replace(' (por ano)', '')

        return {
          chave: coluna,
          titulo: ano ? `${rotulo} ${ano}` : rotulo,
          valor: (extraida) => {
            const leitura = extraida.metricas.find((m) => m.coluna === coluna)
            if (!leitura) return '—'
            return leitura.metrica === 'funcionarios'
              ? leitura.valor.toLocaleString('pt-BR')
              : moeda(leitura.valor)
          },
        }
      })

    return [...simples, ...series]
  }, [camposUsados, mapeamento, anos])

  async function salvar() {
    if (problema || salvando) return

    setSalvando(true)
    try {
      const resultado = await salvarMapeamentoAction({
        importacao_id: importacaoId,
        mapeamento,
        anos_colunas: anos,
      })

      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }

      const { total, resolvidas, ambiguas, ignoradas, buscaTruncada } = resultado.data

      toast.success(`${total.toLocaleString('pt-BR')} linhas processadas.`, {
        description: `${resolvidas.toLocaleString('pt-BR')} com CNPJ, ${ambiguas.toLocaleString('pt-BR')} para revisar, ${ignoradas.toLocaleString('pt-BR')} duplicadas.`,
      })

      if (buscaTruncada) {
        toast.warning('Muitas linhas sem CNPJ: parte delas ficou sem candidatos sugeridos.', {
          description: 'Você ainda pode informar o CNPJ manualmente na fila de resolução.',
        })
      }

      await queryClient.invalidateQueries({ queryKey: importadorKeys.all })
      router.refresh()
    } catch (erro) {
      console.error('[importador] falha ao salvar o mapeamento', erro)
      toast.error('Não foi possível processar a planilha.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Mapeie as colunas</CardTitle>
          <CardDescription>
            Para cada coluna da planilha, escolha o campo correspondente — ou ignore. O palpite
            abaixo veio dos nomes das colunas; confira antes de continuar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cabecalhos.map((cabecalho) => {
              const atual = mapeamento[cabecalho] ?? null
              const exemplo = amostra.find((linha) => (linha[cabecalho] ?? '').trim() !== '')?.[
                cabecalho
              ]

              return (
                <div key={cabecalho} className="space-y-1.5 rounded-md border p-3">
                  <p className="truncate text-sm font-medium" title={cabecalho}>
                    {cabecalho}
                  </p>
                  <p className="h-4 truncate text-xs text-muted-foreground" title={exemplo}>
                    {exemplo ? `Ex.: ${exemplo}` : 'Sem exemplo nas primeiras linhas'}
                  </p>
                  <Select
                    value={atual ?? IGNORAR}
                    onValueChange={(valor) =>
                      setMapeamento((anterior) => ({
                        ...anterior,
                        [cabecalho]: valor === IGNORAR ? null : (valor as CampoImportacao),
                      }))
                    }
                  >
                    <SelectTrigger aria-label={`Campo para a coluna ${cabecalho}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={IGNORAR}>Ignorar esta coluna</SelectItem>
                      {CAMPOS_IMPORTACAO.map((campo) => (
                        <SelectItem key={campo} value={campo}>
                          {CAMPO_IMPORTACAO_LABELS[campo]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Faturamento, funcionários e PL valem para um ANO. O palpite vem do
                      cabeçalho ("Receita Bruta 2023" → 2023) e fica aqui para conferir:
                      um ano errado desloca a série inteira, e isso só apareceria meses
                      depois, numa variação 12m absurda. */}
                  {ehCampoMetrica(atual) && (
                    <div className="flex items-center gap-2 pt-1">
                      <label
                        className="text-xs text-muted-foreground"
                        htmlFor={`ano-${cabecalho}`}
                      >
                        Ano
                      </label>
                      <Input
                        id={`ano-${cabecalho}`}
                        inputMode="numeric"
                        placeholder="2024"
                        className="h-8 w-24"
                        value={anos[cabecalho]?.toString() ?? ''}
                        onChange={(e) => {
                          const bruto = e.target.value.replace(/\D/g, '').slice(0, 4)
                          setAnos((anterior) => {
                            const proximo = { ...anterior }
                            const ano = Number(bruto)
                            if (bruto.length === 4 && ano >= 2000 && ano <= 2100) {
                              proximo[cabecalho] = ano
                            } else {
                              delete proximo[cabecalho]
                            }
                            return proximo
                          })
                        }}
                      />
                      {!anos[cabecalho] && (
                        <span className="text-xs text-destructive">obrigatório</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {duplicados.length > 0 && (
            <p
              className={cn(
                'flex items-start gap-2 rounded-md border p-3 text-sm',
                STATUS_SUPERFICIE.warning,
              )}
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Mais de uma coluna aponta para{' '}
                {duplicados.map((campo) => CAMPO_IMPORTACAO_LABELS[campo]).join(', ')}. A primeira
                coluna não vazia vence — se não era isso que você queria, ajuste.
              </span>
            </p>
          )}

          {problema && (
            <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{problema}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prévia</CardTitle>
          <CardDescription>
            As primeiras {amostra.length} linhas do arquivo, já convertidas. É exatamente isto que
            vai para a base.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {colunasPrevia.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma coluna mapeada ainda.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {colunasPrevia.map((coluna) => (
                      <TableHead key={coluna.chave} className="whitespace-nowrap">
                        {coluna.titulo}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhasPrevia.map((extraida, indice) => (
                    <TableRow key={indice}>
                      {colunasPrevia.map((coluna) => (
                        <TableCell key={coluna.chave} className="whitespace-nowrap text-sm">
                          {coluna.valor(extraida)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => void salvar()} disabled={Boolean(problema) || salvando}>
          {salvando ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <ArrowRight className="mr-2 h-4 w-4" aria-hidden />
          )}
          {salvando ? 'Processando…' : 'Processar planilha'}
        </Button>
      </div>
    </div>
  )
}
