import type { RealtimeChannel } from '@supabase/supabase-js'
import { useEffect, useRef } from 'react'

import { supabase } from '@/lib/supabase'

/**
 * O Ao vivo, ao vivo (09 §11.1): INSERT em `mandato_acoes` pelo Realtime.
 *
 * `mandato_acoes` está na publicação desde a 0270c, e o `postgres_changes` avalia a RLS
 * com o JWT de quem assina — o closer só recebe as ações dos agentes que ele acompanha,
 * as mesmas que a leitura REST devolveria. O payload NÃO é tratado como estado: ele só
 * avisa que algo chegou, e quem ouve invalida a consulta (que passa pela RLS de novo).
 *
 * Um canal só para o app inteiro, com contagem de referências — o desenho do sino
 * (features/notificacoes/queries.ts) e da tarja de beta. O Ao vivo e o detalhe do
 * mandato ouvem ao mesmo tempo quando um está empilhado sobre o outro; dois canais no
 * mesmo tópico entregariam cada linha duas vezes.
 */

export interface AcaoChegou {
  agente_id: string | null
  mandato_id: string | null
  ferramenta: string | null
}

type Ouvinte = (acao: AcaoChegou) => void

const ouvintes = new Set<Ouvinte>()
let canal: RealtimeChannel | null = null

function derrubarCanal(): void {
  if (!canal) return
  void supabase.removeChannel(canal)
  canal = null
}

function garantirCanal(): void {
  if (canal) return
  canal = supabase
    .channel('agentes-acoes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mandato_acoes' }, (payload) => {
      const linha = (payload.new ?? {}) as Partial<AcaoChegou>
      const acao: AcaoChegou = {
        agente_id: linha.agente_id ?? null,
        mandato_id: linha.mandato_id ?? null,
        ferramenta: linha.ferramenta ?? null,
      }
      for (const o of [...ouvintes]) o(acao)
    })
    .subscribe()
}

/**
 * Chama `aoChegar` para cada ação nova — AGRUPADA: um ciclo grava várias linhas em
 * sequência (ler, decidir, enviar, atualizar o plano), e refazer a consulta a cada uma
 * seria cancelar a anterior no meio, quatro vezes seguidas. Uma janela curta junta a
 * rajada numa consulta só.
 *
 * `filtro` decide se a linha interessa (o detalhe só quer as do seu mandato).
 */
export function useAcoesAoVivo(aoChegar: () => void, filtro?: (acao: AcaoChegou) => boolean): void {
  // Refs: a tela passa funções novas a cada render, e reassinar a cada render seria
  // derrubar e reabrir o canal o tempo todo.
  const aoChegarRef = useRef(aoChegar)
  const filtroRef = useRef(filtro)
  aoChegarRef.current = aoChegar
  filtroRef.current = filtro

  useEffect(() => {
    let cancelado = false
    let espera: ReturnType<typeof setTimeout> | null = null

    const ouvinte: Ouvinte = (acao) => {
      if (filtroRef.current && !filtroRef.current(acao)) return
      if (espera) return
      espera = setTimeout(() => {
        espera = null
        aoChegarRef.current()
      }, 1500)
    }
    ouvintes.add(ouvinte)

    // O Realtime avalia a RLS com o JWT da CONEXÃO, não com o do cliente REST: sem o
    // `setAuth` a assinatura conecta e nunca recebe linha nenhuma (ver useBeta).
    void supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token
      if (!token || cancelado) return
      supabase.realtime.setAuth(token)
      garantirCanal()
    })

    return () => {
      cancelado = true
      if (espera) clearTimeout(espera)
      ouvintes.delete(ouvinte)
      if (ouvintes.size === 0) derrubarCanal()
    }
  }, [])
}
