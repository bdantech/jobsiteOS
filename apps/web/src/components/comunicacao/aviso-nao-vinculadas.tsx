'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Link2Off, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { contarNaoVinculadas } from './queries'
import { useEscopoFila } from './use-escopo-fila'

/**
 * A fila de identificação, destacada AO LOGAR e ao voltar depois de um tempo
 * fora (§4).
 *
 * ── POR QUE ELA MORA NA CASCA, E NÃO NUMA HOME ─────────────────────────────
 * O sistema não tem home: quem entra cai no primeiro módulo liberado. Uma
 * mensagem de um decisor que ninguém identificou é a forma mais barata de perder
 * um negócio, e ela não pode depender de a pessoa abrir a tela certa.
 *
 * ── O CONTADOR MUDOU DE LUGAR ──────────────────────────────────────────────
 * Havia um ícone com badge ao lado do sino, na barra do topo, e ele competia com
 * as notificações sem ser uma delas: dois contadores lado a lado, de coisas
 * diferentes, é como se ensina a não olhar nenhum dos dois. O contador agora fica
 * colado em "Não vinculadas", no menu da Comunicação — onde o número e o destino
 * do clique são a mesma coisa.
 *
 * O que sobra aqui é o ALERTA, que é outro problema: ele existe para alcançar
 * quem NÃO está na Comunicação — quem passa o dia no Comercial, em qualquer aba
 * dele, e nunca abre a fila.
 *
 * ── ELE VOLTA DE DUAS EM DUAS HORAS ────────────────────────────────────────
 * Antes ele aparecia uma vez por sessão, e de novo só se a pessoa voltasse depois
 * de um tempo fora maior que a inatividade configurada (4h). Quem deixa a aba
 * aberta a manhã inteira — que é como esta equipe trabalha — via o alerta uma vez,
 * fechava, e nunca mais. Hoje há 82 conversas esperando o Rodrigo e 46 esperando o
 * Fabio; uma mensagem de um decisor que ninguém identificou é a forma mais barata
 * de perder um negócio.
 *
 * Duas horas é o teto de insistência, não o intervalo de exibição: o alerta abre
 * quando faz duas horas que ele NÃO aparece, e some assim que a pessoa o fecha ou
 * zera a fila. Fechar continua valendo — o que ele não tem mais é a memória
 * eterna. Um alerta que reaparece a cada render se aprende a ignorar em dois dias;
 * um que aparece três vezes num turno de trabalho é lembrete.
 *
 * ── A MARCA É POR PESSOA E SOBREVIVE AO RELOAD ─────────────────────────────
 * `localStorage`, com o id do vendedor na chave. `sessionStorage` reiniciaria a
 * contagem a cada recarga de página, e quem recarrega de dez em dez minutos veria
 * o alerta de dez em dez minutos. O id na chave é o que impede o alerta de sumir
 * para o gestor porque ele já tinha aparecido no escopo de outra pessoa.
 */

/** Duas horas entre uma aparição e a próxima. */
const INTERVALO_AVISO_MS = 2 * 60 * 60 * 1000

/*
 * De minuto em minuto a tela pergunta se já deu a hora. É barato (uma comparação de
 * números, sem rede) e é o que faz o alerta alcançar quem não sai da mesma aba: um
 * `setTimeout` de duas horas morreria na primeira navegação que desmontasse o componente.
 */
const PASSO_VERIFICACAO_MS = 60_000

function chaveDoAviso(vendedorId: string | null): string {
  return `jobsiteos.comunicacao.ultimo-aviso.${vendedorId ?? 'sem-vendedor'}`
}

function agoraMs(): number {
  return Date.now()
}

function lerUltimoAviso(vendedorId: string | null): number | null {
  try {
    const v = window.localStorage.getItem(chaveDoAviso(vendedorId))
    return v ? Number(v) : null
  } catch {
    return null
  }
}

function gravarUltimoAviso(vendedorId: string | null): void {
  try {
    window.localStorage.setItem(chaveDoAviso(vendedorId), String(agoraMs()))
  } catch {
    /* Navegador sem armazenamento: o alerta aparece a cada carga, e tudo bem. */
  }
}

export function AvisoNaoVinculadas({ temModulo }: { temModulo: boolean }) {
  const [alertaAberto, setAlertaAberto] = React.useState(false)

  // Mesmo escopo da lista de identificação: o contador não pode falar de
  // uma fila diferente da que a página abre.
  const escopo = useEscopoFila()

  const contagem = useQuery({
    queryKey: ['comunicacao', 'nao-vinculadas', 'contagem', escopo.vendedorId],
    queryFn: () => contarNaoVinculadas(escopo.vendedorId),
    enabled: temModulo,
    // Volta a perguntar quando a aba ganha foco — o mesmo instante em que o alerta
    // reavalia se já deu a hora. Contador velho abriria um alerta sobre fila já resolvida.
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  })

  const total = contagem.data ?? 0
  const vendedorId = escopo.vendedorId

  /*
   * Um só gatilho, chamado de três jeitos: ao montar, ao voltar o foco para a aba, e de
   * minuto em minuto. Os três perguntam a mesma coisa — já faz duas horas? — e é por isso
   * que não brigam entre si.
   *
   * A MARCA É CARIMBADA QUANDO O ALERTA ABRE, e não quando alguém o fecha. Carimbar no
   * fechamento faria a cadência depender de quanto tempo a pessoa demora a reparar nele:
   * quem fecha na hora veria o próximo em 2h, quem deixa aberto meia hora veria em 2h30.
   * A régua é do sistema, não da atenção de cada um.
   */
  React.useEffect(() => {
    if (!temModulo || total === 0) return

    const talvezAbrir = () => {
      const ultimo = lerUltimoAviso(vendedorId)
      if (ultimo !== null && agoraMs() - ultimo < INTERVALO_AVISO_MS) return
      gravarUltimoAviso(vendedorId)
      setAlertaAberto(true)
    }

    talvezAbrir()
    const relogio = window.setInterval(talvezAbrir, PASSO_VERIFICACAO_MS)
    window.addEventListener('focus', talvezAbrir)
    return () => {
      window.clearInterval(relogio)
      window.removeEventListener('focus', talvezAbrir)
    }
  }, [temModulo, total, vendedorId])

  if (!temModulo || total === 0) return null

  if (!alertaAberto) return null

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto w-[min(32rem,calc(100%-2rem))] rounded-lg border border-amber-500/50 bg-background p-3 shadow-lg">
      <div className="flex items-start gap-3">
        <Link2Off className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {total} conversa{total === 1 ? '' : 's'} aguardando identificação
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Alguém falou com a gente e o sistema não soube quem é.
          </p>
          <Button size="sm" className="mt-2" asChild onClick={() => setAlertaAberto(false)}>
            <Link href="/comunicacao/nao-vinculadas">Identificar agora</Link>
          </Button>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 shrink-0 p-0"
          onClick={() => setAlertaAberto(false)}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">Fechar</span>
        </Button>
      </div>
    </div>
  )
}
