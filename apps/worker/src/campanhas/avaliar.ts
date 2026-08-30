import {
  MOTIVOS_EXCLUSAO,
  avaliarDestinatario,
  contarExclusoes,
  resolverDestinatario,
  type MotivoExclusao,
  type DestinatarioResolvido,
  type TipoCampanha,
} from '../../../../packages/core/src/campanhas/index.js'
import type { CanalThread } from '../../../../packages/core/src/comunicacao/schemas.js'
import { coletarFatos } from './fatos.js'
import { montarPublico, type DefinicaoDoPublico } from './publico.js'

/**
 * O PASSO QUE A SIMULAÇÃO E A EXECUÇÃO COMPARTILHAM.
 *
 * Esta é a razão de o dry-run valer alguma coisa: a simulação e a materialização
 * chamam **a mesma função**. Se fossem dois caminhos, o §3 seria teatro — o
 * relatório mostraria um público e o envio alcançaria outro, e a divergência só
 * apareceria depois do disparo.
 *
 * O que a execução faz a mais é gravar; o que ela vê é idêntico.
 */

export interface CampanhaParaAvaliar extends DefinicaoDoPublico {
  id: string | null
  canal: CanalThread
  tipo: TipoCampanha
  excluir_contatados_dias: number
  excluir_conversa_aberta: boolean
}

export interface Elegivel {
  empresaId: string
  destinatario: DestinatarioResolvido
}

export interface PublicoAvaliado {
  descricao: string
  totalEmpresas: number
  elegiveis: Elegivel[]
  exclusoes: Record<MotivoExclusao, number>
  /** Empresas cujo motivo de exclusão foi este — para a lista da tela. */
  excluidas: { empresaId: string; contatoId: string | null; motivo: MotivoExclusao }[]
}

export async function avaliarPublico(
  c: CampanhaParaAvaliar,
  limites: { max_campanhas_por_contato_90d: number },
  agora = new Date(),
): Promise<PublicoAvaliado> {
  const publico = await montarPublico(c)
  const fatos = await coletarFatos({
    empresaIds: publico.empresaIds,
    canal: c.canal,
    campanhaId: c.id,
  })

  const elegiveis: Elegivel[] = []
  const excluidas: PublicoAvaliado['excluidas'] = []
  const veredictos: { incluir: boolean; motivo?: MotivoExclusao }[] = []
  // Uma empresa gera UM destinatário: o set guarda quem já entrou. Ele existe
  // aqui, e não no motor puro, porque é estado do laço e não fato da pessoa.
  const empresasJaEscolhidas = new Set<string>()

  for (const empresaId of publico.empresaIds) {
    const candidatos = fatos.contatosPorEmpresa.get(empresaId) ?? []
    const resolvido = resolverDestinatario(c.canal, candidatos)

    if (!resolvido) {
      // Sem contato utilizável não há a quem avaliar. É `sem_contato`, e é
      // informação de enriquecimento — não de filtro.
      veredictos.push({ incluir: false, motivo: 'sem_contato' })
      excluidas.push({ empresaId, contatoId: null, motivo: 'sem_contato' })
      continue
    }

    const contatoId = resolvido.contato.id
    const veredicto = avaliarDestinatario({
      canal: c.canal,
      tipoCampanha: c.tipo,
      identificador: resolvido.identificador,
      suprimido: fatos.suprimidos.has(contatoId),
      baseLegal: resolvido.baseLegal,
      temProcessoAtivo: fatos.comProcesso.has(empresaId),
      gestaoOperacao: fatos.gestaoPorEmpresa.get(empresaId) ?? null,
      empresaJaEscolhida: empresasJaEscolhidas.has(empresaId),
      emOutraCampanha: fatos.emOutraCampanha.has(contatoId),
      campanhasNoTrimestre: fatos.campanhasNoTrimestre.get(contatoId) ?? 0,
      maxCampanhas90d: limites.max_campanhas_por_contato_90d,
      temConversaAberta: fatos.comConversaAberta.has(contatoId),
      excluirConversaAberta: c.excluir_conversa_aberta,
      ultimoToqueEm: fatos.ultimoToquePorContato.get(contatoId) ?? null,
      excluirContatadosDias: c.excluir_contatados_dias,
      agora,
    })

    veredictos.push(veredicto)
    if (veredicto.incluir) {
      empresasJaEscolhidas.add(empresaId)
      elegiveis.push({ empresaId, destinatario: resolvido })
    } else {
      excluidas.push({ empresaId, contatoId, motivo: veredicto.motivo! })
    }
  }

  return {
    descricao: publico.descricao,
    totalEmpresas: publico.empresaIds.length,
    elegiveis,
    exclusoes: contarExclusoes(veredictos, MOTIVOS_EXCLUSAO),
    excluidas,
  }
}
