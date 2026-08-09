/**
 * O domínio de uma empresa — normalização e o que os e-mails dos contatos dizem sobre ele.
 *
 * Este arquivo existe porque a mesma regra ("o que conta como domínio corporativo")
 * era necessária em três lugares: a cascata de resolução no worker, a edição manual na
 * ficha e a tela que compara o domínio salvo com o dos contatos. Três cópias da lista de
 * provedores genéricos é como um `@gmail.com` acaba virando o domínio de uma construtora
 * em exatamente um dos três caminhos — e ninguém descobre qual.
 */

/**
 * Provedores de e-mail que NÃO dizem nada sobre a empresa. A raiz do domínio (antes do
 * primeiro ponto) é o que se compara, para pegar `gmail.com` e `gmail.com.br` de uma vez.
 *
 * A segunda metade da lista (e os erros de digitação logo abaixo) não foi imaginada:
 * saiu de contar, no dump da Receita, quantas RAÍZES DE CNPJ DIFERENTES declaram cada
 * host. Um host que 400 empresas sem relação nenhuma informam à Receita não é o
 * domínio de nenhuma delas — é o provedor de e-mail de todas.
 */
export const PROVEDORES_EMAIL_GENERICOS: readonly string[] = [
  'gmail', 'hotmail', 'outlook', 'live', 'yahoo', 'uol', 'terra', 'bol', 'ig', 'globo',
  'r7', 'msn', 'icloud', 'aol', 'protonmail', 'proton', 'zipmail', 'oi', 'superig',
  'itelefonica', 'me', 'mac', 'gmx', 'yandex', 'zoho', 'mail',
  // Provedores e webmails brasileiros, por ordem de aparição no dump.
  'brturbo', 'veloxmail', 'uai', 'uaivip', 'netsite', 'ibest', 'onda', 'sercomtel',
  'email', 'ymail', 'globomail', 'pop', 'netuno', 'dglnet', 'com4',
]

/**
 * Erros de digitação dos dois maiores provedores. Não é preciosismo: são ~950 empresas
 * no dump que ficariam com `gmai.com` gravado como domínio corporativo — e um domínio
 * que não existe some no DNS, o que faz o enriquecimento devolver "sem dados" para
 * sempre em vez de dizer que o e-mail era pessoal.
 */
export const ERROS_DE_DIGITACAO_GENERICOS: readonly string[] = [
  'gmai', 'gamil', 'gmal', 'gmil', 'gmial', 'gamail', 'gmaill', 'hotmai', 'homail',
  'hotmial', 'hotmal', 'yahho', 'yaho',
]

/**
 * Hosts que são o próprio "não sei": alguém precisava preencher um campo obrigatório e
 * preencheu. `contato.com.br` aparece em 237 raízes de CNPJ diferentes — é o que se
 * digita quando o formulário exige um e-mail e o endereço real é `contato@` alguma
 * coisa que a pessoa não lembrava.
 */
export const HOSTS_PLACEHOLDER: readonly string[] = ['contato', 'xxx', 'teste', 'exemplo', 'example', 'naotem', 'semail']

const GENERICOS = new Set([...PROVEDORES_EMAIL_GENERICOS, ...ERROS_DE_DIGITACAO_GENERICOS])
const PLACEHOLDERS = new Set(HOSTS_PLACEHOLDER)

// ─── Contabilidade ──────────────────────────────────────────────────────────

/**
 * O e-mail que a CONTABILIDADE cadastrou na abertura da empresa.
 *
 * É o caso mais comum de domínio errado que passa em toda validação: o domínio existe,
 * responde HTTP, tem MX — só não é da empresa. Enriquecer por ele traz o headcount e os
 * contatos do escritório contábil, e o número chega à tela com a mesma cara de um dado
 * apurado. No dump da Receita são 39.472 empresas com um domínio assim declarado.
 *
 * Os tokens são deliberadamente curtos (`contab`, `contad`) e deliberadamente NÃO
 * incluem `cont` sozinho. `cont` pegaria `contextoengenharia`, `contrutoraf5`,
 * `contagas` e `contatoincorporadora` — construtoras de verdade, medidas no dump. O
 * preço de não pegar `contalex` e `contasur` (escritórios cujo nome não diz que são)
 * é menor que o de apagar o domínio certo de uma construtora.
 */
export const TOKENS_CONTABILIDADE: readonly string[] = ['contab', 'contad', 'conteis']

/**
 * `.cnt.br` é reservado pelo registro.br a CONTABILISTAS — exige registro no CRC. Não é
 * heurística: quem tem esse domínio provou ser um escritório contábil para consegui-lo.
 */
export const SUFIXOS_CONTABILIDADE: readonly string[] = ['.cnt.br']

export function ehDominioDeContabilidade(host: string): boolean {
  const h = host.toLowerCase()
  if (SUFIXOS_CONTABILIDADE.some((s) => h.endsWith(s))) return true
  return TOKENS_CONTABILIDADE.some((t) => h.includes(t))
}

/** Por que este host não serve como domínio da empresa — ou null quando serve. */
export type MotivoDescarteDominio = 'provedor_generico' | 'placeholder' | 'contabilidade'

export const MOTIVO_DESCARTE_DOMINIO_LABELS: Record<MotivoDescarteDominio, string> = {
  provedor_generico: 'E-mail pessoal (provedor genérico)',
  placeholder: 'Endereço de preenchimento, não da empresa',
  contabilidade: 'Domínio de escritório contábil',
}

/**
 * O guarda único da cascata. Vale para qualquer origem — e-mail da Receita, e-mail de
 * contato, heurística, busca do Claude —, porque as quatro conseguem chegar no domínio
 * do contador, e cada uma tinha o seu próprio jeito de não perceber.
 */
export function motivoDescarteDominio(
  host: string | null | undefined,
): MotivoDescarteDominio | null {
  const h = normalizarDominio(host)
  if (!h) return null // não é domínio: quem chamou já trata
  if (ehProvedorGenerico(h)) return 'provedor_generico'
  if (ehPlaceholder(h)) return 'placeholder'
  if (ehDominioDeContabilidade(h)) return 'contabilidade'
  return null
}

/**
 * O host puro: sem esquema, sem caminho, sem porta, sem `www.`, minúsculo.
 *
 * O `www.` importa mais do que parece. `organizations/enrich?domain=www.acme.com.br` não
 * acha nada no Apollo — e o job volta `sem_dados` em silêncio, indistinguível de uma
 * empresa que o Apollo realmente não conhece. Um prefixo de três letras vira "esta
 * empresa não tem headcount", para sempre.
 */
export function normalizarDominio(valor: string | null | undefined): string | null {
  if (!valor) return null
  const host = valor
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split('/')[0]
    ?.split('?')[0]
    ?.split('#')[0]
    ?.split(':')[0]
    ?.replace(/^www\./, '')
    .replace(/\.+$/, '')
  if (!host) return null
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null
}

/**
 * A raiz é comparada para pegar `gmail.com` e `gmail.com.br` com uma entrada só — mas o
 * limite de três rótulos é o que impede `mail.construtora.com.br` (quatro) de ser
 * descartado como se fosse `mail.com`. Um subdomínio de e-mail corporativo é justamente
 * o tipo de endereço que a empresa usa, e perdê-lo apagaria a evidência mais forte.
 */
function ehProvedorGenerico(host: string): boolean {
  const partes = host.split('.')
  return partes.length <= 3 && GENERICOS.has(partes[0] as string)
}

/** Mesmo limite de rótulos: `contato.construtora.com.br` é um subdomínio de verdade. */
function ehPlaceholder(host: string): boolean {
  const partes = host.split('.')
  return partes.length <= 3 && PLACEHOLDERS.has(partes[0] as string)
}

/**
 * O domínio corporativo de um e-mail, ou null quando ele não diz nada — endereço
 * malformado, provedor genérico, placeholder ou escritório contábil. Null é resposta,
 * não falha: um contato no Gmail é um contato válido cujo e-mail simplesmente não
 * identifica a empresa.
 */
export function dominioDeEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const arroba = email.trim().toLowerCase().split('@')
  if (arroba.length !== 2) return null
  const host = normalizarDominio(arroba[1])
  if (!host) return null
  return motivoDescarteDominio(host) === null ? host : null
}

// ─── O que os contatos dizem sobre o domínio salvo ──────────────────────────

export interface ContatoComEmail {
  empresaId: string
  email: string | null
}

export interface EmpresaComDominio {
  id: string
  dominio: string | null
}

/**
 * Por que três casos e não só "divergente":
 *
 *  - `ausente`    — não há domínio salvo e os contatos sabem qual é. É o volume: na base
 *                   real são ~174 empresas contra 4 divergências. O e-mail já estava lá.
 *  - `malformado` — o salvo aponta para o MESMO lugar, escrito de um jeito que quebra a
 *                   consulta (`www.acme.com.br`). Some da lista se a comparação for feita
 *                   já normalizada, e continua quebrando o enriquecimento em silêncio.
 *  - `divergente` — são domínios diferentes de verdade. Aqui adotar pode estar ERRADO: uma
 *                   construtora cujo contato usa o domínio da marca de vendas tem os dois
 *                   corretos, cada um para uma coisa. Por isso é sugestão, nunca automático.
 */
export type CasoDominio = 'ausente' | 'malformado' | 'divergente'

export const CASO_DOMINIO_LABELS: Record<CasoDominio, string> = {
  ausente: 'Sem domínio salvo',
  malformado: 'Mesmo domínio, forma quebrada',
  divergente: 'Domínio diferente',
}

export interface CandidatoDominio {
  dominio: string
  contatos: number
}

export interface SugestaoDominio {
  empresaId: string
  caso: CasoDominio
  /** Exatamente como está gravado — inclusive `www.`, que é metade do ponto. */
  dominioAtual: string | null
  /** O candidato mais forte: mais contatos; empate resolvido em ordem alfabética. */
  sugerido: string
  contatosSugerido: number
  /** Quantos contatos usam o domínio já salvo. Zero é o sinal de que ninguém o usa. */
  contatosNoAtual: number
  candidatos: CandidatoDominio[]
}

/**
 * Cruza contatos com empresas e devolve, por empresa, o domínio que os e-mails sugerem.
 *
 * Não emite sugestão quando o domínio salvo já é o mais usado pelos contatos — que é o
 * caso da esmagadora maioria e não é notícia nenhuma.
 */
export function sugerirDominiosPorContato(
  contatos: readonly ContatoComEmail[],
  empresas: readonly EmpresaComDominio[],
): SugestaoDominio[] {
  const porEmpresa = new Map<string, Map<string, number>>()
  for (const c of contatos) {
    const dom = dominioDeEmail(c.email)
    if (!dom) continue
    const mapa = porEmpresa.get(c.empresaId) ?? new Map<string, number>()
    mapa.set(dom, (mapa.get(dom) ?? 0) + 1)
    porEmpresa.set(c.empresaId, mapa)
  }

  const sugestoes: SugestaoDominio[] = []

  for (const empresa of empresas) {
    const contagem = porEmpresa.get(empresa.id)
    if (!contagem || contagem.size === 0) continue

    const candidatos: CandidatoDominio[] = [...contagem.entries()]
      .map(([dominio, n]) => ({ dominio, contatos: n }))
      .sort((a, b) => b.contatos - a.contatos || a.dominio.localeCompare(b.dominio))

    const melhor = candidatos[0]
    if (!melhor) continue

    const atualNormalizado = normalizarDominio(empresa.dominio)

    // O domínio salvo já é o que os contatos usam: nada a dizer.
    if (atualNormalizado === melhor.dominio && empresa.dominio === atualNormalizado) continue

    const caso: CasoDominio =
      atualNormalizado === null
        ? 'ausente'
        : atualNormalizado === melhor.dominio
          ? 'malformado'
          : 'divergente'

    sugestoes.push({
      empresaId: empresa.id,
      caso,
      dominioAtual: empresa.dominio ?? null,
      sugerido: melhor.dominio,
      contatosSugerido: melhor.contatos,
      contatosNoAtual: atualNormalizado ? (contagem.get(atualNormalizado) ?? 0) : 0,
      candidatos,
    })
  }

  return sugestoes
}
