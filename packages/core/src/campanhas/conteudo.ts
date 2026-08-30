/**
 * O QUE UMA MENSAGEM DE CAMPANHA NÃO DIZ (§7).
 *
 * A mesma regra do Agente (05A): nada de taxa, limite ou valor de operação. O
 * motivo não é jurídico e sim comercial — número em disparo em massa vira
 * expectativa, e expectativa criada por um robô é negociada depois por uma
 * pessoa que não estava lá quando o número foi dito.
 *
 * ─── AVISO, NÃO BLOQUEIO ────────────────────────────────────────────────────
 * A validação AVISA. Bloquear seria pior: "R$" aparece legitimamente em
 * "sem custo de R$ 0" e em nome de produto, e um bloqueio que erra 10% das vezes
 * ensina a contorná-lo escrevendo "reais" por extenso — que é o mesmo problema
 * com uma camada de disfarce. Quem escreve vê o aviso, olha, e decide.
 */

export type TipoTermoProibido = 'taxa' | 'limite' | 'valor'

export interface AchadoNoTexto {
  tipo: TipoTermoProibido
  trecho: string
  /** Índice no texto original — a tela sublinha exatamente ali. */
  posicao: number
}

interface Regra {
  tipo: TipoTermoProibido
  re: RegExp
}

const REGRAS: readonly Regra[] = [
  // Percentual junto de palavra de preço, ou percentual solto com casa decimal:
  // "1,29% a.m." é o caso que importa, "100% dos clientes" não é.
  { tipo: 'taxa', re: /\b\d+[.,]?\d*\s*%\s*(a\.?\s*m\.?|ao\s+m[êe]s|a\.?\s*a\.?|ao\s+ano)/gi },
  { tipo: 'taxa', re: /\b(taxa|juros?|spread|deságio|desagio)\s+(de|a partir de)\s+\d/gi },
  // Dinheiro escrito como dinheiro.
  { tipo: 'valor', re: /R\$\s*\d/gi },
  { tipo: 'valor', re: /\b\d+([.,]\d+)?\s*(mil|milh[õo]es|milh[ãa]o)\s+(de\s+)?reais\b/gi },
  // Limite prometido com número junto.
  { tipo: 'limite', re: /\b(limite|cr[ée]dito\s+(de|at[ée])|at[ée])\s+(de\s+)?R?\$?\s*\d/gi },
]

export function termosProibidos(texto: string): AchadoNoTexto[] {
  const achados: AchadoNoTexto[] = []
  for (const r of REGRAS) {
    // `lastIndex` zerado a cada uso: uma RegExp global é stateful, e reaproveitar
    // a mesma instância entre chamadas faz a segunda análise pular o começo do
    // texto — um bug que só aparece na segunda mensagem.
    r.re.lastIndex = 0
    for (const m of texto.matchAll(r.re)) {
      achados.push({ tipo: r.tipo, trecho: m[0], posicao: m.index ?? 0 })
    }
  }
  return achados.sort((a, b) => a.posicao - b.posicao)
}

export const TERMO_PROIBIDO_AVISOS: Record<TipoTermoProibido, string> = {
  taxa: 'Isto parece uma taxa. Taxa em disparo vira expectativa que outra pessoa negocia depois.',
  limite: 'Isto parece um limite prometido. O limite sai da análise, não da mensagem.',
  valor: 'Isto parece um valor de operação. Número em massa é promessa em massa.',
}

/**
 * O texto pede link de descadastro? A resposta vem do 05A (`exigeDescadastro`),
 * e aqui só checamos que o autor não tentou escrevê-lo à mão — o link é anexado
 * pelo código com o token do destinatário, e um link fixo no template
 * descadastraria a pessoa errada.
 */
export function temDescadastroNoCorpo(texto: string): boolean {
  return /descadastr|unsubscribe|sair da lista|cancelar\s+inscri/i.test(texto)
}
