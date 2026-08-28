import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Feed .ics de um vendedor (04g §7).
 *
 * PÚBLICO por natureza: o Google e o Outlook buscam esta URL sem cabeçalho de
 * autenticação. O token É a credencial — aleatório, por vendedor, revogável gerando
 * outro. Por isso usa o client de service role: não há sessão de usuário numa
 * requisição feita pelo servidor do Google.
 *
 * O feed carrega só TÍTULO e HORÁRIO. Um link de assinatura vaza com facilidade (fica
 * salvo no celular pessoal, é reencaminhado num grupo), e o que vaza junto tem que ser
 * inócuo. Nome de empresa no título já é o limite; valor de proposta, nunca.
 *
 * Desde o Prompt 08 ele também carrega os PRAZOS E AUDIÊNCIAS do Jurídico da mesma
 * pessoa (§9). O elo é `usuarios.id`, não o vendedor: quem é vendedor e advogado é
 * uma pessoa só, e ela não vai assinar dois calendários.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Escapa o que quebra o formato: vírgula, ponto e vírgula, barra e quebra de linha. */
function ics(texto: string): string {
  return texto.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function carimbo(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params
  const supabase = createAdminClient()

  const { data: t } = await supabase
    .from('vendedor_ics_tokens')
    .select('vendedor_id, revogado_em')
    .eq('token', token)
    .maybeSingle()

  // 404 para token inexistente E para revogado: distinguir os dois diria a quem
  // tropeçou no link que ele existiu um dia, e para quem.
  if (!t || t.revogado_em) {
    return new NextResponse('Not found', { status: 404 })
  }

  const desde = new Date(Date.now() - 60 * 86_400_000).toISOString()

  const { data: eventos } = await supabase
    .from('vendedor_eventos')
    .select('id, titulo, inicio_em, duracao_min')
    .eq('vendedor_id', t.vendedor_id)
    .is('cancelado_em', null)
    .gte('inicio_em', desde)
    .order('inicio_em')
    .limit(500)

  /*
   * Os prazos e audiências do Jurídico entram no MESMO feed (08 §9).
   *
   * O elo é o USUÁRIO, não o vendedor: `vendedores.usuario_id` = `advogados.usuario_id`.
   * A pessoa é uma só, e ela não vai assinar dois calendários. Um advogado externo não
   * tem `usuario_id` e por isso não aparece em feed nenhum — ele também não tem sessão
   * na plataforma, então não haveria token para gerar.
   *
   * A mesma régua de discrição vale: título e horário, nada mais. O CNJ vai junto
   * porque é o que identifica a audiência na agenda de quem tem cinco no mesmo dia —
   * e é um número público, ao contrário do valor da causa.
   */
  const { data: vendedor } = await supabase
    .from('vendedores')
    .select('usuario_id')
    .eq('id', t.vendedor_id)
    .maybeSingle()

  const prazos = vendedor?.usuario_id
    ? (
        await supabase
          .from('juridico_agenda')
          .select('id, titulo, inicio_em, tipo, numero_cnj')
          .eq('responsavel_usuario_id', vendedor.usuario_id)
          .eq('concluido', false)
          .gte('inicio_em', desde)
          .order('inicio_em')
          .limit(500)
      ).data
    : null

  const linhas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//JobsiteOS//Comercial//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:JobsiteOS — Agenda',
  ]
  for (const e of eventos ?? []) {
    const fim = new Date(new Date(e.inicio_em).getTime() + (e.duracao_min ?? 60) * 60_000).toISOString()
    linhas.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@jobsiteos`,
      `DTSTAMP:${carimbo(new Date().toISOString())}`,
      `DTSTART:${carimbo(e.inicio_em)}`,
      `DTEND:${carimbo(fim)}`,
      `SUMMARY:${ics(e.titulo)}`,
      'END:VEVENT',
    )
  }
  for (const p of prazos ?? []) {
    if (!p.inicio_em || !p.id) continue
    // Uma hora de bloco por prazo: um evento de duração zero some da grade semanal do
    // Google, e o prazo que some é o que perde.
    const fim = new Date(new Date(p.inicio_em).getTime() + 60 * 60_000).toISOString()
    linhas.push(
      'BEGIN:VEVENT',
      `UID:${p.id}@jobsiteos-juridico`,
      `DTSTAMP:${carimbo(new Date().toISOString())}`,
      `DTSTART:${carimbo(p.inicio_em)}`,
      `DTEND:${carimbo(fim)}`,
      `SUMMARY:${ics(`${p.tipo === 'audiencia' ? 'Audiência' : p.tipo === 'pericia' ? 'Perícia' : 'Prazo'}: ${p.titulo ?? ''}`)}`,
      `DESCRIPTION:${ics(`Processo ${p.numero_cnj ?? ''}`)}`,
      'END:VEVENT',
    )
  }

  linhas.push('END:VCALENDAR')

  return new NextResponse(linhas.join('\r\n'), {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      // O Google recolhe o feed a cada poucas horas; um cache longo aqui faria a
      // reunião marcada agora só aparecer amanhã.
      'cache-control': 'public, max-age=300',
    },
  })
}
