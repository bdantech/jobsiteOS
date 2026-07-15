'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { criarImportacaoAction } from '@/actions/mercado-importacao'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { importadorKeys } from './queries'

/** Espelha MAX_ARQUIVO_BYTES do servidor: aqui é UX, lá é a regra. */
const MAX_MB = 15

function formatTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * O upload. O arquivo vai por FormData para a server action — nunca direto do
 * navegador para o Storage: o bucket é privado e a chave que escreve nele é a de
 * serviço, que jamais sai do servidor.
 */
export function NovaImportacaoDialog() {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [aberto, setAberto] = React.useState(false)
  const [arquivo, setArquivo] = React.useState<File | null>(null)
  const [nome, setNome] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)

  function reiniciar() {
    setArquivo(null)
    setNome('')
    setEnviando(false)
  }

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!arquivo || enviando) return

    if (arquivo.size > MAX_MB * 1024 * 1024) {
      toast.error(`O arquivo tem mais de ${MAX_MB} MB. Divida a lista antes de importar.`)
      return
    }

    setEnviando(true)

    const formData = new FormData()
    formData.set('arquivo', arquivo)
    formData.set('nome', nome.trim() || arquivo.name)

    try {
      const resultado = await criarImportacaoAction(formData)

      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }

      await queryClient.invalidateQueries({ queryKey: importadorKeys.all })
      toast.success('Lista enviada. Agora mapeie as colunas.')
      setAberto(false)
      reiniciar()
      router.push(`/mercado/importacoes/${resultado.data.id}`)
    } catch (erro) {
      console.error('[importador] falha no upload', erro)
      toast.error('Não foi possível enviar o arquivo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(proximo) => {
        if (enviando) return
        setAberto(proximo)
        if (!proximo) reiniciar()
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Upload className="mr-2 h-4 w-4" aria-hidden />
          Nova importação
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <form onSubmit={enviar}>
          <DialogHeader>
            <DialogTitle>Nova importação de lista</DialogTitle>
            <DialogDescription>
              Envie um .xlsx ou .csv. Na próxima tela você diz o que é cada coluna — nada entra na
              base antes disso.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="arquivo-importacao">Arquivo</Label>
              <Input
                id="arquivo-importacao"
                type="file"
                accept=".xlsx,.csv,.txt"
                required
                disabled={enviando}
                onChange={(evento) => {
                  const selecionado = evento.target.files?.[0] ?? null
                  setArquivo(selecionado)
                  if (selecionado && !nome) setNome(selecionado.name.replace(/\.[^.]+$/, ''))
                }}
              />
              {arquivo && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
                  {arquivo.name} — {formatTamanho(arquivo.size)}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="nome-importacao">Nome da lista</Label>
              <Input
                id="nome-importacao"
                value={nome}
                maxLength={120}
                disabled={enviando}
                placeholder="Ex.: Clientes Sienge — SP — jul/2026"
                onChange={(evento) => setNome(evento.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                É este nome que vai para a coluna <span className="font-mono">origem</span> dos
                contatos criados. Escolha um que você reconheça daqui a seis meses.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={enviando}
              onClick={() => setAberto(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!arquivo || enviando}>
              {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {enviando ? 'Enviando…' : 'Enviar e mapear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
