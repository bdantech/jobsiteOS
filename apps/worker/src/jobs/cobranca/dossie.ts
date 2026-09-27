import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { hojeSaoPaulo, somarMeses } from '../../../../../packages/core/src/cobranca/datas.js'
import {
  indiceDossieTexto,
  montarIndiceDossie,
  nomeArquivoDossie,
  type ArquivoDoDossie,
  type ItemChecklist,
} from '../../../../../packages/core/src/cobranca/dossie.js'
import { formatarBrl, formatarCnpjCobranca, formatarDataBr } from '../../../../../packages/core/src/cobranca/modelos.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { todasAsPaginas } from '../../paginar.js'
import { baixarArquivo, dataSp, lerConfigCobranca, sha256Hex, subirArquivo } from './comum.js'
import { markdownParaPdf } from './pdf.js'
import { carimbo } from './regras.js'

/**
 * O dossiê de sinistro (Prompt 07 §7.2): o pacote que vai para a Atradius.
 *
 * Um ZIP com `00-indice.pdf` (item a item, com o SHA-256 de cada arquivo), o sumário
 * executivo e os arquivos do checklist da cl. 22208.00. O que é PURO — nomes, ordem,
 * texto do índice, pendências — está no core (`cobranca/dossie.ts`) e é testado lá;
 * aqui fica o que depende de storage, hash e zip.
 *
 * ── "AUTO" SÓ QUANDO HÁ CONTEÚDO ────────────────────────────────────────────
 * Um item do sistema só vira `ok` quando o arquivo existe de verdade: a NF sem XML, a
 * cobrança sem notificação enviada, o sacado sem histórico de operações continuam
 * PENDENTES, e o índice diz isso. Marcar "anexado" um item vazio é exatamente a
 * recusa de sinistro que este módulo existe para evitar.
 *
 * Item que alguém anexou à mão (origem `upload`) ou marcou como não aplicável nunca é
 * sobrescrito pela geração automática.
 *
 * ── O ZIP É IMUTÁVEL ────────────────────────────────────────────────────────
 * Cada geração é um arquivo novo (`dossie-<carimbo>.zip`): o que foi enviado à
 * seguradora continua no bucket, com o hash que o e-mail citou.
 */

export interface ResultadoDossie {
  dossie_path: string
  dossie_hash: string
  pendencias: string[]
  /** Itens do checklist que o sistema montou NESTA geração. */
  itens_gerados: string[]
}

interface ArquivoMontado {
  item: string
  nome: string
  bytes: Uint8Array
  sha256: string
  /** Onde o arquivo mora no bucket (o original, ou a cópia em `auto/`). */
  caminho: string
}

const ENVIADA = ['enviada', 'entregue', 'respondida']
const CAUSA_LABEL: Record<string, string> = { mora_prolongada: 'Mora prolongada', insolvencia: 'Insolvência' }
const dataOuTraco = (d: string | null | undefined) => (d ? formatarDataBr(d) : '—')
const celula = (s: string | null | undefined) => (s ?? '—').replace(/\|/g, '/').replace(/\n/g, ' ')
const extensao = (caminho: string, padrao: string) => caminho.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? padrao

export async function gerarDossieSinistro(sinistroId: string): Promise<ResultadoDossie> {
  const { data: s, error } = await supabaseAdmin.from('sinistros').select('*').eq('id', sinistroId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!s) throw new Error('Sinistro não encontrado.')

  const [{ data: apolice }, { data: cobranca }, { data: docs }, cfg] = await Promise.all([
    supabaseAdmin.from('apolices').select('numero, seguradora').eq('id', s.apolice_id).maybeSingle(),
    s.cobranca_id
      ? supabaseAdmin.from('cobrancas').select('id, codigo, escopo_notificacao').eq('id', s.cobranca_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from('sinistro_documentos').select('*').eq('sinistro_id', s.id).order('item'),
    lerConfigCobranca(),
  ])
  const { data: stRows } = await supabaseAdmin
    .from('sinistro_titulos')
    .select('valor_face, valor_cedido, titulo_id, titulos(numero, externo_id, nf_chave_acesso, emissao, vencimento, sacado_cnpj, sacado_nome, cedente_cnpj, cedente_nome, status)')
    .eq('sinistro_id', s.id)
  const titulos = (stRows ?? []).map((r) => ({
    ...r,
    t: r.titulos as {
      numero: string | null
      externo_id: string
      nf_chave_acesso: string | null
      emissao: string | null
      vencimento: string
      sacado_cnpj: string
      sacado_nome: string | null
      cedente_cnpj: string
      cedente_nome: string | null
      status: string
    } | null,
  }))
  const sacadoNome = await razaoSocialDoSacado(s.sacado_empresa_id, s.sacado_matriz_cnpj, titulos.map((x) => x.t))

  const linhas = docs ?? []
  const porItem = new Map(linhas.map((d) => [d.item, d]))
  const arquivos: ArquivoMontado[] = []
  const itensGerados: string[] = []
  const pasta = `sinistros/${s.id}/auto`

  /** O item é da máquina nesta geração? Não, se alguém anexou à mão ou disse "não se aplica". */
  const automatico = (item: string) => {
    const d = porItem.get(item)
    return !!d && d.origem === 'sistema' && d.status !== 'nao_aplicavel'
  }
  const seq = (item: string) => arquivos.filter((a) => a.item === item).length + 1

  /** Um arquivo que JÁ está no bucket (notificação, comprovante, certidão, acordo assinado). */
  const incluirExistente = async (item: string, caminho: string | null, rotulo: string, ext = 'pdf') => {
    if (!caminho) return
    const bytes = await baixarArquivo(caminho)
    if (!bytes) return
    arquivos.push({ item, nome: nomeArquivoDossie(item, seq(item), rotulo, extensao(caminho, ext)), bytes, sha256: sha256Hex(bytes), caminho })
  }
  /** Um arquivo que o dossiê produz: vai para `auto/` (sobrescrevível — o ZIP é quem é imutável). */
  const incluirGerado = async (item: string, bytes: Uint8Array, rotulo: string, ext: string, mime: string) => {
    const nome = nomeArquivoDossie(item, seq(item), rotulo, ext)
    const caminho = `${pasta}/${nome}`
    await subirArquivo(caminho, bytes, mime, { substituir: true })
    arquivos.push({ item, nome, bytes, sha256: sha256Hex(bytes), caminho })
  }
  const pdf = (md: string, titulo: string) =>
    markdownParaPdf(md, { titulo, rodape: `Sinistro ${s.codigo ?? s.id} · ${titulo} · gerado em ${formatarDataBr(hojeSaoPaulo())}` })

  // ── c) Faturas: o XML das NFs ─────────────────────────────────────────────
  if (automatico('c')) {
    const chaves = titulos.map((x) => x.t?.nf_chave_acesso).filter((c): c is string => !!c)
    if (chaves.length) {
      const { data: nfs } = await supabaseAdmin.from('notas_fiscais').select('access_key, numero, raw_xml').in('access_key', chaves)
      for (const nf of nfs ?? []) {
        if (!nf.raw_xml?.trim()) continue
        await incluirGerado('c', strToU8(nf.raw_xml), `nf-${nf.numero ?? nf.access_key}`, 'xml', 'application/xml')
      }
    }
  }

  // ── Notificações da cobrança (g, o, p) ──────────────────────────────────
  const { data: notifs } = s.cobranca_id
    ? await supabaseAdmin
        .from('cobranca_notificacoes')
        .select('id, papel, rodada, destinatario_cnpj, documento_path, status')
        .eq('cobranca_id', s.cobranca_id)
        .in('status', ENVIADA)
        .not('documento_path', 'is', null)
        .order('rodada')
    : { data: [] as { id: string; papel: string; rodada: number; destinatario_cnpj: string; documento_path: string | null; status: string }[] }
  const rotuloNotif = (n: { papel: string; rodada: number; destinatario_cnpj: string }) =>
    `notificacao-${n.papel.replace('_', '-')}-${n.destinatario_cnpj}-r${n.rodada}`

  // ── g) Correspondência de cobrança: notificações + provas de entrega + certidões ──
  if (automatico('g')) {
    for (const n of notifs ?? []) await incluirExistente('g', n.documento_path, rotuloNotif(n))
    const ids = (notifs ?? []).map((n) => n.id)
    if (ids.length) {
      const { data: entregas } = await supabaseAdmin
        .from('cobranca_notificacao_entregas')
        .select('canal, codigo_rastreio, comprovante_path')
        .in('notificacao_id', ids)
        .not('comprovante_path', 'is', null)
      for (const e of entregas ?? []) {
        await incluirExistente('g', e.comprovante_path, `comprovante-${e.canal}-${e.codigo_rastreio ?? ''}`)
      }
    }
    if (s.cobranca_id) {
      const { data: certidoes } = await supabaseAdmin
        .from('protesto_titulos')
        .select('certidao_path, protocolo_cartorio, protesto_remessas!inner(cobranca_id)')
        .eq('protesto_remessas.cobranca_id', s.cobranca_id)
        .not('certidao_path', 'is', null)
      for (const c of certidoes ?? []) await incluirExistente('g', c.certidao_path, `certidao-protesto-${c.protocolo_cartorio ?? ''}`)
    }
  }

  // ── h) Insolvência: só quando há registro ─────────────────────────────────
  if (automatico('h')) {
    const { data: ins } = await supabaseAdmin
      .from('cobranca_insolvencias')
      .select('*')
      .eq('sacado_matriz_cnpj', s.sacado_matriz_cnpj)
      .maybeSingle()
    if (ins) {
      const md = [
        `# Notificação formal de insolvência`,
        '',
        `**Comprador:** ${sacadoNome} (CNPJ ${formatarCnpjCobranca(s.sacado_matriz_cnpj)})`,
        `**Evento:** ${ins.tipo === 'falencia' ? 'Falência' : ins.tipo === 'recuperacao_judicial' ? 'Recuperação judicial' : 'Outro evento de insolvência'}`,
        `**Data da decisão:** ${formatarDataBr(ins.data_decisao)}${ins.confirmada ? '' : ' (a confirmar — data de distribuição do processo)'}`,
        `**Processo:** ${ins.numero_cnj ?? 'não vinculado'}`,
        `**Origem do registro:** ${ins.fonte === 'juridico' ? 'detectado no Jurídico' : 'registro manual'} em ${dataOuTraco(dataSp(ins.criado_em))}`,
        '',
        ins.observacao ?? '',
      ].join('\n')
      await incluirGerado('h', await pdf(md, 'Insolvência'), 'insolvencia', 'pdf', 'application/pdf')
    }
  }

  // ── i) Registro de dívida: o extrato de cobranca_titulos ─────────────────
  if (automatico('i') && s.cobranca_id) {
    const { data: cts } = await supabaseAdmin
      .from('cobranca_titulos')
      .select('valor_face_snapshot, vencimento_snapshot, dias_atraso_snapshot, sacado_cnpj_snapshot, cedente_cnpj_snapshot, situacao, quitado_em, valor_recebido, titulos(numero, externo_id, sacado_nome, cedente_nome)')
      .eq('cobranca_id', s.cobranca_id)
      .order('vencimento_snapshot')
    if (cts?.length) {
      const linhasMd = cts.map((c) => {
        const t = c.titulos as { numero: string | null; externo_id: string; sacado_nome: string | null; cedente_nome: string | null } | null
        return `| ${celula(t?.numero ?? t?.externo_id)} | ${celula(t?.sacado_nome ?? formatarCnpjCobranca(c.sacado_cnpj_snapshot))} | ${celula(t?.cedente_nome ?? formatarCnpjCobranca(c.cedente_cnpj_snapshot))} | ${formatarDataBr(c.vencimento_snapshot)} | ${formatarBrl(Number(c.valor_face_snapshot))} | ${c.situacao} | ${dataOuTraco(c.quitado_em)} | ${c.valor_recebido === null ? '—' : formatarBrl(Number(c.valor_recebido))} |`
      })
      const total = cts.reduce((acc, c) => acc + Number(c.valor_face_snapshot), 0)
      const md = [
        `# Registro de dívida — ${cobranca?.codigo ?? ''}`,
        '',
        `**Devedor:** ${sacadoNome} (CNPJ ${formatarCnpjCobranca(s.sacado_matriz_cnpj)})`,
        `**Credor:** ${cfg.credor.razao_social} (CNPJ ${formatarCnpjCobranca(cfg.credor.cnpj)})`,
        '',
        'Valores de face e vencimentos ORIGINAIS no momento da inclusão na cobrança (snapshot).',
        '',
        '| Título | Devedora | Cedente | Vencimento | Valor de face | Situação | Quitado em | Recebido |',
        '|---|---|---|---|---:|---|---|---:|',
        ...linhasMd,
        '',
        `**Total de face:** ${formatarBrl(total)}`,
      ].join('\n')
      await incluirGerado('i', await pdf(md, 'Registro de dívida'), 'registro-de-divida', 'pdf', 'application/pdf')
    }
  }

  // ── j) Confissão de dívida assinada ─────────────────────────────────────
  if (automatico('j') && s.cobranca_id) {
    const { data: acordos } = await supabaseAdmin
      .from('acordos')
      .select('id, documento_assinado_path')
      .eq('cobranca_id', s.cobranca_id)
      .eq('status', 'assinado')
      .not('documento_assinado_path', 'is', null)
    for (const a of acordos ?? []) await incluirExistente('j', a.documento_assinado_path, 'confissao-de-divida-assinada')
  }

  // ── k) Lista de faturas em aberto do comprador ───────────────────────────
  if (automatico('k')) {
    const abertas = await todasAsPaginas<{
      numero: string | null
      externo_id: string
      sacado_cnpj: string
      sacado_nome: string | null
      cedente_nome: string | null
      cedente_cnpj: string
      emissao: string | null
      vencimento: string
      valor_face: number
    }>((de, ate) =>
      supabaseAdmin
        .from('titulos')
        .select('numero, externo_id, sacado_cnpj, sacado_nome, cedente_nome, cedente_cnpj, emissao, vencimento, valor_face')
        .eq('sacado_matriz_cnpj', s.sacado_matriz_cnpj)
        .eq('status', 'aberto')
        .order('vencimento')
        .range(de, ate),
    )
    if (abertas.length) {
      const total = abertas.reduce((acc, t) => acc + Number(t.valor_face), 0)
      const md = [
        `# Lista de faturas em aberto`,
        '',
        `**Comprador:** ${sacadoNome} (CNPJ ${formatarCnpjCobranca(s.sacado_matriz_cnpj)}) — grupo econômico (matriz, SPEs e filiais)`,
        `**Posição em:** ${formatarDataBr(hojeSaoPaulo())}`,
        '',
        '| Título | Devedora | Cedente | Emissão | Vencimento | Valor de face |',
        '|---|---|---|---|---|---:|',
        ...abertas.map(
          (t) =>
            `| ${celula(t.numero ?? t.externo_id)} | ${celula(t.sacado_nome ?? formatarCnpjCobranca(t.sacado_cnpj))} | ${celula(t.cedente_nome ?? formatarCnpjCobranca(t.cedente_cnpj))} | ${dataOuTraco(t.emissao)} | ${formatarDataBr(t.vencimento)} | ${formatarBrl(Number(t.valor_face))} |`,
        ),
        '',
        `**Total em aberto:** ${formatarBrl(total)} em ${abertas.length} título(s).`,
      ].join('\n')
      await incluirGerado('k', await pdf(md, 'Faturas em aberto'), 'faturas-em-aberto', 'pdf', 'application/pdf')
    }
  }

  // ── l) Extrato dos 12 meses anteriores ao vencimento ─────────────────────
  if (automatico('l') && titulos.length) {
    const primeiro = titulos.map((x) => x.t?.vencimento).filter((v): v is string => !!v).sort()[0]
    if (primeiro) {
      const inicio = somarMeses(primeiro, -12)
      const { data: grupo } = await supabaseAdmin.rpc('app__cobranca_cnpjs_do_grupo', { p_matriz: s.sacado_matriz_cnpj })
      const cnpjs = [...new Set([s.sacado_matriz_cnpj, ...((grupo as string[] | null) ?? [])])]
      const ops = await todasAsPaginas<{
        id_externo: number
        document_number: string | null
        sacado_cnpj: string
        fornecedor_nome: string | null
        gross_value: number | null
        original_due_date: string | null
        status: string
        completion_date: string | null
        created_at_plataforma: string | null
      }>((de, ate) =>
        supabaseAdmin
          .from('antecipacoes')
          .select('id_externo, document_number, sacado_cnpj, fornecedor_nome, gross_value, original_due_date, status, completion_date, created_at_plataforma')
          .in('sacado_cnpj', cnpjs)
          .gte('created_at_plataforma', `${inicio}T03:00:00Z`)
          .lt('created_at_plataforma', `${primeiro}T03:00:00Z`)
          .order('created_at_plataforma')
          .range(de, ate),
      )
      if (ops.length) {
        const bruto = ops.reduce((acc, o) => acc + Number(o.gross_value ?? 0), 0)
        const md = [
          `# Extrato da conta — 12 meses anteriores ao vencimento`,
          '',
          `**Comprador:** ${sacadoNome} (CNPJ ${formatarCnpjCobranca(s.sacado_matriz_cnpj)})`,
          `**Período:** ${formatarDataBr(inicio)} a ${formatarDataBr(primeiro)} (primeiro vencimento do sinistro)`,
          '',
          'Operações de cessão de recebíveis contra o grupo do comprador, pela data de entrada na plataforma.',
          '',
          '| Entrada | Operação | Documento | Devedora | Cedente | Vencimento | Valor | Situação | Liquidação |',
          '|---|---|---|---|---|---|---:|---|---|',
          ...ops.map(
            (o) =>
              `| ${dataOuTraco(dataSp(o.created_at_plataforma))} | ${o.id_externo} | ${celula(o.document_number)} | ${formatarCnpjCobranca(o.sacado_cnpj)} | ${celula(o.fornecedor_nome)} | ${dataOuTraco(o.original_due_date)} | ${formatarBrl(Number(o.gross_value ?? 0))} | ${o.status} | ${dataOuTraco(dataSp(o.completion_date))} |`,
          ),
          '',
          `**Total operado no período:** ${formatarBrl(bruto)} em ${ops.length} operação(ões).`,
        ].join('\n')
        await incluirGerado('l', await pdf(md, 'Extrato 12 meses'), 'extrato-12-meses', 'pdf', 'application/pdf')
      }
    }
  }

  // ── o) e p) Notificações ao sacado e ao cedente ──────────────────────────
  if (automatico('o')) {
    for (const n of (notifs ?? []).filter((n) => n.papel.startsWith('sacado'))) await incluirExistente('o', n.documento_path, rotuloNotif(n))
  }
  if (automatico('p') && cobranca?.escopo_notificacao === 'sacado_e_cedente') {
    for (const n of (notifs ?? []).filter((n) => n.papel.startsWith('cedente'))) await incluirExistente('p', n.documento_path, rotuloNotif(n))
  }

  // ── O checklist: auto com conteúdo vira `ok` ────────────────────────────
  const agora = new Date().toISOString()
  for (const item of [...new Set(arquivos.map((a) => a.item))]) {
    const d = porItem.get(item)
    if (!d || !automatico(item)) continue
    const primeiro = arquivos.find((a) => a.item === item)!
    const { error: erroDoc } = await supabaseAdmin
      .from('sinistro_documentos')
      .update({ status: 'ok', arquivo_path: primeiro.caminho, arquivo_hash: primeiro.sha256, anexado_em: agora })
      .eq('id', d.id)
      .eq('origem', 'sistema')
      .neq('status', 'nao_aplicavel')
    if (erroDoc) logger.error({ item, erro: erroDoc.message }, 'Falha ao marcar item do dossiê.')
    else {
      itensGerados.push(item)
      d.status = 'ok'
    }
  }

  // ── Anexos de gente, e o `ok` de uma geração anterior cujo arquivo segue lá ──
  for (const d of linhas) {
    if (d.status !== 'ok' || !d.arquivo_path || arquivos.some((a) => a.item === d.item)) continue
    await incluirExistente(d.item, d.arquivo_path, d.descricao, 'pdf')
  }

  // ── Sumário executivo ────────────────────────────────────────────────────
  const sumario = await pdf(
    await sumarioMarkdown({ s, apolice, cobranca, cfg, sacadoNome, titulos }),
    'Sumário executivo',
  )
  arquivos.push({
    item: 'sumario',
    nome: nomeArquivoDossie('sumario', 1, 'sumario-executivo', 'pdf'),
    bytes: sumario,
    sha256: sha256Hex(sumario),
    caminho: `${pasta}/sumario-executivo.pdf`,
  })
  await subirArquivo(`${pasta}/sumario-executivo.pdf`, sumario, 'application/pdf', { substituir: true })

  // ── O índice ─────────────────────────────────────────────────────────────
  const itens: ItemChecklist[] = linhas.map((d) => ({
    item: d.item,
    descricao: d.descricao,
    obrigatorio: d.obrigatorio,
    status: d.status as ItemChecklist['status'],
    justificativa_ausencia: d.justificativa_ausencia,
  }))
  const indice = montarIndiceDossie({
    codigo: s.codigo ?? s.id,
    apolice: apolice?.numero ?? '—',
    sacado: sacadoNome,
    sacado_cnpj: formatarCnpjCobranca(s.sacado_matriz_cnpj),
    gerado_em: new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date()),
    itens,
    arquivos: arquivos.map<ArquivoDoDossie>((a) => ({ item: a.item, nome: a.nome, sha256: a.sha256, bytes: a.bytes.byteLength })),
  })
  const texto = indiceDossieTexto(indice)
  const extra = s.justificativa_prova_entrega?.trim()
    ? `\n\nJustificativa da ausência de prova de entrega:\n${s.justificativa_prova_entrega.trim()}`
    : ''
  const indicePdf = await pdf(`# Índice do dossiê\n\n${texto}${extra}`, 'Índice')

  // ── O ZIP ────────────────────────────────────────────────────────────────
  const conteudo: Zippable = {
    '00-indice.pdf': [indicePdf, { level: 0 }],
    // O texto também, para o corpo do e-mail do modo manual ser EXATAMENTE este índice.
    '00-indice.txt': strToU8(`${texto}${extra}\n`),
  }
  for (const a of arquivos) conteudo[a.nome] = [a.bytes, { level: a.nome.endsWith('.xml') ? 6 : 0 }]
  const zip = zipSync(conteudo, { level: 6 })
  const hash = sha256Hex(zip)
  const caminhoZip = `sinistros/${s.id}/dossie-${carimbo()}.zip`
  await subirArquivo(caminhoZip, zip, 'application/zip')

  const { error: erroSin } = await supabaseAdmin
    .from('sinistros')
    .update({ dossie_path: caminhoZip, dossie_hash: hash, dossie_gerado_em: new Date().toISOString() })
    .eq('id', s.id)
  if (erroSin) throw new Error(`Dossiê gerado, mas não registrado no sinistro: ${erroSin.message}`)

  logger.info(
    { sinistro: s.id, arquivos: arquivos.length, bytes: zip.byteLength, pendencias: indice.pendencias.length },
    'Dossiê de sinistro gerado.',
  )
  return { dossie_path: caminhoZip, dossie_hash: hash, pendencias: indice.pendencias, itens_gerados: itensGerados.sort() }
}

/** O texto do índice guardado dentro do ZIP (`00-indice.txt`), ou `null`. */
export function indiceDoZip(zip: Uint8Array): string | null {
  try {
    const f = unzipSync(zip, { filter: (a) => a.name === '00-indice.txt' })['00-indice.txt']
    return f ? strFromU8(f) : null
  } catch {
    return null
  }
}

async function razaoSocialDoSacado(
  empresaId: string | null,
  matriz: string,
  titulos: readonly ({ sacado_cnpj: string; sacado_nome: string | null } | null)[],
): Promise<string> {
  if (empresaId) {
    const { data } = await supabaseAdmin.from('empresas').select('razao_social').eq('id', empresaId).maybeSingle()
    if (data?.razao_social) return data.razao_social
  }
  const daMatriz = titulos.find((t) => t?.sacado_cnpj === matriz && t.sacado_nome)?.sacado_nome
  return daMatriz ?? titulos.find((t) => t?.sacado_nome)?.sacado_nome ?? formatarCnpjCobranca(matriz)
}

interface EntradaSumario {
  s: {
    id: string
    codigo: string | null
    cobranca_id: string | null
    sacado_matriz_cnpj: string
    causa: string
    data_perda: string
    data_limite_envio: string | null
    estagio: string
    valor_total_face: number
    valor_recebido_parcial: number
    perda_segurada_estimada: number | null
    indenizacao_estimada: number | null
    memoria_perda: unknown
    notificado_em: string | null
    justificativa_prova_entrega: string | null
  }
  apolice: { numero: string; seguradora: string } | null
  cobranca: { id: string; codigo: string | null } | null
  cfg: Awaited<ReturnType<typeof lerConfigCobranca>>
  sacadoNome: string
  titulos: {
    valor_face: number
    valor_cedido: number | null
    t: {
      numero: string | null
      externo_id: string
      nf_chave_acesso: string | null
      vencimento: string
      sacado_cnpj: string
      sacado_nome: string | null
      cedente_cnpj: string
      cedente_nome: string | null
    } | null
  }[]
}

/**
 * O sumário executivo (§7.2): partes, títulos, a cronologia inteira da cobrança (o
 * event log renderizado) e a memória da perda. É a primeira coisa que o analista da
 * seguradora lê — e a que decide se ele lê o resto com boa vontade.
 */
async function sumarioMarkdown(e: EntradaSumario): Promise<string> {
  const { s, cfg } = e
  const md: string[] = [
    `# Sumário executivo — Sinistro ${s.codigo ?? ''}`,
    '',
    `**Apólice:** ${e.apolice?.numero ?? '—'} — ${e.apolice?.seguradora ?? 'Atradius'}`,
    `**Segurado:** ${cfg.credor.razao_social} (CNPJ ${formatarCnpjCobranca(cfg.credor.cnpj)})`,
    `**Comprador:** ${e.sacadoNome} (CNPJ ${formatarCnpjCobranca(s.sacado_matriz_cnpj)})`,
    `**Causa:** ${CAUSA_LABEL[s.causa] ?? s.causa} · **Data da Perda:** ${formatarDataBr(s.data_perda)}` +
      (s.data_limite_envio ? ` · **Envio até:** ${formatarDataBr(s.data_limite_envio)}` : ''),
    `**Cobrança:** ${e.cobranca?.codigo ?? '—'} · **Seguradora notificada em:** ${dataOuTraco(s.notificado_em)}`,
    '',
    '## 1. Títulos',
    '',
    '| Título | NF | Devedora | Cedente | Vencimento | Valor de face | Valor cedido |',
    '|---|---|---|---|---|---:|---:|',
    ...e.titulos.map(
      (x) =>
        `| ${celula(x.t?.numero ?? x.t?.externo_id)} | ${celula(x.t?.nf_chave_acesso?.slice(25, 34).replace(/^0+/, '') || null)} | ${celula(x.t?.sacado_nome ?? (x.t ? formatarCnpjCobranca(x.t.sacado_cnpj) : null))} | ${celula(x.t?.cedente_nome ?? (x.t ? formatarCnpjCobranca(x.t.cedente_cnpj) : null))} | ${dataOuTraco(x.t?.vencimento)} | ${formatarBrl(Number(x.valor_face))} | ${x.valor_cedido === null ? '—' : formatarBrl(Number(x.valor_cedido))} |`,
    ),
    '',
    `**Total de face:** ${formatarBrl(Number(s.valor_total_face))} · **Recebido antes da perda:** ${formatarBrl(Number(s.valor_recebido_parcial ?? 0))}`,
    '',
    '## 2. Cronologia',
    '',
  ]

  const cronologia = await cronologiaDoSinistro(s.id, s.cobranca_id)
  if (cronologia.length) {
    md.push('| Data | Evento | Detalhe |', '|---|---|---|')
    for (const c of cronologia) md.push(`| ${c.quando} | ${celula(c.titulo)} | ${celula(c.detalhe)} |`)
  } else {
    md.push('Nenhum evento registrado.')
  }

  md.push('', '## 3. Memória da perda (cl. 22100.20 §3)', '')
  const mem = s.memoria_perda as { memoria?: { rotulo: string; valor: number; sinal: string; origem: string }[]; avisos?: string[] } | null
  if (mem?.memoria?.length) {
    md.push('| Linha | Operação | Valor | Origem |', '|---|:---:|---:|---|')
    for (const l of mem.memoria) md.push(`| ${celula(l.rotulo)} | ${celula(l.sinal)} | ${formatarBrl(Number(l.valor))} | ${celula(l.origem)} |`)
    if (mem.avisos?.length) md.push('', ...mem.avisos.map((a) => `- ${a}`))
  } else {
    md.push('A memória da perda ainda não foi calculada na tela do sinistro.')
  }
  md.push(
    '',
    `**Perda segurada estimada:** ${s.perda_segurada_estimada === null ? '—' : formatarBrl(Number(s.perda_segurada_estimada))} · ` +
      `**Indenização estimada:** ${s.indenizacao_estimada === null ? '—' : formatarBrl(Number(s.indenizacao_estimada))}`,
  )
  if (s.justificativa_prova_entrega?.trim()) {
    md.push('', '## 4. Prova de entrega', '', `Justificativa da ausência: ${s.justificativa_prova_entrega.trim()}`)
  }
  return md.join('\n')
}

/**
 * Todo fato da cobrança e do sinistro, em ordem: os eventos de `empresa_eventos` que
 * citam a cobrança ou o sinistro no payload, e os contatos registrados à mão
 * (`cobranca_interacoes`). "Cobramos" só vale como prova com data.
 */
async function cronologiaDoSinistro(
  sinistroId: string,
  cobrancaId: string | null,
): Promise<{ em: string; quando: string; titulo: string; detalhe: string | null }[]> {
  const filtro = cobrancaId
    ? `payload->>cobranca_id.eq.${cobrancaId},payload->>sinistro_id.eq.${sinistroId}`
    : `payload->>sinistro_id.eq.${sinistroId}`
  const { data: eventos, error } = await supabaseAdmin
    .from('empresa_eventos')
    .select('tipo, payload, criado_em')
    .or(filtro)
    .order('criado_em')
    .limit(2000)
  if (error) logger.warn({ erro: error.message }, 'Cronologia do dossiê sem eventos.')

  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
  const out = (eventos ?? []).map((ev) => {
    const p = (ev.payload ?? {}) as { titulo?: string; resumo?: string }
    return { em: ev.criado_em, quando: fmt.format(new Date(ev.criado_em)), titulo: p.titulo ?? ev.tipo, detalhe: p.resumo ?? null }
  })

  if (cobrancaId) {
    const { data: interacoes } = await supabaseAdmin
      .from('cobranca_interacoes')
      .select('tipo, resumo, ocorrida_em')
      .eq('cobranca_id', cobrancaId)
    for (const i of interacoes ?? []) {
      out.push({ em: i.ocorrida_em, quando: fmt.format(new Date(i.ocorrida_em)), titulo: `Contato (${i.tipo})`, detalhe: i.resumo })
    }
  }
  return out.sort((a, b) => a.em.localeCompare(b.em))
}
