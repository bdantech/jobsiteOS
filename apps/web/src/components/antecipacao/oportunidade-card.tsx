'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlarmClock, Files, Gavel, Handshake } from 'lucide-react'
import {
  FAIXA_LABELS,
  TIPAGEM_LABELS,
  TIPO_OPORTUNIDADE_LABELS,
  STATUS_PRE_AUTORIZACAO_LABELS,
  speDoSacado,
  urgenciaDe,
  valorLiquidoEstimado,
  type ContaDoSacadoResolvida,
  type Faixa,
  type Tipagem,
  type TipoOportunidade,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  CardDoFunil,
  ChipDoCard,
  TiraDoCard,
  type TomDoScore,
} from '@/components/comercial/card-funil'
import { MenuAcoesOportunidade } from './acoes-oportunidade'
import { NotaModal } from './documento/nota-modal'
import { OportunidadeModal } from './oportunidade-modal'
import { AbaEmpresa } from '@/components/comercial/aba-empresa'
import { AbaMensagens } from '@/components/comercial/modal-card'
import { creditoBadge, formatarData, formatarMoedaExata, labelCredito, textoPrazo } from './format'
import type { FornecedorFunil, Oportunidade } from './queries'

/**
 * O card do funil — UM para os três tipos.
 *
 * ── POR QUE NÃO TRÊS CARDS ──────────────────────────────────────────────────
 * Quem olha o funil vê uma lista homogênea e varre com o olho. Um layout próprio
 * por fonte obrigaria a reler a estrutura a cada card, e a releitura é o custo:
 * numa coluna de quarenta itens, três gramáticas visuais significam parar
 * quarenta vezes. O SELO diz de onde veio; o resto é igual.
 *
 * ── O QUE VARIA, E ONDE ─────────────────────────────────────────────────────
 * Exatamente UMA linha de contexto, sempre no mesmo lugar. Ela vem PRONTA do
 * banco (`linha_contexto`), e não montada aqui, porque a frase depende de dados
 * que só a fonte tem — quantas parcelas o título tem, qual o `guardReason`,
 * quantos dias faltam para a oferta expirar. Montá-la no cliente exigiria trazer
 * todos esses campos para pintar uma frase.
 *
 * ── O RELÓGIO ───────────────────────────────────────────────────────────────
 * Só a pré-autorização tem `relogio`, e ele é o único prazo do sistema medido em
 * dias que se contam nos dedos. Quando faltam dois ou menos, o chip fica vermelho
 * e ganha ícone: é o item mais perecível do funil, e o trabalho para salvá-lo é um
 * telefonema.
 */

const TOM_DA_FAIXA: Record<Faixa, TomDoScore> = {
  alta: 'alerta',
  boa: 'bom',
  media: 'info',
}

/** O selo de tipo. A pré-autorização é âmbar porque ela é a que corre. */
const TOM_DO_SELO: Record<TipoOportunidade, 'info' | 'alerta' | 'neutro'> = {
  nf: 'neutro',
  pre_autorizacao: 'alerta',
  titulo: 'info',
}

/**
 * O horizonte da barra de prazo, em dias. 90 é o `max_due_date_days_default` da
 * matriz de precificação: o vencimento mais longo que a plataforma aceita, e por
 * isso a régua em que "cheia" quer dizer "acabou de nascer".
 */
const HORIZONTE_PRAZO = 90

const TOM_DA_URGENCIA: Record<string, TomDoScore> = {
  vencida: 'ruim',
  critica: 'ruim',
  atencao: 'alerta',
  confortavel: 'bom',
}

/** Dias até o relógio zerar. Negativo = já passou. */
function diasParaExpirar(relogio: string | null): number | null {
  if (!relogio) return null
  const ms = new Date(relogio).getTime() - Date.now()
  return Number.isFinite(ms) ? Math.ceil(ms / 86_400_000) : null
}

export function OportunidadeCard({
  item,
  fornecedor,
  minimoOperavel,
  compacto = false,
  dono,
  conta,
}: {
  item: Oportunidade
  fornecedor?: FornecedorFunil
  minimoOperavel: number
  compacto?: boolean
  conta?: ContaDoSacadoResolvida | null
  dono?: React.ReactNode
}) {
  const [aberta, setAberta] = React.useState(false)
  const [aba, setAba] = React.useState('documento')
  const [contatoEscolhido, setContatoEscolhido] = React.useState<string | null>(null)

  const tipo = (item.tipo ?? 'nf') as TipoOportunidade
  const urgencia = urgenciaDe(item.dias_para_vencimento, minimoOperavel)
  const outras = (fornecedor?.notas_vivas ?? 1) - 1
  const liquido = valorLiquidoEstimado({
    valor: item.valor,
    receitaEsperada: item.receita_esperada,
    tac: item.tac_estimada,
    seguro: item.seguro_estimado,
  })

  const nomeFornecedor = item.fornecedor_nome ?? item.fornecedor_cnpj ?? '—'
  const nomeSacado = item.sacado_nome ?? item.sacado_cnpj ?? '—'
  const nomePrincipal = conta?.nome ?? nomeSacado
  const spe = speDoSacado(conta, item.sacado_cnpj, nomeSacado)

  const expiraEm = diasParaExpirar(item.relogio)
  const relogioCurto = expiraEm !== null && expiraEm <= 2

  /*
   * QUAL modal abre — e todo card abre algum.
   *
   * A primeira versão deixava a pré-autorização SEM clique, porque `NotaModal` é
   * um leitor de XML (o corpo dele é `!documento ? null : …`) e abriria uma caixa
   * vazia. A conclusão estava certa e a decisão errada: um card que não abre é um
   * card de que não se consegue cuidar — não dá para ver o contato do fornecedor
   * nem mandar mensagem, que é o trabalho inteiro numa oferta esperando aceite.
   *
   * A NF continua no leitor de documento: é o que ela é. As duas fontes novas
   * abrem o `OportunidadeModal`, que mostra o negócio em vez do papel — e leva as
   * MESMAS abas de fornecedor e comunicação, para que quem trabalha os três tipos
   * no mesmo dia não reaprenda a tela a cada troca.
   */
  const ehNota = tipo === 'nf' && Boolean(item.access_key)

  /*
   * O credor pessoa física não tem para onde linkar: ele não casa com `empresas`,
   * não tem ficha e não entra em carteira nenhuma. O nome fica como texto.
   */
  const linkavel = Boolean(item.fornecedor_cnpj) && item.credor_pessoa_fisica !== true

  const barraPrazo =
    typeof item.dias_para_vencimento === 'number'
      ? {
          pct: Math.max(0, Math.min(100, (item.dias_para_vencimento / HORIZONTE_PRAZO) * 100)),
          tom: TOM_DA_URGENCIA[urgencia] ?? 'neutro',
        }
      : null

  return (
    <>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <div>
            <CardDoFunil
              rotuloAbrir={`Abrir ${TIPO_OPORTUNIDADE_LABELS[tipo].toLowerCase()} ${item.numero_exibicao ?? item.id} de ${nomeFornecedor}`}
              onAbrir={() => {
                setAba('documento')
                setAberta(true)
              }}
              esmaecido={Boolean(item.fornecedor_suprimido)}
              titulo={
                linkavel ? (
                  <Link
                    href={`/antecipacao/fornecedores/${item.fornecedor_cnpj}`}
                    onClick={(e) => e.stopPropagation()}
                    className="relative z-10 hover:underline"
                  >
                    {nomeFornecedor}
                  </Link>
                ) : (
                  <span>{nomeFornecedor}</span>
                )
              }
              valor={
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-bold leading-none tracking-[-0.02em]">
                    {formatarMoedaExata(item.valor)}
                  </span>
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
                item.faixa
                  ? {
                      valor: null,
                      faixa: item.faixa,
                      texto: FAIXA_LABELS[item.faixa as Faixa] ?? item.faixa,
                      tom: TOM_DA_FAIXA[item.faixa as Faixa] ?? 'neutro',
                      rotulo: TIPO_OPORTUNIDADE_LABELS[tipo].toLowerCase(),
                    }
                  : null
              }
              barra={barraPrazo}
              chips={
                <>
                  {/* O SELO DE TIPO vem primeiro: é o que responde "de onde veio
                      este card" antes de qualquer outra leitura. */}
                  <ChipDoCard forte tom={TOM_DO_SELO[tipo]}>
                    {TIPO_OPORTUNIDADE_LABELS[tipo]}
                  </ChipDoCard>

                  {/* A ÚNICA linha que varia por tipo, no mesmo lugar do card. */}
                  <ChipDoCard className="tabular-nums">{item.linha_contexto ?? '—'}</ChipDoCard>

                  {/* O relógio só existe na pré-autorização, e grita quando é curto. */}
                  {expiraEm !== null ? (
                    <ChipDoCard tom={relogioCurto ? 'ruim' : 'neutro'} forte={relogioCurto}>
                      <AlarmClock className="mr-1 size-3" aria-hidden />
                      {expiraEm < 0
                        ? 'expirou'
                        : expiraEm === 0
                          ? 'expira hoje'
                          : `${expiraEm}d`}
                    </ChipDoCard>
                  ) : null}

                  {item.fornecedor_tipagem ? (
                    <ChipDoCard tom="info" forte>
                      {TIPAGEM_LABELS[item.fornecedor_tipagem as Tipagem]}
                    </ChipDoCard>
                  ) : null}

                  {item.credor_pessoa_fisica ? (
                    <ChipDoCard tom="neutro">Credor PF</ChipDoCard>
                  ) : null}

                  {item.fornecedor_tem_protesto ? (
                    <ChipDoCard tom="ruim" forte>
                      <Gavel className="mr-1 size-3" aria-hidden />
                      Protesto
                    </ChipDoCard>
                  ) : null}

                  {/*
                   * "+N" conta OS TRÊS TIPOS, porque quem é abordado é o
                   * fornecedor e não o documento — e a conversa é sobre tudo que
                   * ele tem vivo, não sobre o que chegou por um canal só.
                   */}
                  {outras > 0 && linkavel ? (
                    <Link
                      href={`/antecipacao/fornecedores/${item.fornecedor_cnpj}`}
                      onClick={(e) => e.stopPropagation()}
                      className="relative z-10"
                    >
                      <ChipDoCard className="hover:bg-muted-foreground/15">
                        <Files className="mr-1 size-3" aria-hidden />+{outras} item
                        {outras > 1 ? 's' : ''}
                      </ChipDoCard>
                    </Link>
                  ) : null}
                </>
              }
              rodapeEsquerda={
                dono ? (
                  <span className="relative z-10 block" onClick={(e) => e.stopPropagation()}>
                    {dono}
                  </span>
                ) : undefined
              }
              rodapeDireita={
                !compacto ? (
                  <span className="flex items-center gap-1.5">
                    <Badge className={cn('shrink-0', creditoBadge(item.sacado_credito_status))}>
                      {labelCredito(item.sacado_credito_status)}
                    </Badge>
                    <span className="relative z-10" onClick={(e) => e.stopPropagation()}>
                      <MenuAcoesOportunidade item={item} />
                    </span>
                  </span>
                ) : undefined
              }
              tira={
                /*
                 * UMA tira, nesta ordem de precedência.
                 *
                 * O selo "já tem pré-autorização" vem ANTES do limite e do
                 * suprimido porque ele muda o que a pessoa vai FAZER: não é mais
                 * "convença o fornecedor a antecipar", é "a construtora já
                 * ofereceu, lembre-o de aceitar". É outra conversa.
                 */
                !compacto && item.conversao_antecipacao_id ? (
                  <TiraDoCard tom={item.conversao_em_disputa ? 'ruim' : 'bom'}>
                    Convertida via antecipação #{item.conversao_antecipacao_id}
                    {item.conversao_valor ? ` · ${formatarMoedaExata(item.conversao_valor)}` : ''}
                    {item.conversao_taxa ? ` a ${item.conversao_taxa}% a.m.` : ''}
                    {item.conversao_em_disputa ? ' — em disputa, revise.' : ''}
                  </TiraDoCard>
                ) : !compacto && item.pre_autorizacao_id ? (
                  <TiraDoCard tom="alerta">
                    <Handshake className="mr-1 inline size-3" aria-hidden />
                    Já tem pré-autorização
                    {item.pre_autorizacao_status
                      ? ` (${STATUS_PRE_AUTORIZACAO_LABELS[item.pre_autorizacao_status] ?? item.pre_autorizacao_status})`
                      : ''}
                    {item.pre_autorizacao_em ? ` · ${formatarData(item.pre_autorizacao_em)}` : ''}
                  </TiraDoCard>
                ) : !compacto &&
                  item.sacado_credito_status === 'APPROVED' &&
                  // `=== false` e não `!`: o campo é NULO quando não se sabe o
                  // disponível do sacado, e `!null` acenderia a tira justamente
                  // no caso em que não há nada a afirmar.
                  item.sacado_limite_cobre_valor === false ? (
                  <TiraDoCard tom="alerta">Aprovado, mas o limite não cobre este valor.</TiraDoCard>
                ) : !compacto && item.fornecedor_suprimido ? (
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
         * O fundo do tooltip é `primary`, então NADA aqui usa `text-muted-foreground`
         * nem cores semânticas — elas são calibradas contra `background` e ficam
         * ilegíveis sobre a primária em um dos dois temas. A hierarquia vem de
         * OPACIDADE, e a urgência, que no card é cor, aqui vira PALAVRA.
         */}
        <TooltipContent side="right" className="max-w-xs px-3 py-2">
          <dl className="space-y-1.5 text-xs">
            <div>
              <dt className="sr-only">Fornecedor</dt>
              <dd className="font-semibold leading-snug">{nomeFornecedor}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Origem</dt>
              <dd className="text-right">
                {TIPO_OPORTUNIDADE_LABELS[tipo]}
                {item.estado_origem ? (
                  <span className="block text-[11px] opacity-70">{item.estado_origem}</span>
                ) : null}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Sacado</dt>
              <dd className="text-right">
                {nomePrincipal}
                {spe ? <span className="block text-[11px] opacity-70">via {spe}</span> : null}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Identificação</dt>
              <dd className="tabular-nums">{item.linha_contexto ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Valor</dt>
              <dd className="tabular-nums">{formatarMoedaExata(item.valor)}</dd>
            </div>
            {/*
             * "Entrada" e não "Emissão": as três fontes nascem de jeitos
             * diferentes — a nota é emitida, a oferta é criada, a parcela é vista
             * pela primeira vez. Chamar tudo de emissão seria chamar duas delas
             * de algo que não são.
             */}
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Entrada</dt>
              <dd className="tabular-nums">{formatarData(item.data_base)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Vencimento</dt>
              <dd className="tabular-nums">{formatarData(item.vencimento)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Prazo</dt>
              <dd className={cn('tabular-nums', urgencia !== 'confortavel' && 'font-semibold')}>
                {textoPrazo(item.dias_para_vencimento)}
                {urgencia === 'vencida' || urgencia === 'critica' ? ' — não operável' : ''}
              </dd>
            </div>
            {expiraEm !== null ? (
              <div className="flex justify-between gap-4">
                <dt className="opacity-70">Oferta expira</dt>
                <dd className={cn('tabular-nums', relogioCurto && 'font-semibold')}>
                  {formatarData(item.relogio)}
                  <span className="block text-[11px] opacity-70">
                    {expiraEm < 0 ? 'já expirou' : `em ${expiraEm} dia(s)`}
                  </span>
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Receita esperada</dt>
              <dd className="text-right tabular-nums">
                {formatarMoedaExata(item.receita_esperada)}
                {item.taxa_usada === null || item.taxa_usada === undefined ? null : (
                  <span className="block text-[11px] opacity-70">
                    a {Number(item.taxa_usada).toLocaleString('pt-BR')}% a.m.
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
            {item.vencimento_origem === 'estimado' ? (
              <p className="pt-0.5 text-[11px] leading-snug opacity-70">
                Vencimento estimado (emissão + 30 dias) — não veio do XML nem do endpoint.
              </p>
            ) : null}
            <p className="pt-0.5 text-[11px] opacity-70">
              {ehNota ? 'Clique para abrir o documento.' : 'Clique para abrir a oportunidade.'}
            </p>
          </dl>
        </TooltipContent>
      </Tooltip>

      {aberta && !ehNota ? (
        <OportunidadeModal
          item={item}
          titulo={`${item.numero_exibicao ?? item.id}`}
          subtitulo={`${nomeFornecedor} → ${nomePrincipal}${spe ? ` (via ${spe})` : ''}`}
          aberto={aberta}
          onOpenChange={setAberta}
          minimoOperavel={minimoOperavel}
        />
      ) : null}

      {aberta && ehNota && item.access_key ? (
        <NotaModal
          accessKey={item.access_key}
          titulo={`${TIPO_OPORTUNIDADE_LABELS[tipo]} ${item.numero_exibicao ?? item.id}`}
          subtitulo={`${nomeFornecedor} → ${nomePrincipal}${spe ? ` (via ${spe})` : ''}`}
          aberto={aberta}
          onOpenChange={setAberta}
          aba={aba}
          onAbaChange={setAba}
          abasExtras={[
            {
              id: 'fornecedor',
              label: 'Fornecedor',
              conteudo: (
                <AbaEmpresa
                  empresaId={item.fornecedor_empresa_id}
                  fornecedorCnpj={item.fornecedor_cnpj}
                  fornecedorNome={nomeFornecedor}
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
                  empresaId={item.fornecedor_empresa_id}
                  funil="nfs"
                  funilCardId={item.access_key}
                  fornecedorCnpj={item.fornecedor_cnpj}
                  contatoIdInicial={contatoEscolhido}
                  onIrParaFornecedor={() => setAba('fornecedor')}
                />
              ),
            },
          ]}
          acoes={<MenuAcoesOportunidade item={item} />}
        />
      ) : null}
    </>
  )
}
