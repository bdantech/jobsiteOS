'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { buscarEficacia, fornecedoresKeys } from './queries'
import { brlExato, rotuloFonte } from './formato'

/**
 * Aprendizado de fontes (04l §6).
 *
 * A pergunta que esta tabela responde não é "qual fonte acha mais contato" — é "qual
 * fonte leva a cadastro, e a que preço". São coisas diferentes e a diferença é cara:
 * o provedor que devolve dez telefones dos quais nenhum atende parece ótimo na
 * primeira coluna.
 *
 * A atribuição é o ÚLTIMO TOQUE antes de o fornecedor virar cliente: o contato com
 * que a pessoa efetivamente falou. Não é o mais recente nem o de maior confiança.
 *
 * `custo por cadastro` fica NULO enquanto não houver cadastro atribuído, e isso é
 * deliberado — um zero ali leria como "sai de graça", que é o oposto de "ainda não
 * sabemos".
 */
export function EficaciaFontes() {
  const dados = useQuery({
    queryKey: fornecedoresKeys.eficacia(),
    queryFn: buscarEficacia,
  })

  if (dados.isPending) return <Skeleton className="h-64 w-full" />
  if (dados.isError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          {(dados.error as Error).message}
        </CardContent>
      </Card>
    )
  }

  const linhas = dados.data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Eficácia por fonte</CardTitle>
        <CardDescription>
          Em três meses isto reordena a cascata com evidência — e permite desligar provedor que
          não paga. Contato inválido não é apagado: ele é rebaixado, e continua contando aqui
          contra a fonte que o trouxe.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {linhas.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            Nenhuma execução ainda. A tabela se preenche a partir da primeira rodada da
            descoberta automática.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fonte</TableHead>
                <TableHead className="text-right">Contatos</TableHead>
                <TableHead className="text-right">% válidos</TableHead>
                <TableHead className="text-right">Promovidos</TableHead>
                <TableHead className="text-right">Execuções</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Cadastros</TableHead>
                <TableHead className="text-right">Custo/cadastro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.fonte}>
                  <TableCell className="font-medium">{rotuloFonte(l.fonte)}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.contatos_encontrados}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {/* Sobre os TESTADOS, não sobre o total: um contato ainda não
                        validado não é um contato inválido, e diluí-lo no denominador
                        faria toda fonte nova parecer ruim no primeiro dia. */}
                    {l.contatos_testados > 0
                      ? `${Math.round((l.contatos_validos / l.contatos_testados) * 100)}%`
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{l.contatos_promovidos}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.execucoes}
                    {l.execucoes > 0 ? (
                      <span className="text-muted-foreground"> ({l.acertos} com dado)</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{brlExato(l.custo_total)}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.cadastros}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.custo_por_cadastro === null ? (
                      <span className="text-muted-foreground">sem dado</span>
                    ) : (
                      brlExato(l.custo_por_cadastro)
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
