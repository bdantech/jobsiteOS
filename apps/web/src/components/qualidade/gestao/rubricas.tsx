'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Eye, Pencil, Plus, Power, Trash2 } from 'lucide-react'
import {
  STATUS_CALIBRACAO_LABELS,
  TIPO_INTERACAO_LABELS,
  TIPO_PENDENCIA_LABELS,
  TIPOS_INTERACAO,
  TIPOS_PENDENCIA,
  TIPOS_RESPOSTA,
  salvarRubricaSchema,
  type RubricaLida,
  type TipoInteracao,
  type TipoPendencia,
  type TipoResposta,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ativarRubricaAction, salvarRubricaAction } from '@/actions/qualidade'
import { cn } from '@/lib/utils'
import { Aviso, ErroCarga, Vazio } from './comum'
import { dataCurta, decimal, numeroBr, textoDeNumero } from './formato'
import { buscarRubricas, qualidadeGestaoKeys } from './queries'

/**
 * RUBRICAS (05C §3) — o modo de operar, versionado.
 *
 * ─── EDITAR NUNCA ALTERA A VERSÃO VIGENTE ───────────────────────────────────
 * "Editar" abre o editor PREENCHIDO com uma versão, e salvar cria a versão seguinte,
 * inativa. Ativar é um segundo passo, consciente, com confirmação — porque ativar
 * devolve a régua à sombra até a recalibração e reinicia a comparabilidade histórica
 * da nota (§3.3). Juntar os dois num botão só faria toda correção de vírgula zerar a
 * comparação do time.
 *
 * ─── A PRÉ-VISUALIZAÇÃO LÊ COMO O CLASSIFICADOR ─────────────────────────────
 * Agrupada por etapa, com a condição de aplicabilidade ANTES de cada item — é a ordem
 * em que o classificador recebe as perguntas (`perguntasDaRubrica`), e é como o
 * gestor deve ler para achar o item que vai cobrar fora de contexto.
 */

const RESPOSTA_LABELS: Record<TipoResposta, string> = {
  sim_nao: 'Sim / não',
  escolha: 'Escolha',
  score: 'Nota (atendeu / não)',
}

export function Rubricas() {
  const q = useQuery({ queryKey: qualidadeGestaoKeys.rubricas(), queryFn: buscarRubricas })
  const [editando, setEditando] = React.useState<{ tipo: TipoInteracao; base: RubricaLida | null } | null>(null)

  if (q.isPending) return <Skeleton className="h-96 w-full" />
  if (q.isError) return <ErroCarga erro={q.error} oque="as rubricas" />

  if (editando) {
    return <Editor tipo={editando.tipo} base={editando.base} onFechar={() => setEditando(null)} />
  }

  return (
    <div className="space-y-4">
      <Aviso tom="info">
        Editar uma rubrica cria uma <strong>versão nova, inativa</strong> — a vigente não muda. A versão nova nasce
        em sombra (analisa e grava, não publica nota) até ser ativada e recalibrada. E mudar a rubrica reinicia a
        comparabilidade histórica: nota de uma versão não se compara com nota de outra.
      </Aviso>
      {TIPOS_INTERACAO.map((tipo) => {
        const versoes = q.data.filter((r) => r.tipo_interacao === tipo)
        return (
          <Card key={tipo}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{TIPO_INTERACAO_LABELS[tipo]}</CardTitle>
                {versoes.length === 0 ? (
                  <Button size="sm" onClick={() => setEditando({ tipo, base: null })}>
                    <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Nova rubrica
                  </Button>
                ) : null}
              </div>
              <CardDescription>
                {versoes.length} versão(ões). A ativa é a que analisa as interações novas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {versoes.length === 0 ? (
                <Vazio>Nenhuma rubrica deste tipo.</Vazio>
              ) : (
                versoes.map((r) => <Versao key={r.id} r={r} onEditar={() => setEditando({ tipo, base: r })} />)
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function Versao({ r, onEditar }: { r: RubricaLida; onEditar: () => void }) {
  const [modo, setModo] = React.useState<'fechado' | 'itens' | 'previa'>('fechado')
  const [ativando, setAtivando] = React.useState(false)
  const publicados = r.itens.filter((i) => i.ativo && i.status_calibracao === 'publicado').length
  const emSombra = !r.calibrada_em || publicados === 0

  return (
    <div className={cn('rounded-lg border', r.ativa && 'border-primary/50')}>
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              v{r.versao} — {r.nome}
            </span>
            {r.ativa ? <Badge>Ativa</Badge> : null}
            {emSombra ? (
              <Badge variant="warning">Em sombra</Badge>
            ) : (
              <Badge variant="success">Calibrada em {dataCurta(r.calibrada_em)}</Badge>
            )}
            {r.itens.some((i) => i.precisa_revisao) ? <Badge variant="warning">Item a reescrever</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {r.itens.length} itens · criada em {dataCurta(r.criada_em)}
            {r.ativada_em ? ` · ativada em ${dataCurta(r.ativada_em)}` : ''}
            {r.descricao ? ` · ${r.descricao}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={modo === 'itens' ? 'secondary' : 'ghost'}
            className="h-7 text-xs"
            onClick={() => setModo(modo === 'itens' ? 'fechado' : 'itens')}
          >
            Itens
          </Button>
          <Button
            size="sm"
            variant={modo === 'previa' ? 'secondary' : 'ghost'}
            className="h-7 text-xs"
            onClick={() => setModo(modo === 'previa' ? 'fechado' : 'previa')}
          >
            <Eye className="mr-1 h-3.5 w-3.5" aria-hidden /> Pré-visualização
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onEditar}>
            <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden /> Editar (nova versão)
          </Button>
          {!r.ativa ? (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAtivando(true)}>
              <Power className="mr-1 h-3.5 w-3.5" aria-hidden /> Ativar esta versão
            </Button>
          ) : null}
        </div>
      </div>

      {modo === 'itens' ? (
        <div className="border-t">
          <TabelaItens r={r} />
        </div>
      ) : null}
      {modo === 'previa' ? (
        <div className="border-t p-3">
          <Previa itens={r.itens.filter((i) => i.ativo)} />
        </div>
      ) : null}

      <ConfirmarAtivacao r={r} aberto={ativando} onFechar={() => setAtivando(false)} />
    </div>
  )
}

function TabelaItens({ r }: { r: RubricaLida }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-normal">Etapa</th>
            <th scope="col" className="px-3 py-2 font-normal">Item</th>
            <th scope="col" className="px-3 py-2 font-normal">Resposta</th>
            <th scope="col" className="px-3 py-2 text-right font-normal">Peso</th>
            <th scope="col" className="px-3 py-2 font-normal">Orientação</th>
            <th scope="col" className="px-3 py-2 font-normal">Calibração</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {r.itens.map((it) => (
            <tr key={it.id} className={cn('align-top', !it.ativo && 'opacity-60', it.precisa_revisao && 'bg-amber-50/60 dark:bg-amber-950/20')}>
              <td className="px-3 py-2 text-xs text-muted-foreground">{it.etapa ?? 'Geral'}</td>
              <td className="max-w-[24rem] px-3 py-2">
                <p className="font-medium">
                  {it.rotulo} <code className="text-[11px] font-normal text-muted-foreground">{it.chave}</code>
                </p>
                {it.condicao_aplicabilidade ? (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Só se:</span> {it.condicao_aplicabilidade}
                  </p>
                ) : null}
                <p className="text-xs">{it.pergunta}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {it.gera_pendencia ? (
                    <Badge variant="outline" className="text-[10px]">
                      Gera pendência: {TIPO_PENDENCIA_LABELS[it.gera_pendencia]}
                    </Badge>
                  ) : null}
                  {it.precisa_revisao ? (
                    <Badge variant="warning" className="text-[10px]">
                      Pergunta marcada para reescrever
                    </Badge>
                  ) : null}
                  {!it.ativo ? (
                    <Badge variant="neutral" className="text-[10px]">
                      Desativado
                    </Badge>
                  ) : null}
                </div>
              </td>
              <td className="px-3 py-2 text-xs">
                {RESPOSTA_LABELS[it.tipo_resposta]}
                {it.opcoes && it.opcoes.length > 0 ? <span className="block text-muted-foreground">{it.opcoes.join(' · ')}</span> : null}
                <span className="block text-muted-foreground">
                  {descreverAtende(it.tipo_resposta, it.atende)}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{decimal(it.peso)}</td>
              <td className="max-w-[18rem] px-3 py-2 text-xs text-muted-foreground">{it.orientacao}</td>
              <td className="px-3 py-2 text-xs">
                {STATUS_CALIBRACAO_LABELS[it.status_calibracao]}
                {it.limiar !== null ? <span className="block text-muted-foreground">limiar {decimal(it.limiar)}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function descreverAtende(tipo: TipoResposta, atende: readonly string[] | null): string {
  if (tipo === 'score') return 'atendido pela nota'
  if (tipo === 'escolha') return atende && atende.length > 0 ? `atende: ${atende.join(', ')}` : 'informativo (não pontua)'
  const a = atende && atende.length > 0 ? atende : ['sim']
  return a.includes('sim') ? 'atende quando a resposta é sim' : 'atende quando a resposta é não'
}

// ─── Pré-visualização ───────────────────────────────────────────────────────

interface ItemPrevia {
  chave: string
  etapa: string | null
  rotulo: string
  pergunta: string
  tipo_resposta: TipoResposta
  opcoes: readonly string[] | null
  atende: readonly string[] | null
  peso: number
  condicao_aplicabilidade: string | null
  orientacao: string
}

function Previa({ itens }: { itens: ItemPrevia[] }) {
  const grupos: Array<{ etapa: string; itens: ItemPrevia[] }> = []
  for (const it of itens) {
    const etapa = it.etapa?.trim() || 'Geral'
    const g = grupos.find((x) => x.etapa === etapa)
    if (g) g.itens.push(it)
    else grupos.push({ etapa, itens: [it] })
  }
  if (itens.length === 0) return <Vazio>Nenhum item ativo.</Vazio>

  return (
    <div className="space-y-4">
      {grupos.map((g) => (
        <section key={g.etapa} className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.etapa}</h4>
          <ol className="space-y-2">
            {g.itens.map((it) => (
              <li key={it.chave} className="space-y-1 rounded-md border p-3 text-sm">
                <p className="font-medium">
                  {it.rotulo}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">peso {decimal(it.peso)}</span>
                </p>
                {it.condicao_aplicabilidade ? (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">1. Aplicável?</span> {it.condicao_aplicabilidade}{' '}
                    <span className="italic">— se não, o item sai do denominador.</span>
                  </p>
                ) : null}
                <p>
                  {it.condicao_aplicabilidade ? <span className="font-medium">2. </span> : null}
                  {it.pergunta}
                  {it.tipo_resposta === 'escolha' && it.opcoes ? (
                    <span className="text-muted-foreground"> ({it.opcoes.join(' · ')})</span>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">{descreverAtende(it.tipo_resposta, it.atende)}</p>
                <p className="text-xs">
                  <span className="text-muted-foreground">Quando falha, o vendedor lê: </span>
                  {it.orientacao}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

// ─── Ativação ───────────────────────────────────────────────────────────────

function ConfirmarAtivacao({ r, aberto, onFechar }: { r: RubricaLida; aberto: boolean; onFechar: () => void }) {
  const qc = useQueryClient()
  const [enviando, setEnviando] = React.useState(false)

  async function ativar() {
    setEnviando(true)
    const res = await ativarRubricaAction({ rubrica_id: r.id })
    setEnviando(false)
    if (!res.ok) return void toast.error(res.message)
    toast.success(`Versão ${r.versao} ativada. A recalibração foi pedida ao worker.`)
    void qc.invalidateQueries({ queryKey: qualidadeGestaoKeys.all })
    onFechar()
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Ativar a versão {r.versao} de {TIPO_INTERACAO_LABELS[r.tipo_interacao].toLowerCase()}?
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>
                A versão ativa hoje deixa de analisar as interações novas. {r.calibrada_em ? '' : 'Esta versão ainda não foi calibrada: '}
                a versão nova começa <strong>em sombra</strong> — analisa e grava, mas não publica nota a ninguém — até
                ser recalibrada. Os rótulos que já existem são reaproveitados pela chave de cada item.
              </p>
              <p>
                <strong>Mudar a rubrica reinicia a comparabilidade histórica da nota.</strong> Nota desta versão não se
                compara com nota da anterior; a evolução no tempo passa a valer a partir daqui.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={enviando} onClick={() => void ativar()}>
            {enviando ? 'Ativando…' : 'Ativar esta versão'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Editor (cria versão nova) ──────────────────────────────────────────────

interface ItemForm {
  /** Só para a lista do React: a chave do item é editável e não serve de key. */
  uid: string
  chave: string
  etapa: string
  rotulo: string
  pergunta: string
  tipo_resposta: TipoResposta
  /** Uma opção por linha. */
  opcoes: string
  atende: string[]
  peso: string
  condicao_aplicabilidade: string
  orientacao: string
  gera_pendencia: TipoPendencia | ''
  ativo: boolean
}

let seq = 0
const novoUid = () => `i${++seq}`

function itemVazio(): ItemForm {
  return {
    uid: novoUid(),
    chave: '',
    etapa: '',
    rotulo: '',
    pergunta: '',
    tipo_resposta: 'sim_nao',
    opcoes: '',
    atende: ['sim'],
    peso: '1',
    condicao_aplicabilidade: '',
    orientacao: '',
    gera_pendencia: '',
    ativo: true,
  }
}

function itemDaVersao(it: RubricaLida['itens'][number]): ItemForm {
  return {
    uid: novoUid(),
    chave: it.chave,
    etapa: it.etapa ?? '',
    rotulo: it.rotulo,
    pergunta: it.pergunta,
    tipo_resposta: it.tipo_resposta,
    opcoes: (it.opcoes ?? []).join('\n'),
    atende: [...(it.atende ?? (it.tipo_resposta === 'sim_nao' ? ['sim'] : []))],
    peso: textoDeNumero(it.peso),
    condicao_aplicabilidade: it.condicao_aplicabilidade ?? '',
    orientacao: it.orientacao,
    gera_pendencia: it.gera_pendencia ?? '',
    ativo: it.ativo,
  }
}

const opcoesDe = (texto: string) =>
  texto
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

function paraEntrada(it: ItemForm) {
  const opcoes = it.tipo_resposta === 'escolha' ? opcoesDe(it.opcoes) : null
  const atende =
    it.tipo_resposta === 'score'
      ? null
      : it.tipo_resposta === 'escolha'
        ? it.atende.filter((a) => opcoes?.includes(a))
        : it.atende.length > 0
          ? it.atende
          : ['sim']
  return {
    chave: it.chave.trim(),
    etapa: it.etapa.trim() || null,
    rotulo: it.rotulo.trim(),
    pergunta: it.pergunta.trim(),
    tipo_resposta: it.tipo_resposta,
    opcoes,
    atende: atende && atende.length > 0 ? atende : null,
    peso: numeroBr(it.peso) ?? Number.NaN,
    condicao_aplicabilidade: it.condicao_aplicabilidade.trim() || null,
    orientacao: it.orientacao.trim(),
    gera_pendencia: it.gera_pendencia || null,
    ativo: it.ativo,
  }
}

function Editor({ tipo, base, onFechar }: { tipo: TipoInteracao; base: RubricaLida | null; onFechar: () => void }) {
  const qc = useQueryClient()
  const [nome, setNome] = React.useState(base?.nome ?? `Rubrica de ${TIPO_INTERACAO_LABELS[tipo].toLowerCase()}`)
  const [descricao, setDescricao] = React.useState(base?.descricao ?? '')
  const [itens, setItens] = React.useState<ItemForm[]>(() => (base ? base.itens.map(itemDaVersao) : [itemVazio()]))
  const [erros, setErros] = React.useState<Record<string, string>>({})
  const [previa, setPrevia] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)

  function mudar(uid: string, p: Partial<ItemForm>) {
    setItens((xs) => xs.map((x) => (x.uid === uid ? { ...x, ...p } : x)))
  }
  function mover(idx: number, d: -1 | 1) {
    setItens((xs) => {
      const j = idx + d
      if (j < 0 || j >= xs.length) return xs
      const c = [...xs]
      ;[c[idx], c[j]] = [c[j]!, c[idx]!]
      return c
    })
  }

  const entrada = { tipo_interacao: tipo, nome: nome.trim(), descricao: descricao.trim() || null, itens: itens.map(paraEntrada) }

  async function salvar() {
    const v = salvarRubricaSchema.safeParse(entrada)
    if (!v.success) {
      // Erro por campo: `itens.3.pergunta` vira a mensagem embaixo do campo certo.
      const porCampo: Record<string, string> = {}
      for (const iss of v.error.issues) {
        const [raiz, idx, campo] = iss.path
        const chave = raiz === 'itens' && typeof idx === 'number' ? `${itens[idx]?.uid}.${String(campo ?? '')}` : String(raiz)
        porCampo[chave] ??= iss.message
      }
      setErros(porCampo)
      setPrevia(false)
      return void toast.error(`Há ${v.error.issues.length} problema(s) no formulário.`)
    }
    setErros({})
    setSalvando(true)
    const r = await salvarRubricaAction(v.data)
    setSalvando(false)
    if (!r.ok) return void toast.error(r.message)
    toast.success(`Versão ${r.data.versao} criada, inativa. Ative-a quando estiver pronta.`)
    void qc.invalidateQueries({ queryKey: qualidadeGestaoKeys.rubricas() })
    onFechar()
  }

  const erro = (uid: string, campo: string) => erros[`${uid}.${campo}`]

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            {base ? `Nova versão a partir da v${base.versao}` : 'Nova rubrica'} — {TIPO_INTERACAO_LABELS[tipo]}
          </CardTitle>
          <div className="flex gap-1.5">
            <Button size="sm" variant={previa ? 'ghost' : 'secondary'} className="h-7 text-xs" onClick={() => setPrevia(false)}>
              Editar
            </Button>
            <Button size="sm" variant={previa ? 'secondary' : 'ghost'} className="h-7 text-xs" onClick={() => setPrevia(true)}>
              <Eye className="mr-1 h-3.5 w-3.5" aria-hidden /> Pré-visualização
            </Button>
          </div>
        </div>
        <CardDescription>
          Salvar cria a versão {base ? 'seguinte' : '1'}, <strong>inativa</strong>: a versão vigente continua
          analisando até você ativar a nova. A pergunta vai ao classificador exatamente como escrita — escreva-a
          observável, sobre o que foi dito.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {previa ? (
          <Previa
            itens={itens
              .filter((i) => i.ativo)
              .map((i) => {
                const e = paraEntrada(i)
                return {
                  ...e,
                  rotulo: e.rotulo || e.chave || '(sem rótulo)',
                  peso: Number.isFinite(e.peso) ? e.peso : 0,
                  chave: i.uid,
                }
              })}
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="rub-nome" className="text-xs">
                  Nome
                </Label>
                <Input id="rub-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
                {erros.nome ? <p className="text-xs text-destructive">{erros.nome}</p> : null}
              </div>
              <div className="space-y-1">
                <Label htmlFor="rub-desc" className="text-xs">
                  Descrição (o que mudou nesta versão)
                </Label>
                <Input id="rub-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
              </div>
            </div>
            {erros.itens ? <p className="text-xs text-destructive">{erros.itens}</p> : null}

            <ol className="space-y-3">
              {itens.map((it, idx) => (
                <li key={it.uid} className={cn('space-y-3 rounded-lg border p-3', !it.ativo && 'opacity-70')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Item {idx + 1}</span>
                    <div className="flex items-center gap-1">
                      <label className="mr-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Switch checked={it.ativo} onCheckedChange={(b) => mudar(it.uid, { ativo: b })} aria-label="Item ativo" />
                        ativo
                      </label>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Subir" disabled={idx === 0} onClick={() => mover(idx, -1)}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label="Descer"
                        disabled={idx === itens.length - 1}
                        onClick={() => mover(idx, 1)}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label="Remover item"
                        onClick={() => setItens((xs) => xs.filter((x) => x.uid !== it.uid))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <Campo id={`${it.uid}-chave`} rotulo="Chave" erro={erro(it.uid, 'chave')}
                      nota="Os rótulos de calibração seguem a chave entre versões. Trocar a chave é começar do zero.">
                      <Input id={`${it.uid}-chave`} value={it.chave} placeholder="explorou_dor"
                        onChange={(e) => mudar(it.uid, { chave: e.target.value })} />
                    </Campo>
                    <Campo id={`${it.uid}-rotulo`} rotulo="Rótulo" erro={erro(it.uid, 'rotulo')}>
                      <Input id={`${it.uid}-rotulo`} value={it.rotulo} onChange={(e) => mudar(it.uid, { rotulo: e.target.value })} />
                    </Campo>
                    <Campo id={`${it.uid}-etapa`} rotulo="Etapa" erro={erro(it.uid, 'etapa')}>
                      <Input id={`${it.uid}-etapa`} value={it.etapa} placeholder="Dor, Solução, Segurança…"
                        onChange={(e) => mudar(it.uid, { etapa: e.target.value })} />
                    </Campo>
                  </div>

                  <Campo id={`${it.uid}-cond`} rotulo="Condição de aplicabilidade (opcional)" erro={erro(it.uid, 'condicao_aplicabilidade')}
                    nota="Outra pergunta sim/não, feita ANTES do item. Se a resposta for não, o item sai do denominador — não conta como falha.">
                    <Textarea id={`${it.uid}-cond`} className="min-h-[52px]" value={it.condicao_aplicabilidade}
                      placeholder="A conversa terminou sem recusa explícita do cliente?"
                      onChange={(e) => mudar(it.uid, { condicao_aplicabilidade: e.target.value })} />
                  </Campo>

                  <Campo id={`${it.uid}-pergunta`} rotulo="Pergunta ao classificador" erro={erro(it.uid, 'pergunta')}>
                    <Textarea id={`${it.uid}-pergunta`} className="min-h-[52px]" value={it.pergunta}
                      onChange={(e) => mudar(it.uid, { pergunta: e.target.value })} />
                  </Campo>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <Campo id={`${it.uid}-tipo`} rotulo="Tipo de resposta">
                      <select
                        id={`${it.uid}-tipo`}
                        value={it.tipo_resposta}
                        onChange={(e) => {
                          const t = e.target.value as TipoResposta
                          mudar(it.uid, { tipo_resposta: t, atende: t === 'sim_nao' ? ['sim'] : [] })
                        }}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      >
                        {TIPOS_RESPOSTA.map((t) => (
                          <option key={t} value={t}>
                            {RESPOSTA_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </Campo>
                    <Campo id={`${it.uid}-peso`} rotulo="Peso" erro={erro(it.uid, 'peso')}
                      nota="Peso zero é informativo: grava a resposta, não pontua.">
                      <Input id={`${it.uid}-peso`} inputMode="decimal" value={it.peso}
                        onChange={(e) => mudar(it.uid, { peso: e.target.value })} />
                    </Campo>
                    <Campo id={`${it.uid}-pend`} rotulo="Gera pendência quando falha">
                      <select
                        id={`${it.uid}-pend`}
                        value={it.gera_pendencia}
                        onChange={(e) => mudar(it.uid, { gera_pendencia: e.target.value as TipoPendencia | '' })}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="">Não</option>
                        {TIPOS_PENDENCIA.map((t) => (
                          <option key={t} value={t}>
                            {TIPO_PENDENCIA_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </Campo>
                  </div>

                  {it.tipo_resposta === 'sim_nao' ? (
                    <Campo id={`${it.uid}-atende`} rotulo="Conta como atendido quando a resposta é">
                      <select
                        id={`${it.uid}-atende`}
                        value={it.atende.includes('nao') ? 'nao' : 'sim'}
                        onChange={(e) => mudar(it.uid, { atende: [e.target.value] })}
                        className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="sim">Sim</option>
                        <option value="nao">Não (ex.: &quot;ficou pergunta sem resposta?&quot;)</option>
                      </select>
                    </Campo>
                  ) : null}

                  {it.tipo_resposta === 'escolha' ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Campo id={`${it.uid}-opcoes`} rotulo="Opções (uma por linha)" erro={erro(it.uid, 'opcoes')}>
                        <Textarea id={`${it.uid}-opcoes`} className="min-h-[96px]" value={it.opcoes}
                          onChange={(e) => mudar(it.uid, { opcoes: e.target.value })} />
                      </Campo>
                      <fieldset className="space-y-1">
                        <legend className="text-xs font-medium">Opções que contam como atendido</legend>
                        {opcoesDe(it.opcoes).length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">Escreva as opções primeiro.</p>
                        ) : (
                          opcoesDe(it.opcoes).map((o) => (
                            <label key={o} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={it.atende.includes(o)}
                                onChange={(e) =>
                                  mudar(it.uid, {
                                    atende: e.target.checked ? [...it.atende, o] : it.atende.filter((a) => a !== o),
                                  })
                                }
                              />
                              {o}
                            </label>
                          ))
                        )}
                        <p className="text-[11px] text-muted-foreground">Nenhuma marcada = item informativo (registra, não pontua).</p>
                      </fieldset>
                    </div>
                  ) : null}

                  <Campo id={`${it.uid}-orient`} rotulo="Orientação ao vendedor" erro={erro(it.uid, 'orientacao')}
                    nota="O que o vendedor lê quando o item falha: o que era esperado, não um julgamento.">
                    <Textarea id={`${it.uid}-orient`} className="min-h-[52px]" value={it.orientacao}
                      onChange={(e) => mudar(it.uid, { orientacao: e.target.value })} />
                  </Campo>
                </li>
              ))}
            </ol>

            <Button size="sm" variant="outline" onClick={() => setItens((xs) => [...xs, itemVazio()])}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Adicionar item
            </Button>
          </>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={salvando} onClick={() => void salvar()}>
            {salvando ? 'Salvando…' : 'Salvar como nova versão'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function Campo({
  id,
  rotulo,
  erro,
  nota,
  children,
}: {
  id: string
  rotulo: string
  erro?: string
  nota?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {rotulo}
      </Label>
      {children}
      {erro ? <p className="text-xs text-destructive">{erro}</p> : nota ? <p className="text-[11px] leading-snug text-muted-foreground">{nota}</p> : null}
    </div>
  )
}
