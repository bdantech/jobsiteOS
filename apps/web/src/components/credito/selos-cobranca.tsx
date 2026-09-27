'use client'

import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { useEmCobranca } from '@/hooks/use-em-cobranca'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

/**
 * Os dois selos que a Cobrança põe no crédito (07 §11).
 *
 * VERMELHO — o grupo está em cobrança extrajudicial: a esteira recusa análise nova (é
 * trigger no banco, 0269f) e o limite vigente está suspenso. O selo fica onde o limite
 * aparece porque é ali que alguém leria o número e ofereceria operação em cima dele.
 *
 * ÂMBAR — o grupo já foi regularizado, mas o limite NÃO voltou sozinho (§11 item 5):
 * espera uma análise nova decidida por gente. Quem já não pagou uma vez merece uma
 * segunda olhada, e o selo é o lembrete de que ela ainda não aconteceu.
 */
export function SeloEmCobranca({ className }: { className?: string }) {
  return (
    <Badge
      variant="critical"
      className={cn('text-[11px]', className)}
      title="O grupo está em cobrança extrajudicial. Novas análises e o limite vigente ficam suspensos até a regularização."
    >
      Em cobrança — análises suspensas
    </Badge>
  )
}

export function SeloRevisaoPosInadimplencia({ className }: { className?: string }) {
  return (
    <Badge
      variant="warning"
      className={cn('text-[11px]', className)}
      title="O grupo foi regularizado depois de uma cobrança. O limite só volta com uma análise nova decidida na esteira."
    >
      Limite em revisão pós-inadimplência
    </Badge>
  )
}

/** Os dois, na ordem de gravidade; nada quando nenhum se aplica. */
export function SelosCobrancaCredito({
  bloqueio,
  revisao,
  className,
}: {
  bloqueio: boolean | null | undefined
  revisao: boolean | null | undefined
  className?: string
}) {
  if (!bloqueio && !revisao) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {bloqueio ? <SeloEmCobranca /> : null}
      {/* Os dois juntos seria contradição: a revisão nasce da regularização. */}
      {revisao && !bloqueio ? <SeloRevisaoPosInadimplencia /> : null}
    </div>
  )
}

/**
 * Os selos na ficha de uma ANÁLISE, onde a empresa pode nem existir (análise por CNPJ
 * importada da apólice). O bloqueio vem da lista de CNPJs — que pega a SPE pelo grupo —
 * e a revisão, que só existe em `empresas`, da linha quando há.
 */
export function SelosCobrancaDaAnalise({ cnpj, empresaId }: { cnpj: string; empresaId: string | null }) {
  const { emCobranca } = useEmCobranca()
  const empresa = useQuery({
    queryKey: ['cobranca', 'selos-credito', empresaId],
    enabled: empresaId !== null,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('empresas')
        .select('bloqueio_cobranca, credito_revisao_pos_inadimplencia')
        .eq('id', empresaId as string)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data
    },
  })
  return (
    <SelosCobrancaCredito
      bloqueio={emCobranca(cnpj) || empresa.data?.bloqueio_cobranca === true}
      revisao={empresa.data?.credito_revisao_pos_inadimplencia === true}
    />
  )
}
