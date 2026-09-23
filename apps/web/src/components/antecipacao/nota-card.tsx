'use client'

import * as React from 'react'
import Link from 'next/link'
import { Files, Gavel } from 'lucide-react'
import {
  FAIXA_LABELS,
  TIPAGEM_LABELS,
  speDoSacado,
  urgenciaDe,
  valorLiquidoEstimado,
  type ContaDoSacadoResolvida,
  type Faixa,
  type Tipagem,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  CardDoFunil,
  ChipDoCard,
  DonoNoRodape,
  TiraDoCard,
  type TomDoScore,
} from '@/components/comercial/card-funil'
import { MenuAcoesNota } from './acoes-nota'
import { NotaModal } from './documento/nota-modal'
import { AbaEmpresa } from '@/components/comercial/aba-empresa'
import { AbaMensagens } from '@/components/comercial/modal-card'
import {
  creditoBadge,
  formatarData,
  formatarMoedaExata,
  labelCredito,
  textoPrazo,
} from './format'
import type { FornecedorFunil, NotaFunil } from './queries'

/**
 * O card do funil de NFs.
 *
 * Divide o SHELL com Reuniões, Vendas e Certificados (`card-funil`): mesma caixa,
 * mesma régua tipográfica, mesmo lugar para o score, os chips, o dono e a tira.
 * Quem trabalha nos quatro funis no mesmo dia parava para reler o layout a cada
 * troca de tela; a releitura era o custo.
 *
 * ── O QUE É PRÓPRIO DA NF ───────────────────────────────────────────────────
 * O bloco da direita traz a FAIXA por extenso ("Boa"), e não um número: a faixa é
 * uma classificação de três degraus e escrever "2 de 3" ali inventaria uma
 * precisão que ela não tem.
 *
 * A barra embaixo é o PRAZO, e não o eco da faixa. Nos outros funis a barra
 * repete o score porque o score é contínuo; aqui a faixa é categórica e uma barra
 * de três degraus não se compara de relance. O prazo, sim: ele escorre todo dia e
 * é o que decide se a nota ainda dá para operar. Era o sinal que o card do desktop
 * tinha perdido para o tooltip quando o corpo foi enxugado — o mobile manteve a
 * cor de urgência justamente porque lá não há hover para compensar.
 *
 * ENXUTO por decisão: o corpo mostra fornecedor, valor, líquido, faixa, tipo da
 * nota e sacado — e para. Vencimento, receita esperada, emissão e taxa vivem no
 * TOOLTIP. Uma coluna do Kanban tem 40 cards; cada linha a menos é uma linha a
 * mais de contexto visível sem rolar.
 *
 * CLICAR ABRE A NOTA como documento. O caminho para o fornecedor não se perdeu:
 * o nome é um link, o "+N notas" é um link, e o menu tem "Ver notas do
 * fornecedor" — três portas, nenhuma delas roubada pelo modal.
 */

/** O tom do bloco da faixa. `alta` é âmbar aqui e verde no score de crédito. */
const TOM_DA_FAIXA_NF: Record<Faixa, TomDoScore> = {
  alta: 'alerta',
  boa: 'bom',
  media: 'info',
}

/**
 * O horizonte da barra de prazo, em dias.
 *
 * 90 é o `max_due_date_days_default` da matriz de precificação: é o vencimento
 * mais longo que a plataforma aceita, então é a régua em que "cheia" quer dizer
 * "acabou de ser emitida" e "quase vazia" quer dizer "corre". Uma régua maior
 * faria toda nota comum parecer urgente.
 */
const HORIZONTE_PRAZO = 90

const TOM_DA_URGENCIA: Record<string, TomDoScore> = {
  vencida: 'ruim',
  critica: 'ruim',
  atencao: 'alerta',
  confortavel: 'bom',
}

export function NotaCard({
  nota,
  fornecedor,
  minimoOperavel,
  compacto = false,
  dono,
  conta,
}: {
  nota: NotaFunil
  fornecedor?: FornecedorFunil
  minimoOperavel: number
  compacto?: boolean
  /**
   * O nome do CLIENTE a que esta nota está amarrada, quando ele existe e é
   * diferente do sacado. Vem pronto de cima, resolvido em lote — cada card
   * buscando a própria conta seria uma leitura por card.
   */
  conta?: ContaDoSacadoResolvida | null
  /**
   * O dono da nota, só quando a lista NÃO está recortada por vendedor. Vem pronto de
   * cima em vez de ser buscado aqui: são dezenas de cards por coluna, e cada um
   * resolvendo o próprio nome seria uma leitura por card.
   */
  dono?: React.ReactNode
}) {
  const [notaAberta, setNotaAberta] = React.useState(false)
  /*
   * A aba e o contato escolhido, no card e não no modal: quem escolhe "mandar
   * mensagem" para alguém na aba Fornecedor precisa aterrissar no compositor JÁ
   * naquela pessoa. Sem este estado a escolha morreria na barra de abas, e o
   * compositor abriria no primeiro contato da lista — que é raramente o que se
   * acabou de escolher.
   */
  const [aba, setAba] = React.useState('documento')
  const [contatoEscolhido, setContatoEscolhido] = React.useState<string | null>(null)
  const urgencia = urgenciaDe(nota.dias_para_vencimento, minimoOperavel)
  const outras = (fornecedor?.notas_vivas ?? 1) - 1
  const liquido = valorLiquidoEstimado({
    valor: nota.valor,
    receitaEsperada: nota.receita_esperada,
    tac: nota.tac_estimada,
    seguro: nota.seguro_estimado,
  })
  const nomeFornecedor = nota.fornecedor_nome ?? nota.fornecedor_cnpj ?? '—'
  const nomeSacado = nota.sacado_nome ?? nota.sacado_cnpj ?? '—'
  /*
   * O rodapé mostra o CLIENTE, não o sacado.
   *
   * Na maioria das notas o sacado é uma SPE — "PRIDE 06 QD 04", "SPE ILHAS
   * VIRGENS" —, e quem varre a coluna não reconhece o nome do cliente ali. A conta
   * é a empresa a que tudo está amarrado, e é por ela que a pessoa pensa.
   *
   * A SPE não some: ela vira a linha de baixo, porque é ela que identifica DE QUAL
   * obra é a nota — e é o nome que aparece no boleto e no relatório da plataforma.
   * Some quando o sacado É a conta, e quem decide isso é o CNPJ, não o nome: o nome
   * do sacado vem do XML que o fornecedor digitou, e "CONSTRUTURA RIBERIO CARAM LTDA"
   * é a mesma empresa que "RIBEIRO CARAM" sem que texto nenhum consiga dizer isso.
   * A régua inteira, com o porquê e os testes, está em `speDoSacado` (core).
   */
  const nomePrincipal = conta?.nome ?? nomeSacado
  const spe = speDoSacado(conta, nota.sacado_cnpj, nomeSacado)

  /*
   * A barra do prazo. Escorre de 90 dias até zero e troca de cor nos mesmos cortes
   * que o texto do tooltip usa — é a mesma régua de `urgenciaDe`, desenhada.
   *
   * Nota vencida fica com a barra ZERADA e vermelha, e não negativa: o card precisa
   * dizer "acabou", e uma barra que some diz isso melhor que um número negativo.
   */
  const barraPrazo =
    typeof nota.dias_para_vencimento === 'number'
      ? {
          pct: Math.max(0, Math.min(100, (nota.dias_para_vencimento / HORIZONTE_PRAZO) * 100)),
          tom: TOM_DA_URGENCIA[urgencia] ?? 'neutro',
        }
      : null

  return (
    <>
      {/* 700ms (o padrão, calibrado para o rail de ícones) é longo demais num card
          que a pessoa varre com o olho. */}
      <Tooltip delayDuration={300}>
        {/*
          `asChild` numa <div>, e não no card: o CardDoFunil já tem dentro dele o
          <button> esticado que abre a nota, e o Radix precisa de um elemento que
          repasse ref e handlers. A div é esse elemento e não rouba nada do botão.
        */}
        <TooltipTrigger asChild>
          <div>
            <CardDoFunil
              rotuloAbrir={`Abrir a nota ${nota.numero ?? nota.access_key} de ${nomeFornecedor}`}
              onAbrir={() => {
                setAba('documento')
                setNotaAberta(true)
              }}
              esmaecido={Boolean(nota.fornecedor_suprimido)}
              titulo={
                /* Clicar no NOME vai para o fornecedor; em qualquer outro lugar
                   abre a nota. `z-10` para ficar acima do botão do card. */
                <Link
                  href={`/antecipacao/fornecedores/${nota.fornecedor_cnpj}`}
                  onClick={(e) => e.stopPropagation()}
                  className="relative z-10 hover:underline"
                >
                  {nomeFornecedor}
                </Link>
              }
              valor={
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-bold leading-none tracking-[-0.02em]">
                    {formatarMoedaExata(nota.valor)}
                  </span>
                  {/*
                   * O LÍQUIDO, debaixo do valor de face.
                   *
                   * É o número que o originador fala em voz alta: "cai R$ 98.010 na
                   * sua conta", e não "sua nota vale R$ 100.000" — isso o fornecedor
                   * já sabe. Menor de propósito: quem varre a coluna varre pelo valor
                   * de face, e o líquido é o que lê quando parou num card.
                   *
                   * Ele MUDA TODO DIA, e é isso que o "hoje" promete: um dia a menos
                   * de prazo é um deságio menor. Sem a palavra, o número parece uma
                   * proposta fechada — e amanhã estaria diferente sem explicação.
                   */}
                  {liquido !== null ? (
                    <span className="text-[11px] font-normal text-muted-foreground">
                      líquido hoje{' '}
                      <span className="font-semibold text-foreground/80">
                        {formatarMoedaExata(liquido)}
                      </span>
                    </span>
                  ) : null}
                </span>
              }
              score={
                nota.faixa
                  ? {
                      valor: null,
                      faixa: nota.faixa,
                      texto: FAIXA_LABELS[nota.faixa as Faixa] ?? nota.faixa,
                      tom: TOM_DA_FAIXA_NF[nota.faixa as Faixa] ?? 'neutro',
                      rotulo: 'nota',
                    }
                  : null
              }
              barra={barraPrazo}
              chips={
                <>
                  <ChipDoCard forte>{nota.tipo_nf ?? 'NFe'}</ChipDoCard>
                  <ChipDoCard className="tabular-nums">
                    nº {nota.numero ?? '—'}
                    {nota.serie ? `/${nota.serie}` : ''}
                  </ChipDoCard>
                  {nota.fornecedor_tipagem ? (
                    <ChipDoCard tom="info" forte>
                      {TIPAGEM_LABELS[nota.fornecedor_tipagem as Tipagem]}
                    </ChipDoCard>
                  ) : null}
                  {nota.fornecedor_tem_protesto ? (
                    <ChipDoCard tom="ruim" forte>
                      <Gavel className="mr-1 size-3" aria-hidden />
                      Protesto
                    </ChipDoCard>
                  ) : null}
                  {/* O caminho para as outras notas do fornecedor continua aqui —
                      virou chip para não gastar uma linha inteira do card. */}
                  {outras > 0 ? (
                    <Link
                      href={`/antecipacao/fornecedores/${nota.fornecedor_cnpj}`}
                      onClick={(e) => e.stopPropagation()}
                      className="relative z-10"
                    >
                      <ChipDoCard className="hover:bg-muted-foreground/15">
                        <Files className="mr-1 size-3" aria-hidden />+{outras} nota
                        {outras > 1 ? 's' : ''}
                      </ChipDoCard>
                    </Link>
                  ) : null}
                </>
              }
              rodapeEsquerda={
                // `z-10`: trocar de dono é interativo e precisa ficar ACIMA do botão
                // que abre o card, senão trocar viraria abrir.
                dono ? (
                  <span className="relative z-10 block" onClick={(e) => e.stopPropagation()}>
                    {dono}
                  </span>
                ) : undefined
              }
              rodapeDireita={
                !compacto ? (
                  <span className="flex items-center gap-1.5">
                    <Badge className={cn('shrink-0', creditoBadge(nota.sacado_credito_status))}>
                      {labelCredito(nota.sacado_credito_status)}
                    </Badge>
                    {/*
                      O menu no CARD, além do modal. Quem varre uma coluna de trinta
                      notas já sabe o que fazer com a maioria delas, e obrigar a abrir
                      cada uma para mover uma etapa é atrito sem proteção. Mover para
                      "perdida" e marcar fornecedor sem interesse continuam pedindo
                      motivo por texto nos próprios diálogos.
                    */}
                    <span className="relative z-10" onClick={(e) => e.stopPropagation()}>
                      <MenuAcoesNota nota={nota} />
                    </span>
                  </span>
                ) : undefined
              }
              tira={
                /*
                  UMA tira, nesta ordem. A conversão vale mais que o limite porque
                  encerra a pergunta: a nota já virou dinheiro, e o resto é história.
                  Empilhar as duas faria um card resolvido parecer indeciso.
                */
                !compacto && nota.conversao_antecipacao_id ? (
                  <TiraDoCard tom={nota.conversao_em_disputa ? 'ruim' : 'bom'}>
                    Convertida via antecipação #{nota.conversao_antecipacao_id}
                    {nota.conversao_valor ? ` · ${formatarMoedaExata(nota.conversao_valor)}` : ''}
                    {nota.conversao_taxa ? ` a ${nota.conversao_taxa}% a.m.` : ''}
                    {nota.conversao_em_disputa ? ' — em disputa, revise.' : ''}
                  </TiraDoCard>
                ) : !compacto &&
                  nota.sacado_credito_status === 'APPROVED' &&
                  /*
                   * `=== false`, e não `!`: desde a 0229 este campo é NULO quando
                   * não se sabe o disponível do sacado, e `!null` acenderia a tira
                   * justamente no caso em que não temos o que afirmar. A tira é
                   * âmbar e diz "pare" — ela só pode aparecer sobre um número lido.
                   */
                  nota.sacado_limite_cobre_nota === false ? (
                  <TiraDoCard tom="alerta">Aprovado, mas o limite não cobre esta nota.</TiraDoCard>
                ) : !compacto && nota.fornecedor_suprimido ? (
                  <TiraDoCard tom="neutro">
                    Fornecedor suprimido — fora das faixas até a supressão expirar.
                  </TiraDoCard>
                ) : undefined
              }
            >
              {!compacto ? (
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-2.5">
                    <span className="shrink-0 text-[11px] text-muted-foreground">Sacado</span>
                    <span className="min-w-0 truncate text-[11.5px] font-semibold text-foreground">
                      {nomePrincipal}
                    </span>
                  </div>
                  {spe ? (
                    <span className="truncate text-right text-[10.5px] text-muted-foreground/70">
                      via {spe}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </CardDoFunil>
          </div>
        </TooltipTrigger>

        {/*
         * O que saiu do corpo do card mora aqui.
         *
         * O fundo do tooltip é `primary` (navy no claro, azul-claro no escuro), então
         * NADA aqui usa `text-muted-foreground` nem cores semânticas: elas são
         * calibradas contra `background`, e sobre a primária uma delas fica ilegível em
         * algum dos dois temas. A hierarquia vem de OPACIDADE sobre
         * `primary-foreground`, que é a única cor garantida a contrastar aqui — e a
         * urgência, que no card é cor, aqui vira PALAVRA.
         */}
        <TooltipContent side="right" className="max-w-xs px-3 py-2">
          <dl className="space-y-1.5 text-xs">
            <div>
              <dt className="sr-only">Fornecedor</dt>
              <dd className="font-semibold leading-snug">{nomeFornecedor}</dd>
            </div>
            {/* O sacado no tooltip é o par completo: a conta responde "de quem é o
                cliente" e a SPE responde "contra qual obra a nota foi emitida". No
                card só cabe a primeira. */}
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Sacado</dt>
              <dd className="text-right">
                {nomePrincipal}
                {spe ? <span className="block text-[11px] opacity-70">via {spe}</span> : null}
              </dd>
            </div>
            {/* O número INTEIRO: no card ele trunca para não empurrar o valor. */}
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Nota</dt>
              <dd className="tabular-nums">
                {nota.tipo_nf ?? 'NFe'} nº {nota.numero ?? '—'}
                {nota.serie ? `/${nota.serie}` : ''}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Valor da nota</dt>
              <dd className="tabular-nums">{formatarMoedaExata(nota.valor)}</dd>
            </div>
            {/* Emissão entrou aqui quando virou critério de ordenação e de filtro:
                ordenar por uma data que não se vê em lugar nenhum é ordenar às
                cegas. */}
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Emissão</dt>
              <dd className="tabular-nums">{formatarData(nota.emitida_em)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Vencimento</dt>
              <dd className="tabular-nums">{formatarData(nota.vencimento)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Prazo</dt>
              <dd className={cn('tabular-nums', urgencia !== 'confortavel' && 'font-semibold')}>
                {textoPrazo(nota.dias_para_vencimento)}
                {urgencia === 'vencida' || urgencia === 'critica' ? ' — não operável' : ''}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              {/*
               * A taxa junto do número porque ela é metade dele: quando o sacado já
               * tem análise de crédito, é a monthlyRateD0 dele que precifica a nota;
               * quando não tem, é a padrão da carteira. Sem o rótulo, as duas receitas
               * têm a mesma cara — e uma delas é uma média chutada.
               */}
              <dt className="opacity-70">Receita esperada</dt>
              <dd className="text-right tabular-nums">
                {formatarMoedaExata(nota.receita_esperada)}
                {nota.taxa_usada === null || nota.taxa_usada === undefined ? null : (
                  <span className="block text-[11px] opacity-70">
                    a {Number(nota.taxa_usada).toLocaleString('pt-BR')}% a.m.
                  </span>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Líquido estimado</dt>
              <dd className="text-right tabular-nums">
                {formatarMoedaExata(liquido)}
                <span className="block text-[11px] opacity-70">
                  o que o fornecedor recebe se antecipar hoje
                </span>
              </dd>
            </div>
            {nota.vencimento_origem === 'estimado' ? (
              <p className="pt-0.5 text-[11px] leading-snug opacity-70">
                Vencimento estimado (emissão + 30 dias) — não veio do XML nem do endpoint.
              </p>
            ) : null}
            <p className="pt-0.5 text-[11px] opacity-70">Clique para abrir a nota.</p>
          </dl>
        </TooltipContent>
      </Tooltip>

      {notaAberta && nota.access_key ? (
        <NotaModal
          accessKey={nota.access_key}
          titulo={`Nota ${nota.numero ?? nota.access_key}${nota.serie ? `/${nota.serie}` : ''}`}
          subtitulo={`${nomeFornecedor} → ${nomePrincipal}${spe ? ` (via ${spe})` : ''}`}
          aberto={notaAberta}
          onOpenChange={setNotaAberta}
          aba={aba}
          onAbaChange={setAba}
          abasExtras={[
            {
              id: 'fornecedor',
              label: 'Fornecedor',
              // Aqui a "empresa" do card é o FORNECEDOR: é com ele que se fala sobre
              // antecipar esta nota, não com o sacado. E é aqui que mora o agente de
              // contato — sem o CNPJ, esta aba não alcança os 3.542 dos 3.705
              // fornecedores com nota viva que não têm ficha de empresa.
              conteudo: (
                <AbaEmpresa
                  empresaId={nota.fornecedor_empresa_id}
                  fornecedorCnpj={nota.fornecedor_cnpj}
                  fornecedorNome={nomeFornecedor}
                  notaAccessKey={nota.access_key}
                  onMandarMensagem={(id) => {
                    setContatoEscolhido(id)
                    setAba('mensagens')
                  }}
                />
              ),
            },
            {
              id: 'mensagens',
              label: 'Comunicação',
              conteudo: (
                <AbaMensagens
                  empresaId={nota.fornecedor_empresa_id}
                  funil="nfs"
                  funilCardId={nota.access_key}
                  fornecedorCnpj={nota.fornecedor_cnpj}
                  contatoIdInicial={contatoEscolhido}
                  onIrParaFornecedor={() => setAba('fornecedor')}
                />
              ),
            },
          ]}
          acoes={<MenuAcoesNota nota={nota} />}
        />
      ) : null}
    </>
  )
}
