import { regraDeIdentificacao, type PoliticaIdentificacao } from './identificacao.js'
import { TIPO_MANDATO_LABELS, type Persona, type TipoMandato } from './schemas.js'

/**
 * O SYSTEM PROMPT DO AGENTE DE MANDATO (Prompt 09 §6).
 *
 * A ordem dos blocos é a ordem de precedência: o que vem depois NÃO pode desdizer o que
 * vem antes. Regras da casa → identificação (config) → persona → playbook. Um playbook mal
 * escrito ("diga que você é do time comercial") perde para a regra de identificação porque
 * ela veio antes e diz, com todas as letras, que vale por cima.
 */

export interface EntradaPrompt {
  persona: Persona
  identificacao: PoliticaIdentificacao
  tipo: TipoMandato
  playbook: { nome: string; instrucoes: string } | null
}

export const REGRAS_DA_CASA = `Você é um agente comercial da ONE OS, empresa de antecipação de recebíveis para a construção civil. Você trabalha um MANDATO: um objetivo comercial delegado a você, com prazo, orçamento e limites. Você persegue esse objetivo através de quantos contatos, canais e dias forem necessários — até conseguir ou desistir com motivo.

Como você trabalha:
- A cada ciclo você recebe o mandato, o plano atual e o que aconteceu desde o último ciclo. Você CHAMA ferramentas; cada uma é executada de verdade e o resultado volta para você decidir o passo seguinte.
- Antes de terminar o ciclo, chame SEMPRE "atualizar_plano": o que você está tentando agora, sua hipótese, as próximas ações com quando e por quê, e os bloqueios. A primeira próxima ação define quando o mandato acorda de novo. Ciclo sem plano atualizado é erro.
- Nem todo ciclo precisa de ação externa. Se a pessoa disse "me liga quinta", agende e espere. Esperar bem é trabalho.
- Toda ferramenta que muta tem um "intencao" implícito: o motivo que você escreve no plano. Seja específico ("o Carlos pediu para ligar às 15h30"), nunca genérico ("fazer follow-up").

Regras que não se negociam:
- Uma pergunta por mensagem. Mensagens curtas, português do Brasil, tratamento por "você".
- NUNCA cite taxa, juros, desconto, limite ou valor de operação que não esteja no contexto. Negociação de taxa, prazo ou condição é de uma pessoa: use "escalar_humano".
- Escale também em: pedido EXPRESSO de falar com uma pessoa, reclamação, menção a advogado, processo ou cobrança.
- Pergunta sobre ser robô ou IA NÃO é motivo para escalar: responda conforme a regra de identificação e siga a conversa.
- Nunca invente contato, telefone ou e-mail. Contato novo só com "registrar_contato" e a evidência do que a pessoa disse.
- Nunca ofereça horário de reunião que não veio de "consultar_agenda_closer".
- Se uma ferramenta recusar (supressão, janela, cooldown, orçamento, versão da Ana), leia o motivo e contorne por outro caminho ou replaneje. Não insista na mesma coisa.
- Quando o objetivo for atingido, "encerrar_mandato" com sucesso. Quando não houver mais caminho razoável, encerre sem sucesso com o motivo certo — isso é melhor do que insistir.`

export function montarSystemPrompt(e: EntradaPrompt): string {
  const p = e.persona
  const blocos = [
    REGRAS_DA_CASA,
    `── ${regraDeIdentificacao(e.identificacao, p.nome_exibicao)}`,
    [
      `── Persona: ${p.nome_exibicao}`,
      p.bio_curta ? `Sobre você: ${p.bio_curta}` : null,
      p.tom ? `Tom: ${p.tom}` : 'Tom: cordial, direto, sem jargão e sem exagero de entusiasmo.',
      p.assinatura_email ? `Assinatura dos e-mails (use exatamente):\n${p.assinatura_email}` : null,
      p.genero_gramatical === 'masculino'
        ? 'Concordância: masculino.'
        : p.genero_gramatical === 'neutro'
          ? 'Concordância: evite marcas de gênero sobre você.'
          : 'Concordância: feminino.',
    ]
      .filter(Boolean)
      .join('\n'),
    `── Tipo de mandato: ${TIPO_MANDATO_LABELS[e.tipo]}`,
    e.playbook ? `── Playbook: ${e.playbook.nome}\n${e.playbook.instrucoes}` : null,
  ]
  return blocos.filter(Boolean).join('\n\n')
}

/**
 * A ÚLTIMA TRAVA DE IDENTIFICAÇÃO, NO TEXTO QUE VAI SAIR (§10, "regra dura").
 *
 * O prompt pede; esta função confere. Uma mensagem que afirma ser humana, nega ser IA ou
 * inventa vida pessoal NÃO É ENVIADA — o executor devolve o erro ao modelo, que reescreve.
 * Os padrões são conservadores (falso positivo custa uma reescrita; falso negativo custa
 * uma mentira dita a um cliente em nome da casa).
 */
/*
 * `\b` não serve aqui: em regex de JavaScript as letras acentuadas NÃO são caractere de
 * palavra, então `robô\b` nunca casa ("ô" seguido de espaço são dois não-palavra). As
 * fronteiras são escritas com `\p{L}` e a flag `u`.
 */
const B = '(?<!\\p{L})'
const E = '(?!\\p{L})'
const re = (corpo: string) => new RegExp(`${B}${corpo}${E}`, 'iu')

const PADROES_PROIBIDOS: ReadonlyArray<{ re: RegExp; motivo: string }> = [
  { re: re('sou (?:um |uma )?(?:humano|humana|pessoa de verdade|pessoa real|gente de verdade)'), motivo: 'afirma ser humana' },
  { re: re('n[aã]o sou (?:um |uma )?(?:rob[oô]|bot|ia|intelig[eê]ncia artificial|m[aá]quina|assistente virtual)'), motivo: 'nega ser IA' },
  { re: re('de carne e osso'), motivo: 'afirma ser humana' },
  { re: re('(?:meu|minha) (?:marido|esposa|filho|filha|filhos|m[aã]e|pai|namorad[oa])'), motivo: 'inventa vida pessoal' },
  { re: re('(?:no|neste) (?:meu )?fim de semana (?:eu )?(?:fui|vou|estive)'), motivo: 'inventa vida pessoal' },
  { re: re('(?:estou|t[oô]) (?:aqui )?(?:no escrit[oó]rio|em casa|de f[eé]rias)'), motivo: 'inventa presença física' },
]

export function violaIdentificacao(texto: string): string | null {
  for (const p of PADROES_PROIBIDOS) {
    if (p.re.test(texto)) return p.motivo
  }
  return null
}
