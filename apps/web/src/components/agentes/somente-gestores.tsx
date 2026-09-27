'use client'

import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldAlert } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarSouGestorAgentes, gestaoAgentesKeys } from './queries-gestao'

/**
 * A porta das telas de gestão dos Agentes (§11: Personas, Materiais, Desempenho e
 * Configurações são SÓ de gestor — Admin ou Comercial).
 *
 * O closer tem o módulo (acompanha os agentes de que é o closer designado) e a rota abre
 * para ele pelo layout. Sem esta porta, ele veria uma tela de personas vazia — porque
 * `email_caixas` e `mandato_regras` não respondem a quem não é gestor — e concluiria que
 * não existe agente nenhum. Um aviso claro é melhor do que uma tela que mente por omissão.
 * A segurança continua nas RPCs e na RLS; isto é só a camada de mensagem.
 */
export function SomenteGestores({ titulo, children }: { titulo: string; children: ReactNode }) {
  const gestor = useQuery({ queryKey: gestaoAgentesKeys.gestor(), queryFn: buscarSouGestorAgentes })

  if (gestor.isPending) return <Skeleton className="h-64 w-full" />

  if (gestor.data !== true) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
        <div className="rounded-full bg-muted p-3">
          <ShieldAlert className="h-6 w-6 text-muted-foreground" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="font-medium">Somente a gestão comercial</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {titulo} é configurado pela gestão comercial (perfis Admin e Comercial). Você continua
            acompanhando os agentes de que é closer em Ao vivo e Mandatos.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
