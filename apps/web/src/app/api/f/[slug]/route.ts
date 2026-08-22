import { createHash } from 'node:crypto'
import { after, NextResponse } from 'next/server'
import {
  decidirDestino,
  rotearInbound,
  normalizarEmail,
  normalizarTelefone,
  normalizarUtm,
  rotuloDaIntencao,
  submissaoSchema,
  validarSubmissao,
  type CandidatoInbound,
  type Campo,
  type Json,
} from '@jobsiteos/core'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispararEnriquecerLeads } from '@/lib/mercado/worker'

export const dynamic = 'force-dynamic'

/**
 * A porta aberta para a internet (04i §5).
 *
 * Tudo aqui parte de uma premissa: qualquer um pode chamar isto, quantas vezes
 * quiser, com qualquer corpo. Por isso a ordem das defesas é rate limit → validação →
 * gravação, e por isso NADA se perde em silêncio: até o spam vira linha, porque uma
 * porta que descarta sem registro é uma porta em que ninguém confia no dia em que um
 * lead real "sumiu".
 *
 * A resposta é sempre 200 para spam. O bot não pode aprender o que o denunciou, e um
 * humano que caiu como falso-positivo não vê erro nenhum — ele vê a tela de sucesso, e
 * a linha em `descartada_spam` deixa o rastro para alguém achar depois.
 */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

/** Janela e tetos do rate limit. Generosos: erram para o lado de deixar passar. */
const JANELA_MIN = 10
const MAX_POR_IP = 5
const MAX_POR_CNPJ = 3

function hashIp(req: Request): string | null {
  const bruto =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip')
  if (!bruto) return null
  // Hash com sal do ambiente: o IP serve para limitar e para investigar abuso, e
  // nunca precisou ser legível. Sem sal, um hash de IPv4 é reversível por força
  // bruta em segundos — são só 4 bilhões de valores.
  const sal = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'jobsiteos'
  return createHash('sha256').update(`${sal}:${bruto}`).digest('hex').slice(0, 32)
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const supabase = createAdminClient()

  let corpo: unknown
  try {
    corpo = await req.json()
  } catch {
    return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400, headers: CORS })
  }

  // O formulário completo (não o recorte público): daqui saem o vendedor de destino,
  // o toggle de enriquecimento pago e a regra de consentimento.
  const { data: form } = await supabase
    .from('formularios')
    .select('*')
    .eq('slug', slug)
    .eq('ativo', true)
    .maybeSingle()

  if (!form) {
    return NextResponse.json({ erro: 'Formulário não encontrado.' }, { status: 404, headers: CORS })
  }

  const bruto = corpo as Record<string, unknown>
  const utm = normalizarUtm((bruto.utm as Record<string, unknown>) ?? bruto)
  const parsed = submissaoSchema.safeParse({ ...bruto, ...utm })
  if (!parsed.success) {
    return NextResponse.json({ erro: 'Dados inválidos.' }, { status: 400, headers: CORS })
  }
  const entrada = parsed.data
  const campos = (form.campos ?? []) as Campo[]
  const ipHash = hashIp(req)

  // ─── Rate limit ───────────────────────────────────────────────────────────
  // Por IP e por CNPJ, porque são dois abusos diferentes: uma botnet troca de IP e
  // mantém o CNPJ; um script bobo mantém o IP e sorteia CNPJ.
  const desde = new Date(Date.now() - JANELA_MIN * 60_000).toISOString()
  if (ipHash) {
    const { count } = await supabase
      .from('formulario_submissoes')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('criada_em', desde)
    if ((count ?? 0) >= MAX_POR_IP) {
      return NextResponse.json(
        { erro: 'Muitos envios seguidos. Tente de novo em alguns minutos.' },
        { status: 429, headers: CORS },
      )
    }
  }

  const validacao = validarSubmissao(entrada, campos, form.consentimento_obrigatorio)

  // ─── Spam: grava e responde sucesso ───────────────────────────────────────
  if (!validacao.ok && validacao.silencioso) {
    await supabase.rpc('app_processar_submissao', {
      p: {
        formulario_id: form.id,
        slug,
        dados: entrada.dados as Json,
        campos_snapshot: campos as unknown as Json,
        status: 'descartada_spam',
        motivo_revisao: validacao.motivo,
        ip_hash: ipHash,
        pagina_url: entrada.pagina_url,
        referrer: entrada.referrer,
        user_agent: req.headers.get('user-agent'),
        ...utm,
      },
    })
    return NextResponse.json({ ok: true }, { status: 200, headers: CORS })
  }

  if (!validacao.ok) {
    const mensagens: Record<string, string> = {
      cnpj_invalido: 'Confira o CNPJ — os dígitos não fecham.',
      email_invalido: 'Confira o e-mail.',
      consentimento_ausente: 'É preciso aceitar os termos para continuar.',
      campo_obrigatorio: 'Preencha os campos obrigatórios.',
    }
    return NextResponse.json(
      { erro: mensagens[validacao.motivo ?? ''] ?? 'Dados inválidos.', campo: validacao.campo },
      { status: 400, headers: CORS },
    )
  }

  const cnpj = validacao.cnpj!

  const { count: porCnpj } = await supabase
    .from('formulario_submissoes')
    .select('id', { count: 'exact', head: true })
    .eq('cnpj', cnpj)
    .gte('criada_em', desde)
  if ((porCnpj ?? 0) >= MAX_POR_CNPJ) {
    return NextResponse.json({ ok: true }, { status: 200, headers: CORS })
  }

  // ─── Supressão: não bloqueia, manda para revisão ──────────────────────────
  const email = normalizarEmail(entrada.dados.email)
  const { data: sup } = await supabase
    .from('supressao')
    .select('motivo')
    .or(`and(escopo.eq.empresa,valor.eq.${cnpj})${email ? `,and(escopo.eq.email,valor.eq.${email})` : ''}`)
    .limit(1)
    .maybeSingle()

  const destino = decidirDestino({ suprimido: !!sup, motivoSupressao: sup?.motivo ?? null })

  // ─── Quem atende ──────────────────────────────────────────────────────────
  const rota = destino.criarLead
    ? await escolherAtendente(supabase, entrada.dados, form.vendedor_destino_id)
    : { vendedorId: null, aviso: null }
  const rotulo = rotuloDaIntencao(entrada.intencao ?? null)

  const { data: resultado, error: erroRpc } = await supabase.rpc('app_processar_submissao', {
    p: {
      formulario_id: form.id,
      slug,
      cnpj,
      dados: entrada.dados as Json,
      campos_snapshot: campos as unknown as Json,
      intencao: entrada.intencao ?? null,
      status: destino.status,
      // O aviso de roteamento viaja no mesmo campo do motivo de revisão: os dois são
      // "o que uma pessoa precisa saber sobre esta submissão", e a tela já os mostra.
      motivo_revisao: destino.motivoRevisao ?? rota.aviso,
      criar_lead: destino.criarLead,
      sdr_id: rota.vendedorId,
      tipagem_antecipacao: rotulo.tipagemAntecipacao,
      razao_social: texto(entrada.dados.razao_social),
      uf: texto(entrada.dados.uf)?.toUpperCase().slice(0, 2) ?? null,
      municipio: texto(entrada.dados.municipio),
      erp_atual: texto(entrada.dados.erp_atual),
      nome: texto(entrada.dados.nome),
      cargo: texto(entrada.dados.cargo),
      email,
      telefone: normalizarTelefone(entrada.dados.telefone),
      whatsapp: normalizarTelefone(entrada.dados.whatsapp),
      consentimento_aceito: entrada.consentimento_aceito ?? null,
      ip_hash: ipHash,
      pagina_url: entrada.pagina_url,
      referrer: entrada.referrer,
      user_agent: req.headers.get('user-agent'),
      ...utm,
    },
  })

  if (erroRpc) {
    /*
     * Falha DEPOIS de a pessoa apertar enviar: registra `erro` com a mensagem para a
     * fila de revisão e responde 200. Mandar a pessoa preencher de novo por um
     * problema nosso é a forma mais cara de perder um lead que já quis vir.
     */
    await supabase.from('formulario_submissoes').insert({
      formulario_id: form.id,
      dados: entrada.dados as Json,
      campos_snapshot: campos as unknown as Json,
      cnpj,
      status: 'erro',
      erro: erroRpc.message,
      ip_hash: ipHash,
      pagina_url: entrada.pagina_url,
      ...utm,
    })
    return NextResponse.json({ ok: true }, { status: 200, headers: CORS })
  }

  /*
   * Acorda o enriquecimento SEM segurar a resposta — mas com `after()`, não com uma
   * promessa solta.
   *
   * A primeira versão fazia `void dispararEnriquecerLeads()`. Numa função serverless
   * isso não é "rodar em segundo plano": é começar um fetch e devolver a resposta, e a
   * plataforma pode congelar a invocação no instante seguinte. Foi o que aconteceu em
   * 22/08/2026 — três leads seguidos ficaram pendentes e só foram enriquecidos pelo cron
   * da hora cheia, com até uma hora de atraso. O disparo imediato simplesmente não
   * acontecia, e nada no código dizia isso.
   *
   * `after()` registra a tarefa no runtime: a resposta vai embora na hora e a invocação
   * fica viva até o trabalho terminar. É a diferença entre pedir para o navegador esperar
   * (o que seria injusto com quem preencheu) e torcer para o processo sobreviver (o que
   * não é uma estratégia).
   *
   * Continua best-effort: o worker devolve 202 na hora, e se ele estiver fora do ar o
   * lead JÁ está gravado e roteado — o cron varre o que ficar pendente.
   */
  const submissaoId = (resultado as { submissao_id?: string } | null)?.submissao_id ?? null

  after(
    (async () => {
      const r = await dispararEnriquecerLeads()

      /*
       * O RESULTADO DO DISPARO FICA GRAVADO — inclusive o sucesso.
       *
       * A primeira versão fazia `.catch(() => undefined)` e jogava fora o retorno.
       * `postar()` NÃO lança quando o worker recusa: ele devolve `{ ok: false }`. Ou
       * seja, um worker fora do ar, um 401 de segredo trocado ou um 409 de job já em
       * execução produziam exatamente o mesmo que sucesso — silêncio. Três testes
       * seguidos não enriqueceram e não havia uma linha em lugar nenhum dizendo por quê.
       *
       * Gravar o SUCESSO também é diagnóstico, e não enfeite: se a linha ficar só com
       * `disparo.ok = true` e nunca ganhar o diário das etapas, isso aponta o dedo para o
       * worker — ele aceitou o job e não o executou. Sem esse registro, "aceitou e não
       * rodou" e "nunca foi chamado" são indistinguíveis.
       */
      if (!r.ok) {
        console.error('[leads] worker recusou o enriquecimento', {
          submissao: submissaoId,
          code: r.code,
        })
      }
      if (submissaoId) {
        await supabase
          .from('formulario_submissoes')
          .update({
            enriquecimento_resultado: {
              disparo: {
                ok: r.ok,
                em: new Date().toISOString(),
                detalhe: r.ok ? 'Worker aceitou o job (202).' : r.message,
              },
            } as never,
          })
          .eq('id', submissaoId)
      }
    })().catch((e) => {
      console.error('[leads] falha ao acordar o enriquecimento', { erro: String(e) })
    }),
  )

  return NextResponse.json({ ok: true, submissao: submissaoId }, { status: 200, headers: CORS })
}

function texto(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

/**
 * Quem recebe o lead. A cascata mora em packages/core (`rotearInbound`, com testes);
 * aqui só se busca o que ela precisa saber.
 *
 * Carrega TODOS os vendedores ativos, não só os SDRs: os degraus de baixo da cascata
 * precisam deles. Na primeira submissão real da base não havia SDR nenhum, o roteador
 * antigo devolveu null e o lead virou empresa e contato sem entrar em funil algum.
 */
async function escolherAtendente(
  supabase: ReturnType<typeof createAdminClient>,
  dados: Record<string, unknown>,
  destinoDoFormulario: string | null,
): Promise<{ vendedorId: string | null; aviso: string | null }> {
  const { data: vendedores } = await supabase
    .from('vendedores')
    .select('id, nome, tipo, settings')
    .eq('ativo', true)
  if (!vendedores?.length) return { vendedorId: null, aviso: 'Nenhum vendedor ativo para receber o lead.' }

  const ids = vendedores.map((v) => v.id)
  const [{ data: terrs }, { data: leads }] = await Promise.all([
    supabase
      .from('vendedor_territorios')
      .select('vendedor_id, ufs, faturamento_min, faturamento_max')
      .in('vendedor_id', ids),
    supabase.from('sdr_leads').select('sdr_id').is('encerrado_em', null),
  ])

  const porVendedor = new Map((terrs ?? []).map((t) => [t.vendedor_id, t]))
  const carga = new Map<string, number>()
  for (const l of leads ?? []) carga.set(l.sdr_id, (carga.get(l.sdr_id) ?? 0) + 1)

  const candidatos: CandidatoInbound[] = vendedores.map((v) => {
    const s = (v.settings ?? {}) as { direcao?: string }
    const t = porVendedor.get(v.id)
    return {
      id: v.id,
      nome: v.nome,
      ehSdr: v.tipo === 'sdr',
      direcao: s.direcao === 'in' || s.direcao === 'out' ? s.direcao : 'both',
      ufs: (t?.ufs ?? []) as string[],
      faturamentoMin: t?.faturamento_min == null ? null : Number(t.faturamento_min),
      faturamentoMax: t?.faturamento_max == null ? null : Number(t.faturamento_max),
      carga: carga.get(v.id) ?? 0,
    }
  })

  const faturamento = Number(dados.faturamento_declarado)
  const r = rotearInbound(
    candidatos,
    {
      uf: texto(dados.uf)?.toUpperCase().slice(0, 2) ?? null,
      faturamento: Number.isFinite(faturamento) && faturamento > 0 ? faturamento : null,
    },
    destinoDoFormulario,
  )
  return { vendedorId: r.vendedorId, aviso: r.aviso }
}
