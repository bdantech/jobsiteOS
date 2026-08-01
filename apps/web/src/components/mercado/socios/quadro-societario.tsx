'use client'

import { useQuery } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDataISO, formatDocumentoSocio, VAZIO } from '@/components/mercado/explorador/format'
import { buscarSocios, mercadoKeys } from '@/components/mercado/explorador/queries'

/**
 * O quadro societário (QSA da Receita), compartilhado pela ficha do universo e pela
 * Company 360.
 *
 * Vive num arquivo próprio porque agora tem dois donos. Copiar a tabela para a segunda
 * tela criaria duas verdades sobre a mesma pergunta — e a segunda cópia é sempre a que
 * envelhece.
 *
 * A RLS de `mercado_socios` (migração 0076) deixa ler quem tem `mercado` OU quem tem
 * `empresas` E a empresa está no CRM. Uma empresa fora do dump da Receita simplesmente
 * não tem QSA, e o estado vazio diz isso — em vez de deixar a tabela em branco parecendo
 * que a consulta falhou.
 */
export function QuadroSocietario({ cnpj }: { cnpj: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: mercadoKeys.socios(cnpj),
    queryFn: () => buscarSocios(cnpj),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
          Quadro societário
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">Não foi possível carregar os sócios.</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum sócio no dump da Receita para este CNPJ.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sócio</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Qualificação</TableHead>
                  <TableHead>Entrada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((socio) => (
                  <TableRow key={socio.id}>
                    <TableCell className="font-medium">
                      {socio.nome_socio ?? VAZIO}
                      {socio.tipo_socio && (
                        <span className="ml-2 text-xs text-muted-foreground">{socio.tipo_socio}</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {formatDocumentoSocio(socio.cpf_cnpj_socio)}
                    </TableCell>
                    <TableCell>{socio.qualificacao ?? VAZIO}</TableCell>
                    <TableCell className="tabular-nums">{formatDataISO(socio.data_entrada)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
