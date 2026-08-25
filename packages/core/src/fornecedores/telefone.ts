/**
 * Telefone brasileiro em E.164 — o normalizador que decide se dois contatos são o
 * mesmo contato.
 *
 * Ele existe porque a deduplicação de `contatos_descobertos` é por (cnpj, tipo,
 * valor), e as seis fontes da cascata escrevem o MESMO número de seis jeitos:
 * `(11) 98765-4321` no XML da NF-e, `11987654321` na Receita, `+55 11 98765-4321` no
 * Google Places, `5511987654321` na Nova Vida. Sem uma forma canônica, o mesmo
 * telefone entra quatro vezes, a `frequencia` (que é o nosso sinal de confiança)
 * nunca passa de 1, e o card mostra quatro linhas que são uma.
 *
 * O NONO DÍGITO é a parte que não dá para pular. Celulares brasileiros ganharam um 9
 * na frente em 2012-2016, e cadastros antigos — que é exatamente o que a Receita tem —
 * guardaram o número sem ele. `1187654321` e `11987654321` são o mesmo aparelho, e
 * tratá-los como dois números faz o sistema ligar duas vezes para a mesma pessoa.
 */

/**
 * Os DDDs que existem. A lista é fechada e não muda desde 2016 — não é heurística,
 * é o Plano de Numeração da Anatel.
 *
 * Validar o DDD é o que separa "telefone" de "número que estava naquele campo".
 * `0300`, CEPs, inscrições estaduais e códigos de barra truncados têm 10-11 dígitos e
 * passariam por qualquer validação que só contasse casas. Um CEP de São Paulo lido
 * como telefone vira uma ligação para o DDD 01, que não existe.
 */
export const DDDS_VALIDOS: ReadonlySet<string> = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
])

export type TipoTelefone = 'movel' | 'fixo' | 'especial'

/** Por que o número não serve. Nunca é motivo para apagar — é para rebaixar (§4.4). */
export type MotivoTelefoneInvalido =
  | 'vazio'
  | 'digitos_de_menos'
  | 'digitos_de_mais'
  | 'sem_ddd'
  | 'ddd_inexistente'
  | 'prefixo_impossivel'
  | 'repetido'

export interface TelefoneNormalizado {
  /** `+5511987654321`. Null quando não dá para afirmar que é um telefone. */
  e164: string | null
  /** `(11) 98765-4321` — o que se mostra na tela. */
  formatado: string | null
  ddd: string | null
  tipo: TipoTelefone | null
  valido: boolean
  motivo: MotivoTelefoneInvalido | null
  /** true quando o nono dígito foi ADICIONADO por nós, não veio na origem. */
  nono_digito_inferido: boolean
}

const INVALIDO = (motivo: MotivoTelefoneInvalido): TelefoneNormalizado => ({
  e164: null,
  formatado: null,
  ddd: null,
  tipo: null,
  valido: false,
  motivo,
  nono_digito_inferido: false,
})

/**
 * `11111111111`, `99999999999`, `00000000000`.
 *
 * São o que se digita num campo obrigatório que a pessoa não quer preencher, e
 * aparecem no XML da NF-e com frequência incômoda. Passam em toda regra de DDD e de
 * prefixo — `11` é DDD válido e `1` repetido nove vezes começa com 9 no lugar certo.
 */
function ehRepetido(digitos: string): boolean {
  return /^(\d)\1+$/.test(digitos)
}

/**
 * Um telefone brasileiro em forma canônica, ou o motivo de não ser um.
 *
 * `dddPadrao` vem do cadastral do fornecedor (UF/município) e só é usado quando o
 * número chega com 8-9 dígitos — comum em rodapé de site e em `infCpl` de NF-e, onde
 * quem escreveu sabia o DDD de cor. Sem ele, um número sem DDD fica inválido em vez
 * de virar uma ligação para o DDD errado.
 */
export function normalizarTelefoneBr(
  valor: string | null | undefined,
  opcoes: { dddPadrao?: string | null } = {},
): TelefoneNormalizado {
  const bruto = (valor ?? '').replace(/\D/g, '')
  if (!bruto) return INVALIDO('vazio')

  // Serviços especiais (0800/0300/4004) não têm DDD e não seguem a regra de 10-11
  // casas. São contato de verdade — muita distribuidora de material só publica o
  // 0800 —, então saem por cima em vez de morrerem em "ddd_inexistente".
  if (/^0[38]00\d{6,7}$/.test(bruto) || /^[34]00[34]\d{4}$/.test(bruto)) {
    return {
      e164: `+55${bruto}`,
      formatado: bruto.replace(/^(\d{4})(\d+)$/, '$1-$2'),
      ddd: null,
      tipo: 'especial',
      valido: true,
      motivo: null,
      nono_digito_inferido: false,
    }
  }

  let d = bruto

  /*
   * Os prefixos de discagem, tirados POR TAMANHO e não por regex gulosa.
   *
   * `^0(?:\d{2})?` parece resolver os dois casos e come três dígitos de
   * `011987654321`: sobra `987654321`, que é um celular sem DDD — e o número do DDD 11
   * vira "sem_ddd". O tamanho é o que desambigua, porque um telefone brasileiro
   * discável tem exatamente 10 ou 11 casas depois do prefixo.
   */
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    // `+55` / `55`. Só neste tamanho: `5533221100` tem 10 casas e É um número do DDD
    // 55 (Santa Maria/RS) — tirar o 55 dele deixaria 8 dígitos sem DDD.
    d = d.slice(2)
  } else if (d.startsWith('0')) {
    // `0` de interurbano (`011…`) ou `0` + código de operadora (`01511…`).
    if (d.length === 11 || d.length === 12) d = d.slice(1)
    else if (d.length === 13 || d.length === 14) d = d.slice(3)
  }

  if (ehRepetido(d)) return INVALIDO('repetido')

  const ddd = opcoes.dddPadrao?.replace(/\D/g, '').slice(0, 2) || null
  let nonoInferido = false

  // Sem DDD: 8 ou 9 casas. Só resolve com o DDD do cadastral.
  if (d.length === 8 || d.length === 9) {
    if (!ddd) return INVALIDO('sem_ddd')
    d = ddd + d
  }

  if (d.length < 10) return INVALIDO('digitos_de_menos')
  if (d.length > 11) return INVALIDO('digitos_de_mais')

  const area = d.slice(0, 2)
  if (!DDDS_VALIDOS.has(area)) return INVALIDO('ddd_inexistente')

  let assinante = d.slice(2)

  if (assinante.length === 8) {
    const primeiro = assinante[0] as string
    if (primeiro >= '6' && primeiro <= '9') {
      // Celular do cadastro antigo. O nono dígito é sempre 9 — a regra da Anatel é
      // acrescentar, não recalcular.
      assinante = `9${assinante}`
      nonoInferido = true
    } else if (primeiro < '2') {
      // Fixo começa em 2..5. 0 e 1 são prefixos de serviço, nunca de assinante.
      return INVALIDO('prefixo_impossivel')
    }
  } else if (assinante[0] !== '9') {
    // 9 casas e não começa com 9: não é celular e não é fixo. É um número truncado ou
    // um campo que não era telefone.
    return INVALIDO('prefixo_impossivel')
  }

  const tipo: TipoTelefone = assinante.length === 9 ? 'movel' : 'fixo'
  const meio = assinante.length === 9 ? assinante.slice(0, 5) : assinante.slice(0, 4)
  const fim = assinante.length === 9 ? assinante.slice(5) : assinante.slice(4)

  return {
    e164: `+55${area}${assinante}`,
    formatado: `(${area}) ${meio}-${fim}`,
    ddd: area,
    tipo,
    valido: true,
    motivo: null,
    nono_digito_inferido: nonoInferido,
  }
}

/**
 * Só celular tem WhatsApp — o número fixo com WhatsApp Business existe, mas é a
 * exceção, e prometer WhatsApp num fixo faz o originador perder o toque.
 *
 * Isto é PALPITE, e o nome diz. A confirmação de verdade vem do provedor, gravada em
 * `contatos_descobertos.validado.tem_whatsapp`.
 */
export function ehWhatsappProvavel(tel: TelefoneNormalizado): boolean {
  return tel.valido && tel.tipo === 'movel'
}

/** O DDD que a UF sugere quando o número vem sem ele. Só as capitais — é um palpite. */
export const DDD_POR_UF: Record<string, string> = {
  AC: '68', AL: '82', AM: '92', AP: '96', BA: '71', CE: '85', DF: '61', ES: '27',
  GO: '62', MA: '98', MG: '31', MS: '67', MT: '65', PA: '91', PB: '83', PE: '81',
  PI: '86', PR: '41', RJ: '21', RN: '84', RO: '69', RR: '95', RS: '51', SC: '48',
  SE: '79', SP: '11', TO: '63',
}
