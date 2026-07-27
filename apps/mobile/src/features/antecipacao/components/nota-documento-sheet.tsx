import {
  enderecoEmLinha,
  formatarChave,
  formatarDocumento,
  lerDocumentoFiscal,
  type DocumentoFiscal,
  type ParteFiscal,
} from '@jobsiteos/core'
import { useQuery } from '@tanstack/react-query'
import { FileWarning } from 'lucide-react-native'
import { useMemo } from 'react'
import { ScrollView, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Sheet } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Text } from '@/components/ui/text'
import { ErrorState } from '@/components/ui/states'
import { fetchXmlDaNota } from '../api'
import { antecipacaoKeys } from '../queries'

/**
 * A NF aberta como documento, no celular.
 *
 * NÃO é o DANFE do desktop encolhido: uma tabela de 10 colunas num telefone é
 * ilegível. Aqui o mesmo documento vira uma sequência de blocos empilhados, e os
 * itens viram cartões em vez de linhas de tabela. O leitor é o MESMO
 * (`lerDocumentoFiscal` no core) — o que muda é só o desenho.
 *
 * O XML é buscado quando a folha abre, nunca com a lista: são dezenas a centenas
 * de KB por nota, e o funil pinta 30 cards de uma vez numa rede de obra.
 */

export interface NotaDocumentoSheetProps {
  accessKey: string
  titulo: string
  subtitulo?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function moeda(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function dataHora(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function dataCurta(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('pt-BR')
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  return (
    <View className="flex-row items-baseline justify-between gap-3 py-1">
      <Text variant="muted" className="text-xs">
        {rotulo}
      </Text>
      <Text className="flex-1 text-right text-sm tabular-nums" numberOfLines={2}>
        {valor ?? '—'}
      </Text>
    </View>
  )
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <View className="gap-1 py-2">
      <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </Text>
      {children}
    </View>
  )
}

function BlocoParte({ titulo, parte }: { titulo: string; parte: ParteFiscal }) {
  return (
    <Bloco titulo={titulo}>
      <Text className="text-sm font-medium">{parte.nome ?? '—'}</Text>
      <Text variant="muted" className="text-xs tabular-nums">
        {formatarDocumento(parte.documento)}
        {parte.inscricaoEstadual ? ` · IE ${parte.inscricaoEstadual}` : ''}
        {parte.inscricaoMunicipal ? ` · IM ${parte.inscricaoMunicipal}` : ''}
      </Text>
      <Text variant="muted" className="text-xs">
        {enderecoEmLinha(parte.endereco)}
      </Text>
    </Bloco>
  )
}

function Documento({ doc }: { doc: DocumentoFiscal }) {
  const { colors } = useTheme()

  if (doc.formato === 'desconhecido') {
    return (
      <View className="items-center gap-3 py-10">
        <FileWarning size={28} color={colors.mutedForeground} />
        <Text className="text-center font-medium">Não dá para desenhar este documento</Text>
        <Text variant="muted" className="text-center text-sm">
          {doc.motivo}
        </Text>
      </View>
    )
  }

  if (doc.formato === 'nfse') {
    return (
      <View>
        <Bloco titulo="Identificação">
          <Campo rotulo="Número" valor={doc.numero} />
          <Campo rotulo="Série" valor={doc.serie} />
          <Campo rotulo="Emissão" valor={dataHora(doc.emitidaEm)} />
          <Campo rotulo="Competência" valor={dataCurta(doc.competencia)} />
          <Campo rotulo="Chave" valor={formatarChave(doc.chaveAcesso)} />
        </Bloco>
        <Separator />
        <BlocoParte titulo="Prestador" parte={doc.prestador} />
        <Separator />
        <BlocoParte titulo="Tomador" parte={doc.tomador} />
        <Separator />
        <Bloco titulo="Serviço">
          <Campo rotulo="Código nacional" valor={doc.servico.codigoTributacaoNacional} />
          <Text className="pt-1 text-sm leading-snug">{doc.servico.descricao ?? '—'}</Text>
        </Bloco>
        <Separator />
        <Bloco titulo="Valores">
          <Campo rotulo="Valor do serviço" valor={moeda(doc.valores.valorServico)} />
          <Campo rotulo="Base de cálculo" valor={moeda(doc.valores.baseCalculo)} />
          <Campo
            rotulo="Alíquota ISS"
            valor={doc.valores.aliquota !== null ? `${moeda(doc.valores.aliquota)} %` : '—'}
          />
          <Campo rotulo="Valor do ISS" valor={moeda(doc.valores.valorIss)} />
          <Campo
            rotulo="ISS retido"
            valor={doc.valores.issRetido === null ? '—' : doc.valores.issRetido ? 'Sim' : 'Não'}
          />
          <View className="mt-1 flex-row items-baseline justify-between rounded-md bg-muted px-3 py-2">
            <Text className="text-xs font-medium">Valor líquido</Text>
            <Text className="text-base font-bold tabular-nums">
              R$ {moeda(doc.valores.valorLiquido ?? doc.valores.valorServico)}
            </Text>
          </View>
        </Bloco>
        {doc.informacoesComplementares ? (
          <>
            <Separator />
            <Bloco titulo="Informações complementares">
              <Text className="text-sm leading-snug">{doc.informacoesComplementares}</Text>
            </Bloco>
          </>
        ) : null}
      </View>
    )
  }

  return (
    <View>
      <Bloco titulo="Identificação">
        <Campo rotulo="Número / série" valor={`${doc.numero ?? '—'} / ${doc.serie ?? '—'}`} />
        <Campo rotulo="Natureza da operação" valor={doc.naturezaOperacao} />
        <Campo rotulo="Emissão" valor={dataHora(doc.emitidaEm)} />
        <Campo rotulo="Protocolo" valor={doc.protocolo} />
        <Campo rotulo="Chave" valor={formatarChave(doc.chaveAcesso)} />
      </Bloco>
      <Separator />
      <BlocoParte titulo="Emitente" parte={doc.emitente} />
      <Separator />
      <BlocoParte titulo="Destinatário" parte={doc.destinatario} />

      {doc.duplicatas.length > 0 ? (
        <>
          <Separator />
          <Bloco titulo="Duplicatas">
            {doc.duplicatas.map((d, i) => (
              <Campo
                key={`${d.numero}-${i}`}
                rotulo={`Parcela ${d.numero ?? i + 1}`}
                valor={`${dataCurta(d.vencimento)} · ${moeda(d.valor)}`}
              />
            ))}
          </Bloco>
        </>
      ) : null}

      <Separator />
      {/* Itens como CARTÕES, não tabela: dez colunas num telefone não se lê. */}
      <Bloco titulo={`Itens (${doc.itens.length})`}>
        {doc.itens.length === 0 ? (
          <Text variant="muted" className="text-sm">
            Nenhum item no XML.
          </Text>
        ) : (
          doc.itens.map((item) => (
            <View key={item.ordem} className="mt-1.5 gap-0.5 rounded-md border border-border p-2">
              <Text className="text-sm font-medium" numberOfLines={2}>
                {item.descricao ?? '—'}
              </Text>
              <Text variant="muted" className="text-xs tabular-nums">
                {item.codigo ?? '—'}
                {item.ncm ? ` · NCM ${item.ncm}` : ''}
                {item.cfop ? ` · CFOP ${item.cfop}` : ''}
              </Text>
              <View className="flex-row justify-between pt-0.5">
                <Text variant="muted" className="text-xs tabular-nums">
                  {item.quantidade ?? '—'} {item.unidade ?? ''} × {moeda(item.valorUnitario)}
                </Text>
                <Text className="text-sm font-medium tabular-nums">{moeda(item.valorTotal)}</Text>
              </View>
            </View>
          ))
        )}
      </Bloco>

      <Separator />
      <Bloco titulo="Totais">
        <Campo rotulo="Produtos" valor={moeda(doc.totais.valorProdutos)} />
        <Campo rotulo="Frete" valor={moeda(doc.totais.valorFrete)} />
        <Campo rotulo="Desconto" valor={moeda(doc.totais.valorDesconto)} />
        <Campo rotulo="ICMS" valor={moeda(doc.totais.valorIcms)} />
        <View className="mt-1 flex-row items-baseline justify-between rounded-md bg-muted px-3 py-2">
          <Text className="text-xs font-medium">Valor total da nota</Text>
          <Text className="text-base font-bold tabular-nums">
            R$ {moeda(doc.totais.valorTotal)}
          </Text>
        </View>
      </Bloco>

      {doc.informacoesComplementares ? (
        <>
          <Separator />
          <Bloco titulo="Informações complementares">
            <Text className="text-sm leading-snug">{doc.informacoesComplementares}</Text>
          </Bloco>
        </>
      ) : null}
    </View>
  )
}

export function NotaDocumentoSheet({
  accessKey,
  titulo,
  subtitulo,
  open,
  onOpenChange,
}: NotaDocumentoSheetProps) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: antecipacaoKeys.xml(accessKey),
    queryFn: () => fetchXmlDaNota(accessKey),
    enabled: open,
    // O XML de uma nota emitida não muda. Reabrir a folha não deve rebaixá-lo.
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  })

  const doc = useMemo(() => (data ? lerDocumentoFiscal(data.raw_xml) : null), [data])

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={titulo} description={subtitulo}>
      <View className="max-h-[70vh]">
        {doc ? (
          <View className="flex-row justify-end pb-1">
            <Badge variant="secondary">
              <Text className="text-[10px]">
                {doc.formato === 'nfe' ? 'NFe' : doc.formato === 'nfse' ? 'NFS-e' : 'XML'}
              </Text>
            </Badge>
          </View>
        ) : null}

        {isPending ? (
          <View className="gap-2 py-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </View>
        ) : isError ? (
          <ErrorState
            description="Não foi possível carregar o XML desta nota."
            onRetry={() => void refetch()}
          />
        ) : doc ? (
          <ScrollView showsVerticalScrollIndicator={false}>
            <Documento doc={doc} />
            <Text variant="muted" className="py-4 text-center text-[11px]">
              Representação para conferência interna. Não é o DANFE oficial.
            </Text>
          </ScrollView>
        ) : null}
      </View>
    </Sheet>
  )
}
