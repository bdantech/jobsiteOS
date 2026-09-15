'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRight, Ban, ExternalLink, Layers, MoreHorizontal } from 'lucide-react'
import {
  ESTAGIOS_ABERTOS,
  ESTAGIOS_ENCERRADOS,
  ESTAGIO_FUNIL_LABELS,
  MOTIVOS_SEM_INTERESSE,
  MOTIVO_SEM_INTERESSE_DESCRICOES,
  MOTIVO_SEM_INTERESSE_LABELS,
  type EstagioFunil,
  type MotivoSemInteresse,
} from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { marcarSemInteresseAction, moverEstagioAction } from '@/actions/antecipacao'
import { antecipacaoKeys, type NotaFunil } from './queries'

/**
 * As ações do card (§5). Duas delas pedem TEXTO obrigatório, e isso não é
 * burocracia:
 *
 *   "perdida" sem motivo joga fora a única informação que torna a métrica por
 *   faixa acionável — sem ela, "a faixa boa converte 4%" não sugere o que mudar.
 *
 *   "sem interesse" sem motivo e sem prazo é uma decisão irreversível tomada por
 *   um clique. O diálogo obriga a escolher entre 90 dias e ETERNA porque as duas
 *   coisas são diferentes: uma é "não agora", a outra é LGPD.
 */

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: antecipacaoKeys.all })
}

// ─── Mover estágio ──────────────────────────────────────────────────────────

export function MoverEstagioDialog({
  nota,
  destino,
  aberto,
  onOpenChange,
}: {
  nota: NotaFunil
  destino: EstagioFunil
  aberto: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [motivo, setMotivo] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)
  const pedeMotivo = destino === 'perdida'

  async function confirmar() {
    if (pedeMotivo && motivo.trim() === '') return
    setSalvando(true)
    const r = await moverEstagioAction({
      access_key: nota.access_key,
      estagio_funil: destino,
      perda_motivo: pedeMotivo ? motivo.trim() : undefined,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(`Nota movida para ${ESTAGIO_FUNIL_LABELS[destino]}.`)
    setMotivo('')
    onOpenChange(false)
    invalidar(qc)
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover para {ESTAGIO_FUNIL_LABELS[destino]}</DialogTitle>
          <DialogDescription>
            Nota {nota.numero ?? nota.access_key} de{' '}
            {nota.fornecedor_nome ?? nota.fornecedor_cnpj}.
          </DialogDescription>
        </DialogHeader>

        {pedeMotivo && (
          <div className="space-y-2">
            <Label htmlFor="perda-motivo">Motivo da perda</Label>
            <Textarea
              id="perda-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: já antecipou com outro fundo; taxa fora do aceitável; sacado recusou cessão."
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Obrigatório. É o que permite regular os critérios de faixa com dados em vez de
              impressão.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={() => void confirmar()} disabled={salvando || (pedeMotivo && motivo.trim() === '')}>
            {salvando ? 'Movendo…' : 'Confirmar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Sem interesse ──────────────────────────────────────────────────────────

/**
 * Marcar um fornecedor como sem interesse, a partir do card da nota.
 *
 * ─── UMA LISTA SÓ (0207) ────────────────────────────────────────────────────
 * Este botão gravava só em `supressao`, e a lista que a equipe abre — "Fornecedores sem
 * interesse" — lê `antecipacao_fornecedor_sem_interesse`. As 249 decisões tomadas aqui
 * não apareciam lá: quem abria a lista via três nomes e concluía que ninguém tinha curado
 * nada. Agora as duas portas alimentam a mesma lista.
 *
 * ─── SÃO DUAS PERGUNTAS, E O DIÁLOGO PASSOU A FAZER AS DUAS ────────────────
 * "Por que ele sai do funil" e "posso voltar a abordá-lo" não são a mesma coisa, e
 * tratá-las como uma foi o que produziu 250 descartes com prazo de 90 dias — inclusive
 * 146 funcionários PJ, que não deixam de ser funcionários PJ em noventa dias.
 *
 *   MOTIVO     → a lista. Permanente, de lista fechada, revertível num clique.
 *   ABORDAGEM  → a supressão de canal. 90 dias ou nunca mais.
 *
 * O motivo é enumerado pelo mesmo motivo do diálogo da ficha do fornecedor: "por que
 * descartamos 250 fornecedores?" só tem resposta se ninguém puder digitar a mesma razão
 * de sete formas. A observação continua existindo para o que o enum não cobre, e é
 * obrigatória em "outro".
 */
export function SemInteresseDialog({
  cnpj,
  nome,
  aberto,
  onOpenChange,
}: {
  cnpj: string
  nome: string | null
  aberto: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [motivo, setMotivo] = React.useState<MotivoSemInteresse | ''>('')
  const [observacao, setObservacao] = React.useState('')
  const [eterna, setEterna] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)

  // Reabrir para OUTRO fornecedor não pode herdar o motivo do anterior: é o caminho
  // mais curto para descartar meia lista com a razão errada.
  React.useEffect(() => {
    if (aberto) {
      setMotivo('')
      setObservacao('')
      setEterna(false)
    }
  }, [aberto, cnpj])

  const precisaObservacao = motivo === 'outro'
  const podeSalvar = motivo !== '' && (!precisaObservacao || observacao.trim() !== '')

  async function confirmar() {
    if (!podeSalvar) return
    setSalvando(true)
    const r = await marcarSemInteresseAction({
      fornecedor_cnpj: cnpj,
      motivo,
      observacao: observacao.trim() || null,
      fornecedor_nome: nome,
      eterna,
      dias: 90,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      eterna
        ? 'Fora do funil e sem abordagem — permanente.'
        : 'Fora do funil. A abordagem volta a ser liberada em 90 dias.',
    )
    onOpenChange(false)
    invalidar(qc)
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar sem interesse</DialogTitle>
          <DialogDescription>
            {nome ?? cnpj}. Ele entra na lista de fornecedores sem interesse, as notas dele
            saem dos funis na hora, e dá para reverter num clique.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sem-interesse-motivo">Por que ele sai do funil</Label>
            {/* `undefined` e não '': string vazia é um valor selecionado para o Radix,
                e o placeholder nunca apareceria. */}
            <Select
              value={motivo || undefined}
              onValueChange={(v) => setMotivo(v as MotivoSemInteresse)}
            >
              <SelectTrigger id="sem-interesse-motivo">
                <SelectValue placeholder="Escolha o motivo" />
              </SelectTrigger>
              <SelectContent>
                {MOTIVOS_SEM_INTERESSE.map((m) => (
                  <SelectItem key={m} value={m}>
                    {MOTIVO_SEM_INTERESSE_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {motivo ? (
              <p className="text-xs text-muted-foreground">
                {MOTIVO_SEM_INTERESSE_DESCRICOES[motivo]}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="sem-interesse-obs">
              Observação{precisaObservacao ? '' : ' (opcional)'}
            </Label>
            <Textarea
              id="sem-interesse-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="O que o motivo da lista não conta."
              rows={2}
            />
            {precisaObservacao && observacao.trim() === '' ? (
              <p className="text-xs text-destructive">
                &quot;Outro&quot; sem explicação é indistinguível de um clique errado.
              </p>
            ) : null}
          </div>

          {/*
            A SEGUNDA pergunta, e ela é só sobre ABORDAGEM. A saída do funil é permanente
            nos dois casos — quem a mantém é a lista, não a supressão. Antes estes botões
            diziam "expira e ele volta ao funil", e era isso que trazia de volta 146
            funcionários PJ noventa dias depois.
          */}
          <div className="space-y-2 border-t pt-4">
            <Label>Podemos voltar a abordá-lo?</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant={eterna ? 'outline' : 'default'}
                onClick={() => setEterna(false)}
                aria-pressed={!eterna}
                /*
                 * `whitespace-normal` anula o `whitespace-nowrap` da base do Button.
                 * Sem ele a segunda linha não quebra: ela sai do botão, atravessa a
                 * borda do diálogo e some. O `w-full` é o par disso — é ele que dá ao
                 * texto uma largura para quebrar DENTRO.
                 */
                className="h-auto flex-col items-start gap-1 whitespace-normal py-3 text-left"
              >
                <span className="font-medium">Em 90 dias</span>
                <span className="w-full text-xs font-normal leading-snug opacity-80">
                  Nenhum canal o toca até lá. Ele NÃO volta ao funil.
                </span>
              </Button>
              <Button
                type="button"
                variant={eterna ? 'default' : 'outline'}
                onClick={() => setEterna(true)}
                aria-pressed={eterna}
                className="h-auto flex-col items-start gap-1 whitespace-normal py-3 text-left"
              >
                <span className="font-medium">Nunca mais</span>
                <span className="w-full text-xs font-normal leading-snug opacity-80">
                  LGPD, ou quem pediu para não ser procurado.
                </span>
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirmar()}
            disabled={salvando || !podeSalvar}
          >
            {salvando ? 'Marcando…' : 'Marcar sem interesse'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── O menu do card ─────────────────────────────────────────────────────────

export function MenuAcoesNota({ nota }: { nota: NotaFunil }) {
  const [destino, setDestino] = React.useState<EstagioFunil | null>(null)
  const [semInteresse, setSemInteresse] = React.useState(false)

  /*
   * "Em prospecção" não é escolha de quem olha o card: a nota entra lá sozinha quando a
   * primeira mensagem sai para o fornecedor (trigger em `comunicacoes`), ou quando a
   * conversa do celular é vinculada à empresa. O banco recusa a transição manual — deixar
   * a opção no menu só entregaria um erro a quem clicasse.
   */
  const estagios: readonly EstagioFunil[] = [...ESTAGIOS_ABERTOS, ...ESTAGIOS_ENCERRADOS].filter(
    (e) =>
      e !== nota.estagio_funil &&
      e !== 'expirada' &&
      !(nota.estagio_funil === 'a_prospectar' && e === 'em_prospeccao'),
  )

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Ações da nota">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Mover para</DropdownMenuLabel>
          {estagios.map((e) => (
            <DropdownMenuItem key={e} onSelect={() => setDestino(e)}>
              <ArrowRight className="mr-2 h-4 w-4" />
              {ESTAGIO_FUNIL_LABELS[e]}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          <DropdownMenuItem asChild>
            <Link href={`/antecipacao/fornecedores/${nota.fornecedor_cnpj}`}>
              <Layers className="mr-2 h-4 w-4" />
              Ver notas do fornecedor
            </Link>
          </DropdownMenuItem>

          {nota.fornecedor_empresa_id && (
            <DropdownMenuItem asChild>
              <Link href={`/empresas/${nota.fornecedor_empresa_id}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Company 360 do fornecedor
              </Link>
            </DropdownMenuItem>
          )}
          {nota.sacado_empresa_id && (
            <DropdownMenuItem asChild>
              <Link href={`/empresas/${nota.sacado_empresa_id}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Company 360 do sacado
              </Link>
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => setSemInteresse(true)} className="text-destructive">
            <Ban className="mr-2 h-4 w-4" />
            Fornecedor sem interesse
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {destino && (
        <MoverEstagioDialog
          nota={nota}
          destino={destino}
          aberto
          onOpenChange={(v) => !v && setDestino(null)}
        />
      )}
      {nota.fornecedor_cnpj && (
        <SemInteresseDialog
          cnpj={nota.fornecedor_cnpj}
          nome={nota.fornecedor_nome}
          aberto={semInteresse}
          onOpenChange={setSemInteresse}
        />
      )}
    </>
  )
}
