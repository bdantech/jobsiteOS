/**
 * O TEXTO QUE VAI AOS MODELOS, por tipo de interação. Os três chegam ao classificador no
 * mesmo formato — "Quem: fala", uma por linha — para que a mesma pergunta da rubrica leia
 * igual numa reunião, numa ligação e numa conversa de WhatsApp.
 */

export interface MensagemJanela {
  direcao: 'entrada' | 'saida'
  canal: string
  corpo: string | null
  assunto: string | null
  criado_em: string
  por_ia: boolean
  autor: string | null
}

/**
 * Janela de conversa: a data entra em cada linha porque "o retorno aconteceu no prazo
 * combinado?" só se responde vendo quando cada mensagem saiu.
 */
export function estadoDaJanela(msgs: readonly MensagemJanela[], nomeCliente: string | null): string {
  const cliente = nomeCliente?.trim() || 'Cliente'
  return msgs
    .filter((m) => (m.corpo ?? m.assunto ?? '').trim())
    .map((m) => {
      const quando = new Date(m.criado_em).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      const quem = m.direcao === 'entrada' ? cliente : `Vendedor${m.por_ia ? ' (IA)' : ''}${m.autor ? ` — ${m.autor}` : ''}`
      const texto = [m.assunto ? `[${m.assunto}]` : null, (m.corpo ?? '').trim()].filter(Boolean).join(' ')
      return `[${quando}] ${quem}: ${texto.replace(/\s+/g, ' ')}`
    })
    .join('\n')
}

/**
 * Ligação da Ana: `voz_ligacoes.transcricao` é um array de turnos cujo formato é do
 * fornecedor (`{quem, texto}` hoje; `{role, content}` ou `{speaker, text}` em outras
 * versões). Lê o que houver, e ignora turno sem texto.
 */
export function estadoDaLigacao(transcricao: unknown): string {
  if (!Array.isArray(transcricao)) return ''
  return transcricao
    .map((t) => {
      if (!t || typeof t !== 'object') return null
      const o = t as Record<string, unknown>
      const texto = String(o.texto ?? o.text ?? o.content ?? o.message ?? '').trim()
      if (!texto) return null
      const quem = String(o.quem ?? o.speaker ?? o.role ?? '').toLowerCase()
      const rotulo = /ana|agent|assistant|bot|ia/.test(quem) ? 'Vendedor (IA)' : 'Cliente'
      return `${rotulo}: ${texto}`
    })
    .filter(Boolean)
    .join('\n')
}

export interface Janela {
  inicio: string
  fim: string
  mensagens: number
}

/**
 * Fecha a janela de uma conversa: tudo desde o fim da última analisada. Conversa parada
 * (nada novo) não gera janela; conversa com pouca troca também não; e conversa que ainda
 * está acontecendo espera — julgar no meio do diálogo é cobrar o que ainda vai ser feito.
 */
export function fecharJanela(a: {
  mensagensDesde: ReadonlyArray<{ criado_em: string }>
  ultimaJanelaFim: string | null
  agora: Date
  minMensagens: number
  horasSilencio: number
}): Janela | null {
  const corte = a.ultimaJanelaFim ? new Date(a.ultimaJanelaFim).getTime() : -Infinity
  const ms = (s: string) => new Date(s).getTime()
  const novas = a.mensagensDesde.filter((m) => ms(m.criado_em) > corte).sort((x, y) => ms(x.criado_em) - ms(y.criado_em))
  if (novas.length < a.minMensagens) return null
  const ultima = novas.at(-1)!.criado_em
  if (a.agora.getTime() - new Date(ultima).getTime() < a.horasSilencio * 3_600_000) return null
  return { inicio: a.ultimaJanelaFim ?? novas[0]!.criado_em, fim: ultima, mensagens: novas.length }
}
