/**
 * O dossiê de sinistro (Prompt 07 §7.2): o pacote que vai para a seguradora.
 *
 * Um ZIP com `00-indice.pdf` (item a item, com o SHA-256 de cada arquivo), o sumário
 * executivo e os arquivos do checklist. Esta parte é a PURA: decide nomes, ordem, o que
 * entra, o que falta e o texto do índice. Quem baixa arquivos, calcula hash e zipa é o
 * worker (`apps/worker/src/jobs/cobranca/dossie.ts`), porque precisa do storage e de
 * `node:crypto` — que o barril do core não pode importar.
 *
 * Ligar a Non-Payments API não muda nada aqui: o dossiê é o mesmo, muda o transporte.
 */

export interface ItemChecklist {
  item: string
  descricao: string
  obrigatorio: boolean
  status: 'pendente' | 'ok' | 'nao_aplicavel'
  justificativa_ausencia: string | null
}

export interface ArquivoDoDossie {
  /** Item do checklist (a–p), ou `sumario`. */
  item: string
  /** Nome dentro do ZIP (sem pasta). */
  nome: string
  sha256: string
  bytes: number
}

export interface IndiceDossie {
  cabecalho: string[]
  linhas: { item: string; descricao: string; situacao: string; arquivos: { nome: string; sha256: string }[] }[]
  justificativas: { item: string; descricao: string; texto: string }[]
  pendencias: string[]
}

/** `03-c-faturas-nf-1234.pdf`: a ordem do ZIP é a ordem do checklist. */
export function nomeArquivoDossie(item: string, seq: number, rotulo: string, extensao: string): string {
  const ordem = item === 'sumario' ? '01' : String(item.charCodeAt(0) - 'a'.charCodeAt(0) + 2).padStart(2, '0')
  const limpo = rotulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return `${ordem}-${item}-${String(seq).padStart(2, '0')}-${limpo}.${extensao.replace(/^\./, '')}`
}

/**
 * Obrigatório pendente trava o envio; obrigatório "não aplicável" só passa com
 * justificativa — e a justificativa entra no índice, que é o corpo do envio.
 */
export function pendenciasDoChecklist(itens: readonly ItemChecklist[]): string[] {
  return itens
    .filter((i) => i.obrigatorio && (i.status === 'pendente' || (i.status === 'nao_aplicavel' && !i.justificativa_ausencia?.trim())))
    .map((i) => `${i.item}) ${i.descricao}`)
}

export function montarIndiceDossie(e: {
  codigo: string
  apolice: string
  sacado: string
  sacado_cnpj: string
  gerado_em: string
  itens: readonly ItemChecklist[]
  arquivos: readonly ArquivoDoDossie[]
}): IndiceDossie {
  const porItem = new Map<string, ArquivoDoDossie[]>()
  for (const a of e.arquivos) {
    const l = porItem.get(a.item) ?? []
    l.push(a)
    porItem.set(a.item, l)
  }

  const linhas = [...e.itens]
    .sort((a, b) => a.item.localeCompare(b.item))
    .map((i) => ({
      item: i.item,
      descricao: i.descricao,
      situacao:
        i.status === 'ok'
          ? 'Anexado'
          : i.status === 'nao_aplicavel'
            ? 'Não aplicável'
            : i.obrigatorio
              ? 'PENDENTE'
              : 'Não se aplica / não anexado',
      arquivos: (porItem.get(i.item) ?? []).map((a) => ({ nome: a.nome, sha256: a.sha256 })),
    }))

  const sumario = porItem.get('sumario') ?? []
  if (sumario.length) {
    linhas.unshift({ item: '—', descricao: 'Sumário executivo', situacao: 'Anexado', arquivos: sumario.map((a) => ({ nome: a.nome, sha256: a.sha256 })) })
  }

  return {
    cabecalho: [
      `Dossiê de sinistro ${e.codigo}`,
      `Apólice ${e.apolice}`,
      `Comprador: ${e.sacado} (CNPJ ${e.sacado_cnpj})`,
      `Gerado em ${e.gerado_em}`,
      'Checklist da cl. 22208.00. Cada arquivo acompanha o hash SHA-256 do conteúdo enviado.',
    ],
    linhas,
    justificativas: e.itens
      .filter((i) => i.status === 'nao_aplicavel' && i.justificativa_ausencia?.trim())
      .map((i) => ({ item: i.item, descricao: i.descricao, texto: i.justificativa_ausencia!.trim() })),
    pendencias: pendenciasDoChecklist(e.itens),
  }
}

/** O índice em texto plano (vai no corpo do e-mail do modo manual e dentro do ZIP). */
export function indiceDossieTexto(ind: IndiceDossie): string {
  const out = [...ind.cabecalho, '']
  for (const l of ind.linhas) {
    out.push(`${l.item}) ${l.descricao} — ${l.situacao}`)
    for (const a of l.arquivos) out.push(`    ${a.nome}  sha256:${a.sha256}`)
  }
  if (ind.justificativas.length) {
    out.push('', 'Justificativas de ausência:')
    for (const j of ind.justificativas) out.push(`${j.item}) ${j.descricao}: ${j.texto}`)
  }
  if (ind.pendencias.length) {
    out.push('', 'PENDÊNCIAS (impedem o envio):', ...ind.pendencias.map((p) => `  • ${p}`))
  }
  return out.join('\n')
}
