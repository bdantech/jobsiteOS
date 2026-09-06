import { resolverConfig } from '../../../../../packages/core/src/comercial/meu-dia.js'
import { notify } from '../../../../../packages/core/src/server/notify.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * O resumo matinal do Meu Dia (04p §5).
 *
 * "Bom dia — 12 itens, 3 urgentes, R$ 340k em jogo", com deep link para a tela. Roda às
 * 8h de São Paulo, em dia útil.
 *
 * DUAS DECISÕES QUE DECIDEM SE ISTO VIRA RUÍDO OU HÁBITO:
 *
 *   DIA VAZIO NÃO NOTIFICA. Um push dizendo "nada para hoje" é o começo do fim de
 *   qualquer notificação: ensina que a mensagem não precisa ser aberta, e a lição vale
 *   também para os dias em que ela precisava. O silêncio aqui é informação.
 *
 *   O NÚMERO VEM DO MESMO AGREGADOR DA TELA. `app__md_montar` é a função que o
 *   `meu_dia()` da tela chama depois de autorizar. Se o push contasse por conta própria,
 *   a pessoa abriria o app atrás de doze itens e encontraria nove — e a partir daí não
 *   abriria mais.
 */

export interface ResultadoResumoMeuDia {
  vendedores: number
  notificados: number
  sem_itens: number
  desligados: number
}

interface LinhaVendedor {
  id: string
  tipo: string
  usuario_id: string
  prefs: { resumo_meu_dia?: boolean } | null
}

interface BlocoBruto {
  tipo: string
  itens: { urgencia: string }[]
  valor_total: number
}

const brl = (n: number) =>
  n >= 1000
    ? `R$ ${Math.round(n / 1000).toLocaleString('pt-BR')}k`
    : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

export async function resumoMeuDiaJob(): Promise<ResultadoResumoMeuDia> {
  const out: ResultadoResumoMeuDia = { vendedores: 0, notificados: 0, sem_itens: 0, desligados: 0 }

  const { data: cfgs } = await supabaseAdmin.from('meu_dia_config').select('tipo_vendedor, blocos')
  const overridesPorCargo = new Map(
    (cfgs ?? []).map((c) => [c.tipo_vendedor, (c.blocos ?? {}) as Record<string, never>]),
  )

  /*
   * O auxiliar do closer ENTRA, e recebe o mesmo resumo do superior — os dois trabalham
   * a mesma fila, e avisar só um deles faria a pessoa que abre o app primeiro achar que
   * a lista é dela sozinha. `is_ia` sai: um vendedor de IA não tem manhã.
   */
  const { rows } = await pool.query<LinhaVendedor>(
    `select v.id, v.tipo, u.id as usuario_id, u.prefs_notificacoes as prefs
     from vendedores v
     join usuarios u on u.id = v.usuario_id
     where v.ativo and u.ativo and not v.is_ia
       and v.tipo in ('sdr', 'vendedor', 'originador', 'auxiliar')`,
  )

  for (const v of rows) {
    out.vendedores += 1

    // Ausência de preferência é "sim": quem nunca abriu as configurações não escolheu
    // ficar de fora. Só o `false` explícito desliga.
    if (v.prefs?.resumo_meu_dia === false) {
      out.desligados += 1
      continue
    }

    try {
      /*
       * O ALVO do auxiliar é o closer dele — a mesma resolução que a tela faz. Sem isto
       * o auxiliar receberia um resumo do próprio cadastro, que é sempre vazio: quem
       * titulariza conta é o superior.
       */
      const { rows: alvoRows } = await pool.query<{ alvo: string; cargo: string }>(
        `select coalesce(s.superior_id, s.id) as alvo,
                case when s.tipo = 'auxiliar' then 'vendedor' else s.tipo end as cargo
         from vendedores s where s.id = $1`,
        [v.id],
      )
      const alvo = alvoRows[0]
      if (!alvo) continue

      const config = resolverConfig(alvo.cargo, overridesPorCargo.get(alvo.cargo) ?? {})

      const { data, error } = await supabaseAdmin.rpc('app__md_montar' as never, {
        p_alvo: alvo.alvo,
        p_config: config,
      } as never)
      if (error) throw new Error(error.message)

      const blocos = ((data as { blocos?: BlocoBruto[] })?.blocos ?? []) as BlocoBruto[]
      const itens = blocos.reduce((s, b) => s + b.itens.length, 0)
      const urgentes = blocos.reduce(
        (s, b) => s + b.itens.filter((i) => i.urgencia === 'alta').length,
        0,
      )
      const emJogo = blocos.reduce((s, b) => s + Number(b.valor_total ?? 0), 0)

      if (itens === 0) {
        out.sem_itens += 1
        continue
      }

      const partes = [`${itens} ${itens === 1 ? 'item' : 'itens'}`]
      if (urgentes > 0) partes.push(`${urgentes} ${urgentes === 1 ? 'urgente' : 'urgentes'}`)
      if (emJogo > 0) partes.push(`${brl(emJogo)} em jogo`)

      await notify(supabaseAdmin, [v.usuario_id], {
        titulo: 'Bom dia',
        corpo: partes.join(', '),
        url: '/comercial/meu-dia',
      })
      out.notificados += 1
    } catch (e) {
      // Um vendedor que falha não pode calar a manhã dos outros.
      logger.error({ vendedor: v.id, erro: String(e) }, 'Falha ao montar o resumo do Meu Dia.')
    }
  }

  logger.info(out, 'Resumo matinal do Meu Dia enviado.')
  return out
}
