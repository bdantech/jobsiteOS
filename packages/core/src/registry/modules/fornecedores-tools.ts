import { z } from 'zod'
import {
  CONFIANCA_LABELS,
  ESTAGIO_FORNECEDOR_LABELS,
  FONTE_CONTATO_LABELS,
  TIPO_CONTATO_LABELS,
  TEMPLATE_PADRAO,
  ordenarSacadosParaPedido,
  renderizarApresentacao,
  type Confianca,
  type EstagioFornecedor,
  type FonteContato,
  type TipoContatoDescoberto,
} from '../../fornecedores/index.js'
import { normalizeCnpj } from '../../schemas/cnpj.js'
import type { ModuleTool, ToolContext } from '../types.js'

/**
 * Tools do funil de cadastro de fornecedores (04l §7).
 *
 * Ficam em arquivo próprio, e não dentro de `comercial.ts`, porque são um domínio
 * inteiro — funil, cascata de descoberta e pedido de apresentação — que só divide o
 * módulo com a comissão por conveniência de menu.
 *
 * ─── UMA MUTAÇÃO GASTA DINHEIRO, E POR ISSO ELA NÃO EXISTE AQUI ──────────────
 *
 * `fornecedores.buscar_contatos` está na spec e está implementada — mas ela roda no
 * WORKER, e o worker não tem sessão de usuário. A tool aqui PLANEJA o clique: diz
 * quanto vai custar, quais provedores rodam e quanto sobra do teto. Executar continua
 * exigindo o botão, com o número na frente da pessoa.
 *
 * Não é limitação técnica: é a mesma razão de o custo aparecer antes da confirmação
 * na tela. Um modelo que decide sozinho gastar R$ 1,65 no teto de alguém é exatamente
 * o "agente autônomo decidindo quem buscar" que o §8 põe fora de escopo.
 */

const brl = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const cnpjSchema = z
  .string()
  .transform(normalizeCnpj)
  .refine((v) => /^\d{14}$/.test(v), 'CNPJ precisa ter 14 dígitos.')

// ─── meu_funil ──────────────────────────────────────────────────────────────

const meuFunilSchema = z.object({
  estagio: z
    .enum(['a_cadastrar', 'em_prospeccao', 'aguardando_retorno', 'sem_contato'])
    .optional()
    .describe('Filtra por estágio. Omitido, traz todos os ativos.'),
  limite: z.number().int().min(1).max(50).default(15),
})

interface LinhaFunil {
  fornecedor_cnpj: string | null
  fornecedor_nome: string | null
  municipio: string | null
  uf: string | null
  estagio: string | null
  potencial_mensal: number | null
  volume_90d: number | null
  qtd_nfs_90d: number | null
  prazo_medio_dias: number | null
  contatos_encontrados: number | null
  melhor_confianca: string | null
  originador_nome: string | null
  ultima_nf_em: string | null
  sacados_principais: unknown
}

async function meuFunil(input: z.infer<typeof meuFunilSchema>, ctx: ToolContext) {
  let q = ctx.supabase
    .from('fornecedores_funil_view')
    // Uma string literal só. Concatenar quebra a inferência de tipos do PostgREST e o
    // resultado vira GenericStringError — a mesma cicatriz do 04k.
    .select('fornecedor_cnpj, fornecedor_nome, municipio, uf, estagio, potencial_mensal, volume_90d, qtd_nfs_90d, prazo_medio_dias, contatos_encontrados, melhor_confianca, originador_nome, ultima_nf_em, sacados_principais')
    .order('potencial_mensal', { ascending: false, nullsFirst: false })
    .limit(input.limite)

  q = input.estagio
    ? q.eq('estagio', input.estagio)
    : q.not('estagio', 'in', '("cadastrado","sem_interesse")')

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const linhas = (data ?? []) as LinhaFunil[]
  if (linhas.length === 0) {
    return {
      total: 0,
      aviso:
        'Nenhum fornecedor no seu funil. A lista é recortada por originador: você vê os ' +
        'fornecedores cujos sacados estão na sua carteira de originação.',
    }
  }

  return {
    total: linhas.length,
    potencial_total: brl(linhas.reduce((s, l) => s + (Number(l.potencial_mensal) || 0), 0)),
    fornecedores: linhas.map((l) => ({
      cnpj: l.fornecedor_cnpj,
      nome: l.fornecedor_nome,
      onde: [l.municipio, l.uf].filter(Boolean).join('/') || null,
      estagio: ESTAGIO_FORNECEDOR_LABELS[(l.estagio ?? '') as EstagioFornecedor] ?? l.estagio,
      potencial_mensal: brl(l.potencial_mensal),
      volume_90d: brl(l.volume_90d),
      notas_90d: l.qtd_nfs_90d,
      prazo_medio_dias: l.prazo_medio_dias,
      contatos: l.contatos_encontrados ?? 0,
      melhor_confianca: l.melhor_confianca
        ? (CONFIANCA_LABELS[l.melhor_confianca as Confianca] ?? l.melhor_confianca)
        : 'nenhum contato',
      originador: l.originador_nome ?? 'sem dono',
      ultima_nf_em: l.ultima_nf_em,
      sacados: Array.isArray(l.sacados_principais)
        ? (l.sacados_principais as { nome: string | null; valor: number }[])
            .slice(0, 3)
            .map((s) => `${s.nome ?? '—'} (${brl(s.valor)})`)
        : [],
    })),
    como_ler:
      'Potencial mensal é o volume de 90 dias dividido por três: quanto o fornecedor fatura ' +
      'por mês contra nossos sacados, não quanto ele vai antecipar. O limite do sacado não ' +
      'entra na conta — ele é o teto da operação, não do lead.',
  }
}

// ─── contatos + plano do clique ─────────────────────────────────────────────

const contatosSchema = z.object({ cnpj: cnpjSchema })

async function contatosDoFornecedor(input: z.infer<typeof contatosSchema>, ctx: ToolContext) {
  const [funil, contatos, config] = await Promise.all([
    ctx.supabase
      .from('fornecedores_funil_view')
      .select('fornecedor_nome, estagio, melhor_confianca, contatos_encontrados, dominio, ultima_busca_em, descoberta_automatica_em')
      .eq('fornecedor_cnpj', input.cnpj)
      .maybeSingle(),
    ctx.supabase
      .from('contatos_descobertos')
      .select('tipo, valor, nome_pessoa, cargo, fonte, confianca, evidencia, frequencia, ultima_vez_visto, validado, promovido_contato_id')
      .eq('fornecedor_cnpj', input.cnpj),
    ctx.supabase.from('fornecedores_config').select('chave, valor'),
  ])

  if (funil.error) throw new Error(funil.error.message)
  if (!funil.data) {
    return {
      encontrado: false,
      aviso: 'Este fornecedor não está no seu funil (ou não está no funil de ninguém).',
    }
  }
  if (contatos.error) throw new Error(contatos.error.message)

  const cfg = Object.fromEntries((config.data ?? []).map((c) => [c.chave, c.valor]))
  const custos = (cfg.custos ?? {}) as Record<string, number>
  const jaTemAlta = funil.data.melhor_confianca === 'alta'

  const peso: Record<string, number> = { alta: 3, media: 2, baixa: 1 }
  const lista = (contatos.data ?? []).sort(
    (a, b) => (peso[b.confianca] ?? 0) - (peso[a.confianca] ?? 0) || b.frequencia - a.frequencia,
  )

  return {
    encontrado: true,
    fornecedor: funil.data.fornecedor_nome,
    estagio: ESTAGIO_FORNECEDOR_LABELS[(funil.data.estagio ?? '') as EstagioFornecedor] ?? funil.data.estagio,
    contatos: lista.map((c) => ({
      tipo: TIPO_CONTATO_LABELS[c.tipo as TipoContatoDescoberto] ?? c.tipo,
      valor: c.valor,
      pessoa: c.nome_pessoa,
      cargo: c.cargo,
      fonte: FONTE_CONTATO_LABELS[c.fonte as FonteContato] ?? c.fonte,
      confianca: CONFIANCA_LABELS[c.confianca as Confianca] ?? c.confianca,
      // A evidência é parte da resposta, não metadado: quem for ligar precisa saber se
      // o número veio do campo declarado à SEFAZ ou de uma página web.
      evidencia: c.evidencia,
      visto_vezes: c.frequencia,
      ultima_vez_visto: c.ultima_vez_visto,
      valida:
        typeof c.validado === 'object' && c.validado !== null
          ? ((c.validado as Record<string, unknown>).valido ?? null)
          : null,
      ja_na_ficha: Boolean(c.promovido_contato_id),
    })),
    proxima_busca: jaTemAlta
      ? {
          vale_a_pena: false,
          motivo: 'Já existe contato de confiança alta — a busca paga não roda e custaria zero.',
        }
      : {
          vale_a_pena: true,
          custo_estimado_teto: brl(
            (custos.novavida ?? 0.35) +
              (funil.data.dominio ? (custos.apollo ?? 1.2) : 0) +
              (custos.claude_busca ?? 0.1),
          ),
          observacao:
            'É o TETO: a cascata para na primeira fonte de confiança alta, então o clique pode ' +
            'custar menos. Quem aciona é a pessoa, no botão da tela — a tool não gasta o teto ' +
            'de ninguém.',
        },
    ultima_busca_paga: funil.data.ultima_busca_em,
    ultima_varredura_gratuita: funil.data.descoberta_automatica_em,
  }
}

// ─── pedir apresentação ─────────────────────────────────────────────────────

const apresentacaoSchema = z.object({
  cnpj: cnpjSchema.describe('CNPJ do fornecedor que queremos cadastrar.'),
  sacado_cnpj: cnpjSchema
    .optional()
    .describe('Sacado a quem pedir. Omitido, escolhe o que tem ponto focal e mais volume.'),
})

async function pedirApresentacaoTool(input: z.infer<typeof apresentacaoSchema>, ctx: ToolContext) {
  const [funil, config, usuario] = await Promise.all([
    ctx.supabase
      .from('fornecedores_funil_view')
      .select('fornecedor_nome, sacados_principais, volume_90d, qtd_nfs_90d, potencial_mensal')
      .eq('fornecedor_cnpj', input.cnpj)
      .maybeSingle(),
    ctx.supabase.from('fornecedores_config').select('chave, valor').eq('chave', 'template_apresentacao').maybeSingle(),
    ctx.supabase.from('usuarios').select('nome').eq('id', ctx.userId).maybeSingle(),
  ])

  if (funil.error) throw new Error(funil.error.message)
  if (!funil.data) return { criado: false, aviso: 'Este fornecedor não está no seu funil.' }

  const sacados = Array.isArray(funil.data.sacados_principais)
    ? (funil.data.sacados_principais as { cnpj: string; nome: string | null; valor: number }[])
    : []
  if (sacados.length === 0) {
    return { criado: false, aviso: 'Este fornecedor não tem sacado nosso na janela de 90 dias.' }
  }

  // O ponto focal decide a ordem: o pedido é um favor pessoal, e ele funciona com quem
  // atende — não com quem compra mais.
  const { data: empresas } = await ctx.supabase
    .from('empresas')
    .select('id, cnpj')
    .in('cnpj', sacados.map((s) => s.cnpj))
  const ids = (empresas ?? []).map((e) => e.id)
  const { data: focais } = ids.length
    ? await ctx.supabase.from('contatos').select('id, nome, empresa_id').in('empresa_id', ids).eq('ponto_focal', true)
    : { data: [] }

  const empresaPorCnpj = new Map((empresas ?? []).map((e) => [e.cnpj, e.id]))
  const focalPorEmpresa = new Map((focais ?? []).map((c) => [c.empresa_id, c]))

  const candidatos = ordenarSacadosParaPedido(
    sacados.map((s) => {
      const empresaId = empresaPorCnpj.get(s.cnpj)
      const focal = empresaId ? focalPorEmpresa.get(empresaId) : undefined
      return {
        cnpj: s.cnpj,
        nome: s.nome,
        valor: Number(s.valor) || 0,
        tem_ponto_focal: Boolean(focal),
        contato_id: focal?.id ?? null,
        contato_nome: focal?.nome ?? null,
      }
    }),
  )

  const alvo = input.sacado_cnpj
    ? candidatos.find((c) => c.cnpj === input.sacado_cnpj)
    : candidatos[0]
  if (!alvo) {
    return { criado: false, aviso: 'Esse sacado não está entre os principais deste fornecedor.' }
  }

  const template = typeof config.data?.valor === 'string' ? config.data.valor : TEMPLATE_PADRAO
  const mensagem = renderizarApresentacao(template, {
    fornecedor_nome: funil.data.fornecedor_nome,
    fornecedor_cnpj: input.cnpj,
    sacado_nome: alvo.nome,
    contato_sacado_nome: alvo.contato_nome,
    originador_nome: usuario.data?.nome ?? null,
    volume_90d: funil.data.volume_90d === null ? null : Number(funil.data.volume_90d),
    qtd_nfs_90d: funil.data.qtd_nfs_90d,
    potencial_mensal: funil.data.potencial_mensal === null ? null : Number(funil.data.potencial_mensal),
  })

  const { data, error } = await ctx.supabase.rpc('app_pedir_apresentacao', {
    p: {
      fornecedor_cnpj: input.cnpj,
      sacado_cnpj: alvo.cnpj,
      contato_sacado_id: alvo.contato_id,
      mensagem,
    } as never,
  })
  if (error) throw new Error(error.message)

  return {
    criado: true,
    pedido_id: (data as { id?: string } | null)?.id ?? null,
    sacado: alvo.nome ?? alvo.cnpj,
    contato: alvo.contato_nome,
    mensagem,
    aviso:
      'O pedido ficou como RASCUNHO. Nesta fase o texto é copiável — não existe canal de ' +
      'envio ainda (Prompt 05). Marque como enviado depois de mandar pelo seu canal.',
  }
}

// ─── promover ponto focal ───────────────────────────────────────────────────

const promoverSchema = z.object({
  contato_descoberto_id: z.string().uuid().describe('Id do contato descoberto, vindo de fornecedores.contatos.'),
})

async function promoverPontoFocal(input: z.infer<typeof promoverSchema>, ctx: ToolContext) {
  const { data, error } = await ctx.supabase.rpc('app_promover_contato_descoberto', {
    p: { contato_descoberto_id: input.contato_descoberto_id, ponto_focal: true } as never,
  })
  if (error) throw new Error(error.message)
  const c = data as { id?: string; nome?: string } | null
  return {
    promovido: true,
    contato_id: c?.id ?? null,
    nome: c?.nome ?? null,
    aviso:
      'Virou contato oficial da empresa e ponto focal. O ponto focal anterior, se havia, foi ' +
      'desmarcado — só existe um por empresa.',
  }
}

export const fornecedoresTools: ModuleTool[] = [
  {
    id: 'fornecedores.meu_funil',
    name: 'Meu funil de fornecedores',
    description:
      'Fornecedores que emitem nota contra os sacados da carteira de quem pergunta e ainda NÃO ' +
      'estão na plataforma, com a munição de abordagem: volume 90 dias, número de notas, prazo ' +
      'médio, potencial mensal e contra quem eles faturam. Ordenado por potencial. Use para ' +
      '"quem eu deveria cadastrar", "quais fornecedores valem uma ligação".',
    inputSchema: meuFunilSchema,
    execute: (input, ctx) => meuFunil(input as z.infer<typeof meuFunilSchema>, ctx),
    mutates: false,
  },
  {
    id: 'fornecedores.contatos',
    name: 'Contatos de um fornecedor',
    description:
      'Contatos descobertos de um fornecedor, COM fonte, confiança e evidência de cada um, mais ' +
      'o custo estimado de acionar a busca paga. NÃO executa a busca: quem gasta o teto é a ' +
      'pessoa, no botão da tela. Use para "por onde falo com a Fulana", "vale pagar busca aqui".',
    inputSchema: contatosSchema,
    execute: (input, ctx) => contatosDoFornecedor(input as z.infer<typeof contatosSchema>, ctx),
    mutates: false,
  },
  {
    id: 'fornecedores.pedir_apresentacao',
    name: 'Pedir apresentação ao sacado',
    description:
      'Monta e registra o pedido para que um sacado apresente o fornecedor. Escolhe sozinho o ' +
      'sacado com ponto focal conhecido e mais volume, salvo se um for informado. Cria RASCUNHO ' +
      'e devolve o texto para copiar — não envia nada.',
    inputSchema: apresentacaoSchema,
    execute: (input, ctx) => pedirApresentacaoTool(input as z.infer<typeof apresentacaoSchema>, ctx),
    mutates: true,
  },
  {
    id: 'fornecedores.promover_ponto_focal',
    name: 'Tornar contato ponto focal',
    description:
      'Promove um contato DESCOBERTO a contato oficial da empresa e o marca como ponto focal ' +
      '(desmarcando o anterior). Cria a ficha da empresa se ela ainda não existir.',
    inputSchema: promoverSchema,
    execute: (input, ctx) => promoverPontoFocal(input as z.infer<typeof promoverSchema>, ctx),
    mutates: true,
  },
]
