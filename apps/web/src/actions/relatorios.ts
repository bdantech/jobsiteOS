'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dispararReportSemanal } from '@/lib/mercado/worker'

/**
 * As ações da aba Relatórios (04q §3 e §5).
 *
 * Todas passam por `app_report_gestor()`, a mesma régua da RLS: gestor é quem tem o módulo
 * Comercial e NÃO é vendedor. Checar aqui e deixar o banco checar de novo não é redundância
 * — é o que faz a tela dar uma mensagem em português em vez de um erro de policy.
 */

export type ResultadoRelatorio = { ok: true; dados?: unknown } | { ok: false; message: string }

async function autorizar() {
  const context = await getSessionContext()
  if (!context) return { erro: { ok: false, message: 'Sua sessão expirou. Entre novamente.' } as const }
  const supabase = await createClient()
  const { data } = await supabase.rpc('app_report_gestor' as never, {} as never)
  if (data !== true) {
    return {
      erro: {
        ok: false,
        message: 'Relatórios é leitura de gestor — ele mostra a carteira inteira e a comissão de cada pessoa.',
      } as const,
    }
  }
  return { erro: null, supabase, usuarioId: context.usuario.id }
}

const configSchema = z.object({
  destinatarios: z
    .array(z.object({ email: z.string().email('E-mail inválido.'), nome: z.string().optional() }))
    .max(30, 'Trinta destinatários é o teto: acima disso, o report virou lista de distribuição.'),
  dias_semana: z.array(z.number().int().min(1).max(7)).min(1, 'Escolha ao menos um dia.'),
  horario: z.string().regex(/^\d{2}:\d{2}$/, 'Horário no formato HH:MM.'),
  ativo: z.boolean(),
  assunto_template: z.string().max(200).nullable(),
})

export async function salvarConfigReportAction(
  entrada: z.infer<typeof configSchema>,
): Promise<ResultadoRelatorio> {
  const a = await autorizar()
  if (a.erro) return a.erro

  const parse = configSchema.safeParse(entrada)
  if (!parse.success) {
    return { ok: false, message: parse.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  const { error } = await a.supabase
    .from('report_config')
    .update({
      destinatarios: parse.data.destinatarios as never,
      dias_semana: parse.data.dias_semana,
      horario: parse.data.horario,
      ativo: parse.data.ativo,
      assunto_template: parse.data.assunto_template,
      atualizado_por: a.usuarioId,
      atualizado_em: new Date().toISOString(),
    })
    .eq('tipo', 'semanal_executivo')
  if (error) return { ok: false, message: error.message }

  revalidatePath('/comercial/relatorios')
  return { ok: true }
}

/**
 * "Gerar PDF agora": gera, guarda e NÃO envia.
 *
 * Síncrono porque quem clicou está com a tela aberta esperando o link. O mesmo job do
 * cron, com `enviar: false` — um segundo caminho de geração seria um segundo lugar onde
 * os números podem divergir.
 */
export async function gerarPreviaAction(
  inicio?: string,
  fim?: string,
): Promise<ResultadoRelatorio> {
  const a = await autorizar()
  if (a.erro) return a.erro

  const r = await dispararReportSemanal({
    inicio, fim, enviar: false, criadoPor: a.usuarioId, sincrono: true,
  })
  if (!r.ok) return { ok: false, message: r.message }

  revalidatePath('/comercial/relatorios')
  return { ok: true, dados: r.corpo }
}

/** "Enviar teste agora": manda só para quem clicou, com o mesmo PDF e o mesmo corpo. */
export async function enviarTesteAction(email: string): Promise<ResultadoRelatorio> {
  const a = await autorizar()
  if (a.erro) return a.erro
  if (!z.string().email().safeParse(email).success) {
    return { ok: false, message: 'E-mail inválido.' }
  }

  const r = await dispararReportSemanal({
    enviar: true,
    destinatariosTeste: [{ email }],
    criadoPor: a.usuarioId,
    sincrono: true,
  })
  if (!r.ok) return { ok: false, message: r.message }

  revalidatePath('/comercial/relatorios')
  return { ok: true, dados: r.corpo }
}
