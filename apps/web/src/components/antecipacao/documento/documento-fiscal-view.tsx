'use client'

import * as React from 'react'
import { FileWarning } from 'lucide-react'
import {
  avaliarNatureza,
  enderecoEmLinha,
  formatarCep,
  formatarChave,
  formatarDocumento,
  type DocumentoFiscal,
  type DocumentoNfe,
  type DocumentoNfse,
  type ParteFiscal,
} from '@jobsiteos/core'
import { cn } from '@/lib/utils'

/**
 * O documento fiscal desenhado como DOCUMENTO — não como formulário.
 *
 * A referência é o DANFE em papel: molduras finas, rótulo minúsculo em caixa
 * alta acima do valor, blocos densos, monoespaçado nos números. Quem confere uma
 * nota está procurando um campo específico que já sabe onde fica; um layout de
 * "cards com muito respiro" obriga a reler tudo.
 *
 * NÃO é um DANFE oficial e não deve parecer que é: sem código de barras, sem
 * canhoto, sem a tarja de "DOCUMENTO AUXILIAR". É uma REPRESENTAÇÃO para
 * conferência interna, e o rodapé diz isso.
 *
 * Impressão: `print:` mantém as molduras e força fundo branco — a folha sai
 * legível sem uma rota de PDF no servidor.
 */

// ─── Peças ──────────────────────────────────────────────────────────────────

/**
 * Remessa, devolução e afins somem do funil automaticamente. Sem este aviso, a
 * pergunta "por que esta nota não aparece no Kanban?" não tem resposta na tela em
 * que a pessoa está olhando — e a resposta é a natureza, que fica logo acima.
 */
function AvisoNaturezaNaoOperavel({ natureza }: { natureza: string | null }) {
  const { operavel } = avaliarNatureza(natureza)
  if (operavel) return null
  return (
    <div className="flex items-start gap-2 border-x border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
      <FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <p>
        <span className="font-semibold">Nota não operável.</span> A natureza da operação não gera
        crédito a receber, então ela fica fora do funil de antecipação.
      </p>
    </div>
  )
}

function Campo({
  rotulo,
  children,
  className,
  mono = false,
}: {
  rotulo: string
  children: React.ReactNode
  className?: string
  mono?: boolean
}) {
  return (
    <div className={cn('min-w-0 border-r border-border px-2 py-1 last:border-r-0', className)}>
      <p className="text-[9px] uppercase leading-tight tracking-wide text-muted-foreground">
        {rotulo}
      </p>
      <p className={cn('truncate text-[13px] leading-snug', mono && 'font-mono tabular-nums')}>
        {children ?? '—'}
      </p>
    </div>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border last:border-b-0">
      <h3 className="border-b border-border bg-muted/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider print:bg-transparent">
        {titulo}
      </h3>
      {children}
    </section>
  )
}

function Linha({ children, cols }: { children: React.ReactNode; cols: string }) {
  return (
    <div className={cn('grid border-b border-border last:border-b-0', cols)}>{children}</div>
  )
}

function moeda(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function quantidade(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 4 })
}

function dataHora(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function data(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleDateString('pt-BR')
}

/** O bloco de uma parte (emitente/destinatário, prestador/tomador). */
function BlocoParte({ titulo, parte }: { titulo: string; parte: ParteFiscal }) {
  return (
    <Secao titulo={titulo}>
      <Linha cols="grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
        <Campo rotulo="Nome / Razão social">
          {parte.nome}
          {parte.fantasia && parte.fantasia !== parte.nome ? (
            <span className="text-muted-foreground"> ({parte.fantasia})</span>
          ) : null}
        </Campo>
        <Campo rotulo={parte.tipoDocumento ?? 'CNPJ / CPF'} mono>
          {formatarDocumento(parte.documento)}
        </Campo>
        <Campo rotulo={parte.inscricaoMunicipal ? 'Inscrição municipal' : 'Inscrição estadual'} mono>
          {parte.inscricaoMunicipal ?? parte.inscricaoEstadual}
        </Campo>
      </Linha>
      <Linha cols="grid-cols-1 sm:grid-cols-[3fr_1fr_1fr]">
        <Campo rotulo="Endereço">{enderecoEmLinha(parte.endereco)}</Campo>
        <Campo rotulo="CEP" mono>
          {formatarCep(parte.endereco.cep)}
        </Campo>
        <Campo rotulo="Telefone / E-mail">{parte.endereco.telefone ?? parte.email}</Campo>
      </Linha>
    </Secao>
  )
}

// ─── NFe (layout DANFE) ─────────────────────────────────────────────────────

function ViewNfe({ doc }: { doc: DocumentoNfe }) {
  return (
    <article className="overflow-hidden rounded-md border border-border bg-card text-foreground print:rounded-none print:border-black">
      {/* Cabeçalho: quem emitiu, que documento é, e a chave */}
      <header className="grid border-b border-border sm:grid-cols-[2fr_1fr]">
        <div className="border-b border-border px-3 py-2 sm:border-b-0 sm:border-r">
          <p className="text-sm font-semibold leading-tight">{doc.emitente.nome ?? '—'}</p>
          <p className="text-xs text-muted-foreground">{enderecoEmLinha(doc.emitente.endereco)}</p>
          <p className="font-mono text-xs tabular-nums text-muted-foreground">
            CNPJ {formatarDocumento(doc.emitente.documento)}
            {doc.emitente.inscricaoEstadual ? ` · IE ${doc.emitente.inscricaoEstadual}` : ''}
          </p>
        </div>
        <div className="px-3 py-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider">Nota Fiscal Eletrônica</p>
          <p className="text-lg font-bold tabular-nums">
            Nº {doc.numero ?? '—'}
            <span className="text-sm font-normal text-muted-foreground"> · série {doc.serie ?? '—'}</span>
          </p>
          <p className="text-[11px] text-muted-foreground">
            {doc.tipoOperacao === 'entrada' ? 'ENTRADA' : 'SAÍDA'} · modelo {doc.modelo ?? '55'}
            {doc.ambiente === 'homologacao' ? ' · HOMOLOGAÇÃO' : ''}
          </p>
          {/* A natureza também aparece no bloco de autorização, mas ali fica no meio
              do documento. É ela que decide se a nota é operável, então sobe para
              onde o olho chega primeiro. */}
          {doc.naturezaOperacao ? (
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide">
              {doc.naturezaOperacao}
            </p>
          ) : null}
        </div>
      </header>

      <AvisoNaturezaNaoOperavel natureza={doc.naturezaOperacao} />

      <Secao titulo="Chave de acesso e autorização">
        <Linha cols="grid-cols-1 sm:grid-cols-[3fr_1fr_1fr]">
          <Campo rotulo="Chave de acesso" mono>
            {formatarChave(doc.chaveAcesso)}
          </Campo>
          <Campo rotulo="Protocolo" mono>
            {doc.protocolo}
          </Campo>
          <Campo rotulo="Autorizada em">{dataHora(doc.protocoloEm)}</Campo>
        </Linha>
        <Linha cols="grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
          <Campo rotulo="Natureza da operação">{doc.naturezaOperacao}</Campo>
          <Campo rotulo="Emissão">{dataHora(doc.emitidaEm)}</Campo>
          <Campo rotulo="Saída / entrada">{dataHora(doc.saidaEm)}</Campo>
        </Linha>
      </Secao>

      <BlocoParte titulo="Emitente" parte={doc.emitente} />
      <BlocoParte titulo="Destinatário" parte={doc.destinatario} />

      {doc.duplicatas.length > 0 || doc.fatura ? (
        <Secao titulo="Fatura e duplicatas">
          {doc.fatura ? (
            <Linha cols="grid-cols-3">
              <Campo rotulo="Nº da fatura" mono>
                {doc.fatura.numero}
              </Campo>
              <Campo rotulo="Valor original" mono>
                {moeda(doc.fatura.valorOriginal)}
              </Campo>
              <Campo rotulo="Valor líquido" mono>
                {moeda(doc.fatura.valorLiquido)}
              </Campo>
            </Linha>
          ) : null}
          {doc.duplicatas.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-6">
              {doc.duplicatas.map((d, i) => (
                <Campo key={`${d.numero}-${i}`} rotulo={`Parcela ${d.numero ?? i + 1}`} mono>
                  {data(d.vencimento)} · {moeda(d.valor)}
                </Campo>
              ))}
            </div>
          ) : null}
        </Secao>
      ) : null}

      <Secao titulo={`Itens (${doc.itens.length})`}>
        {doc.itens.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Nenhum item no XML. Isso acontece quando o XML veio truncado — o sync guarda o bruto de
            qualquer forma.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-[9px] uppercase tracking-wide text-muted-foreground print:bg-transparent">
                  <th className="px-2 py-1 text-left font-medium">Cód.</th>
                  <th className="px-2 py-1 text-left font-medium">Descrição</th>
                  <th className="px-2 py-1 text-left font-medium">NCM</th>
                  <th className="px-2 py-1 text-left font-medium">CFOP</th>
                  <th className="px-2 py-1 text-left font-medium">Un.</th>
                  <th className="px-2 py-1 text-right font-medium">Qtd.</th>
                  <th className="px-2 py-1 text-right font-medium">Vl. unit.</th>
                  <th className="px-2 py-1 text-right font-medium">Vl. total</th>
                  <th className="px-2 py-1 text-right font-medium">BC ICMS</th>
                  <th className="px-2 py-1 text-right font-medium">ICMS</th>
                </tr>
              </thead>
              <tbody>
                {doc.itens.map((item) => (
                  <tr key={item.ordem} className="border-b border-border last:border-b-0">
                    <td className="px-2 py-1 font-mono">{item.codigo ?? '—'}</td>
                    <td className="max-w-[22rem] px-2 py-1">{item.descricao ?? '—'}</td>
                    <td className="px-2 py-1 font-mono tabular-nums">{item.ncm ?? '—'}</td>
                    <td className="px-2 py-1 font-mono tabular-nums">{item.cfop ?? '—'}</td>
                    <td className="px-2 py-1">{item.unidade ?? '—'}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">
                      {quantidade(item.quantidade)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">
                      {moeda(item.valorUnitario)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">
                      {moeda(item.valorTotal)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-muted-foreground">
                      {moeda(item.baseIcms)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-muted-foreground">
                      {moeda(item.valorIcms)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>

      <Secao titulo="Cálculo do imposto">
        <Linha cols="grid-cols-2 sm:grid-cols-6">
          <Campo rotulo="BC ICMS" mono>{moeda(doc.totais.baseIcms)}</Campo>
          <Campo rotulo="Valor ICMS" mono>{moeda(doc.totais.valorIcms)}</Campo>
          <Campo rotulo="Valor produtos" mono>{moeda(doc.totais.valorProdutos)}</Campo>
          <Campo rotulo="Frete" mono>{moeda(doc.totais.valorFrete)}</Campo>
          <Campo rotulo="Desconto" mono>{moeda(doc.totais.valorDesconto)}</Campo>
          <Campo rotulo="IPI" mono>{moeda(doc.totais.valorIpi)}</Campo>
        </Linha>
        <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_2fr]">
          <Campo rotulo="PIS" mono>{moeda(doc.totais.valorPis)}</Campo>
          <Campo rotulo="COFINS" mono>{moeda(doc.totais.valorCofins)}</Campo>
          <Campo rotulo="Outras despesas" mono>{moeda(doc.totais.valorOutros)}</Campo>
          <div className="min-w-0 bg-muted/60 px-2 py-1 print:bg-transparent">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
              Valor total da nota
            </p>
            <p className="font-mono text-base font-bold tabular-nums">
              R$ {moeda(doc.totais.valorTotal)}
            </p>
          </div>
        </div>
      </Secao>

      {doc.transporte.transportadora || doc.transporte.volumes ? (
        <Secao titulo="Transporte">
          <Linha cols="grid-cols-2 sm:grid-cols-5">
            <Campo rotulo="Transportadora">{doc.transporte.transportadora}</Campo>
            <Campo rotulo="CNPJ" mono>{formatarDocumento(doc.transporte.documentoTransportadora)}</Campo>
            <Campo rotulo="Volumes" mono>{doc.transporte.volumes}</Campo>
            <Campo rotulo="Peso líquido" mono>{quantidade(doc.transporte.pesoLiquido)}</Campo>
            <Campo rotulo="Peso bruto" mono>{quantidade(doc.transporte.pesoBruto)}</Campo>
          </Linha>
        </Secao>
      ) : null}

      {doc.informacoesComplementares || doc.informacoesFisco ? (
        <Secao titulo="Informações complementares">
          <div className="px-2 py-1.5">
            {doc.informacoesComplementares ? (
              <p className="whitespace-pre-wrap text-[12px] leading-snug">
                {doc.informacoesComplementares}
              </p>
            ) : null}
            {doc.informacoesFisco ? (
              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-snug text-muted-foreground">
                {doc.informacoesFisco}
              </p>
            ) : null}
          </div>
        </Secao>
      ) : null}
    </article>
  )
}

// ─── NFS-e nacional ─────────────────────────────────────────────────────────

function ViewNfse({ doc }: { doc: DocumentoNfse }) {
  return (
    <article className="overflow-hidden rounded-md border border-border bg-card text-foreground print:rounded-none print:border-black">
      <header className="grid border-b border-border sm:grid-cols-[2fr_1fr]">
        <div className="border-b border-border px-3 py-2 sm:border-b-0 sm:border-r">
          <p className="text-sm font-semibold leading-tight">{doc.prestador.nome ?? '—'}</p>
          <p className="text-xs text-muted-foreground">{enderecoEmLinha(doc.prestador.endereco)}</p>
          <p className="font-mono text-xs tabular-nums text-muted-foreground">
            CNPJ {formatarDocumento(doc.prestador.documento)}
            {doc.prestador.inscricaoMunicipal ? ` · IM ${doc.prestador.inscricaoMunicipal}` : ''}
          </p>
        </div>
        <div className="px-3 py-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider">
            NFS-e <span className="font-normal">(padrão nacional)</span>
          </p>
          <p className="text-lg font-bold tabular-nums">
            Nº {doc.numero ?? '—'}
            {doc.serie ? (
              <span className="text-sm font-normal text-muted-foreground"> · série {doc.serie}</span>
            ) : null}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Competência {data(doc.competencia)}
          </p>
        </div>
      </header>

      <Secao titulo="Identificação">
        <Linha cols="grid-cols-1 sm:grid-cols-[3fr_1fr_1fr]">
          <Campo rotulo="Chave de acesso" mono>{formatarChave(doc.chaveAcesso)}</Campo>
          <Campo rotulo="Emissão">{dataHora(doc.emitidaEm)}</Campo>
          <Campo rotulo="Processamento">{dataHora(doc.processadaEm)}</Campo>
        </Linha>
      </Secao>

      <BlocoParte titulo="Prestador" parte={doc.prestador} />
      <BlocoParte titulo="Tomador" parte={doc.tomador} />

      <Secao titulo="Serviço prestado">
        <Linha cols="grid-cols-2 sm:grid-cols-3">
          <Campo rotulo="Código tributação nacional" mono>
            {doc.servico.codigoTributacaoNacional}
          </Campo>
          <Campo rotulo="Código municipal" mono>{doc.servico.codigoTributacaoMunicipal}</Campo>
          <Campo rotulo="Município da prestação" mono>{doc.servico.municipioPrestacao}</Campo>
        </Linha>
        <div className="px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
            Discriminação do serviço
          </p>
          <p className="whitespace-pre-wrap text-[13px] leading-snug">
            {doc.servico.descricao ?? '—'}
          </p>
        </div>
      </Secao>

      <Secao titulo="Valores e tributação">
        <Linha cols="grid-cols-2 sm:grid-cols-4">
          <Campo rotulo="Valor do serviço" mono>{moeda(doc.valores.valorServico)}</Campo>
          <Campo rotulo="Deduções" mono>{moeda(doc.valores.valorDeducoes)}</Campo>
          <Campo rotulo="Base de cálculo" mono>{moeda(doc.valores.baseCalculo)}</Campo>
          <Campo rotulo="Alíquota ISS" mono>
            {doc.valores.aliquota !== null ? `${moeda(doc.valores.aliquota)} %` : '—'}
          </Campo>
        </Linha>
        <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_2fr]">
          <Campo rotulo="Valor do ISS" mono>{moeda(doc.valores.valorIss)}</Campo>
          <Campo rotulo="ISS retido">
            {doc.valores.issRetido === null ? '—' : doc.valores.issRetido ? 'Sim' : 'Não'}
          </Campo>
          <div className="min-w-0 bg-muted/60 px-2 py-1 print:bg-transparent">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
              Valor líquido
            </p>
            <p className="font-mono text-base font-bold tabular-nums">
              R$ {moeda(doc.valores.valorLiquido ?? doc.valores.valorServico)}
            </p>
          </div>
        </div>
      </Secao>

      {doc.informacoesComplementares ? (
        <Secao titulo="Informações complementares">
          <p className="whitespace-pre-wrap px-2 py-1.5 text-[12px] leading-snug">
            {doc.informacoesComplementares}
          </p>
        </Secao>
      ) : null}
    </article>
  )
}

// ─── A porta ────────────────────────────────────────────────────────────────

export function DocumentoFiscalView({ doc }: { doc: DocumentoFiscal }) {
  if (doc.formato === 'nfe') return <ViewNfe doc={doc} />
  if (doc.formato === 'nfse') return <ViewNfse doc={doc} />

  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border p-10 text-center">
      <div className="rounded-full bg-muted p-3">
        <FileWarning className="h-6 w-6 text-muted-foreground" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="font-medium">Não dá para desenhar este documento</p>
        <p className="max-w-md text-sm text-muted-foreground">{doc.motivo}</p>
      </div>
    </div>
  )
}
