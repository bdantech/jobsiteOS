'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { TIPOS_VENDEDOR, TIPO_VENDEDOR_LABELS, type TipoVendedorId } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { salvarTerritorioAction, salvarVendedorAction } from '@/actions/comercial'
import type { Tables } from '@jobsiteos/core'

/**
 * Cadastro de vendedor.
 *
 * O formulário muda com o tipo, e a diferença não é cosmética — é a distinção entre as
 * duas formas de receber trabalho:
 *
 *   ORIGINADOR trabalha NOTA, e recebe por ESCOLHA: uma lista de empresas escolhidas a
 *   dedo. As NFs dessas empresas são dele. Quem originou a relação continua dono dela
 *   mesmo que a empresa mude de porte ou de estado.
 *
 *   CLOSER trabalha CONTA, e recebe por RECORTE: UF e faixa de faturamento. Quem fecha
 *   negócio é alocado por perfil de cliente, não por relação prévia.
 *
 *   SDR também tem recorte, mas para a distribuição semanal — não para nota.
 *
 * NÃO EXISTE EXCLUIR. Vendedor se desativa. Apagar levaria junto a explicação de
 * comissões já pagas — o histórico de carteira aponta para ele.
 */

const SETTINGS_POR_TIPO: Record<TipoVendedorId, string> = {
  sdr: 'Recebe empresas na distribuição semanal, dentro do território e da cota.',
  originador: 'Recebe as NFs das empresas que você escolher abaixo. Nada de território.',
  vendedor: 'Recebe contas por território — UF e faixa de faturamento.',
}

/** Território é do closer (recorte de conta) e do SDR (recorte de distribuição). */
const TEM_TERRITORIO: Record<TipoVendedorId, boolean> = {
  sdr: true,
  vendedor: true,
  originador: false,
}

export interface EmpresaEscolhida {
  id: string
  razao_social: string | null
  cnpj: string
  uf: string | null
  estagio: string
  gestao_operacao: string | null
}

/** Só cliente em prospecção ativa entra na carteira — ver a nota do componente. */
function elegivel(e: { estagio: string; gestao_operacao: string | null }): boolean {
  return e.estagio === 'cliente' && e.gestao_operacao === 'prospeccao_ativa'
}

/**
 * A carteira explícita do originador: as empresas cujas NFs vão para ele.
 *
 * A busca só devolve **cliente em prospecção ativa**, e o recorte não é conveniência —
 * é o conjunto das empresas cuja nota pode, de fato, ser roteada:
 *
 *   quem não é cliente não emite nota no nosso funil, então uma carteira cheia delas é
 *   uma carteira que nunca entrega trabalho;
 *
 *   quem é passivo tem a nota descartada antes de o roteador olhar carteira nenhuma —
 *   adicionar uma passiva criaria uma linha que promete trabalho e nunca entrega, e o
 *   originador só descobriria ao notar que a nota nunca chega.
 *
 * Empresa já escolhida que DEIXOU de ser elegível continua na lista, marcada: tirá-la
 * sozinho seria decidir por quem cadastrou, e a marca é o que faz alguém revisar.
 */
function CarteiraOriginador({
  escolhidas,
  onChange,
}: {
  escolhidas: EmpresaEscolhida[]
  onChange: (e: EmpresaEscolhida[]) => void
}) {
  const [termo, setTermo] = React.useState('')
  const [buscando, setBuscando] = React.useState(false)
  const [buscou, setBuscou] = React.useState(false)
  const [achadas, setAchadas] = React.useState<EmpresaEscolhida[]>([])

  async function buscar() {
    const t = termo.trim()
    if (t.length < 3) return
    setBuscando(true)
    const digitos = t.replace(/\D/g, '')
    const supabase = createClient()
    const q = supabase
      .from('empresas')
      .select('id, razao_social, cnpj, uf, estagio, gestao_operacao')
      // O recorte é do BANCO, não da tela: filtrar depois de buscar devolveria vinte
      // linhas e mostraria três, e a pessoa concluiria que a busca está quebrada.
      .eq('estagio', 'cliente')
      .eq('gestao_operacao', 'prospeccao_ativa')
      .limit(20)
    const { data } = digitos.length >= 6
      ? await q.like('cnpj', `${digitos}%`)
      : await q.ilike('razao_social', `%${t}%`)
    setAchadas((data ?? []) as EmpresaEscolhida[])
    setBuscou(true)
    setBuscando(false)
  }

  function adicionar(e: EmpresaEscolhida) {
    if (!elegivel(e)) return
    if (escolhidas.some((x) => x.id === e.id)) return
    onChange([...escolhidas, e])
    setAchadas([])
    setBuscou(false)
    setTermo('')
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-medium">Carteira de originação</p>
      <p className="text-xs text-muted-foreground">
        As NFs destas empresas — como sacado OU como fornecedor — são roteadas para este
        originador. A busca só mostra <strong>cliente em prospecção ativa</strong>: quem não
        é cliente não emite nota no funil, e a nota de passivo é descartada antes do
        roteamento.
      </p>

      <div className="flex min-w-0 gap-2">
        <Input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Nome ou CNPJ (mín. 3)"
          className="min-w-0 flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Enter aqui NÃO pode submeter o formulário inteiro.
              e.preventDefault()
              void buscar()
            }
          }}
        />
        <Button type="button" variant="outline" className="shrink-0" onClick={() => void buscar()} disabled={buscando}>
          {buscando ? 'Buscando…' : 'Buscar'}
        </Button>
      </div>

      {buscou && achadas.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nenhum cliente em prospecção ativa com esse nome ou CNPJ. A gestão da conta se
          define na ficha da empresa, aba Dados.
        </p>
      )}

      {achadas.length > 0 && (
        <ul className="max-h-40 divide-y overflow-y-auto overflow-x-hidden rounded-md border">
          {achadas.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 p-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{e.razao_social ?? e.cnpj}</span>
                <span className="block truncate text-xs text-muted-foreground">{e.uf ?? '—'}</span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 text-xs"
                onClick={() => adicionar(e)}
              >
                Adicionar
              </Button>
            </li>
          ))}
        </ul>
      )}

      {escolhidas.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma empresa ainda — sem carteira, nenhuma nota é roteada para ele.
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-md border">
          {escolhidas.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 p-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{e.razao_social ?? e.cnpj}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {e.uf ?? '—'}
                  {/* Deixou de ser elegível depois de escolhida: a nota dela não chega
                      mais, e sem a marca ninguém descobriria isso. */}
                  {!elegivel(e)
                    ? e.gestao_operacao === 'passivo'
                      ? ' · virou PASSIVA — a nota não é roteada'
                      : ' · não é mais cliente ativo'
                    : ''}
                </span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 text-xs"
                onClick={() => onChange(escolhidas.filter((x) => x.id !== e.id))}
              >
                Remover
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

async function buscarUsuarios() {
  const supabase = createClient()
  const { data } = await supabase.from('usuarios').select('id, nome, email').eq('ativo', true).order('nome')
  return data ?? []
}

export interface VendedorFormProps {
  aberto: boolean
  onOpenChange: (v: boolean) => void
  /** null = novo. */
  vendedor: Tables<'vendedores'> | null
  territorio: Tables<'vendedor_territorios'> | null
}

export function VendedorForm({ aberto, onOpenChange, vendedor, territorio }: VendedorFormProps) {
  const qc = useQueryClient()
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const [tipo, setTipo] = React.useState<TipoVendedorId>((vendedor?.tipo as TipoVendedorId) ?? 'sdr')
  const [ehIa, setEhIa] = React.useState(vendedor?.is_ia ?? false)
  const [escolhidas, setEscolhidas] = React.useState<EmpresaEscolhida[]>([])

  const usuarios = useQuery({ queryKey: ['comercial', 'usuarios'], queryFn: buscarUsuarios, enabled: aberto })

  React.useEffect(() => {
    if (!aberto) return
    setTipo((vendedor?.tipo as TipoVendedorId) ?? 'sdr')
    setEhIa(vendedor?.is_ia ?? false)
    setErro(null)
    // A carteira guarda só ids; a tela precisa dos nomes para ser legível.
    const ids = ((vendedor?.settings ?? {}) as { empresas_escolhidas?: string[] }).empresas_escolhidas ?? []
    if (ids.length === 0) {
      setEscolhidas([])
      return
    }
    void createClient()
      .from('empresas')
      .select('id, razao_social, cnpj, uf, estagio, gestao_operacao')
      .in('id', ids)
      .then(({ data }) => setEscolhidas((data ?? []) as EmpresaEscolhida[]))
  }, [aberto, vendedor])

  const settings = (vendedor?.settings ?? {}) as { direcao?: string; empresas_por_semana?: number }

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setSalvando(true)
    setErro(null)

    const novasSettings: Record<string, unknown> = { ...(vendedor?.settings as object) }
    if (tipo === 'originador') {
      novasSettings.empresas_escolhidas = escolhidas.map((e) => e.id)
    } else {
      // Trocar de tipo apaga a carteira: um SDR com `empresas_escolhidas` pendurado é
      // um campo invisível que volta a valer se ele virar originador de novo.
      delete novasSettings.empresas_escolhidas
    }
    if (tipo === 'sdr') {
      novasSettings.direcao = String(fd.get('direcao') ?? 'both')
      const cota = Number(fd.get('cota'))
      if (Number.isFinite(cota) && cota > 0) novasSettings.empresas_por_semana = cota
      else delete novasSettings.empresas_por_semana
    }

    const r = await salvarVendedorAction({
      id: vendedor?.id,
      nome: String(fd.get('nome') ?? ''),
      tipo,
      usuario_id: ehIa ? null : String(fd.get('usuario_id') ?? '') || null,
      is_ia: ehIa,
      email_remetente: String(fd.get('email_remetente') ?? '') || null,
      settings: novasSettings,
      ativo: fd.get('ativo') === 'on',
    })

    if (!r.ok) {
      setSalvando(false)
      setErro(r.message)
      return
    }

    // Território na mesma submissão. Só para quem recebe por recorte — o originador
    // recebe por escolha, e um território nele seria um campo que não faz nada.
    const id = r.data.id ?? vendedor?.id
    if (id && TEM_TERRITORIO[tipo]) {
      const ufs = String(fd.get('ufs') ?? '')
        .split(',')
        .map((u) => u.trim().toUpperCase())
        .filter(Boolean)
      const min = fd.get('fat_min') ? Number(fd.get('fat_min')) : null
      const max = fd.get('fat_max') ? Number(fd.get('fat_max')) : null
      const t = await salvarTerritorioAction({
        vendedor_id: id,
        ufs,
        faturamento_min: min,
        faturamento_max: max,
      })
      if (!t.ok) {
        setSalvando(false)
        setErro(t.message)
        return
      }
    }

    setSalvando(false)
    toast.success(vendedor ? 'Vendedor atualizado.' : 'Vendedor cadastrado.')
    void qc.invalidateQueries({ queryKey: ['comercial'] })
    onOpenChange(false)
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      {/* `overflow-x-hidden`: sem ele, um nome de empresa longo dentro do seletor empurra
          a largura e o modal inteiro ganha barra horizontal. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto overflow-x-hidden sm:max-w-lg">
        <form onSubmit={enviar}>
          <DialogHeader>
            <DialogTitle>{vendedor ? 'Editar vendedor' : 'Novo vendedor'}</DialogTitle>
            <DialogDescription>
              Não existe excluir: vendedor se desativa. Apagar levaria junto a explicação de
              comissões já pagas.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="nome">Nome</Label>
              <Input id="nome" name="nome" defaultValue={vendedor?.nome ?? ''} required minLength={2} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tipo">Tipo</Label>
              <select
                id="tipo"
                name="tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoVendedorId)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {TIPOS_VENDEDOR.map((t) => (
                  <option key={t} value={t}>{TIPO_VENDEDOR_LABELS[t]}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{SETTINGS_POR_TIPO[tipo]}</p>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ehIa} onChange={(e) => setEhIa(e.target.checked)} />
              Vendedor de IA (tem nome próprio e não tem login)
            </label>

            {!ehIa && (
              <div className="space-y-1.5">
                <Label htmlFor="usuario_id">Usuário</Label>
                <select
                  id="usuario_id"
                  name="usuario_id"
                  defaultValue={vendedor?.usuario_id ?? ''}
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione…</option>
                  {(usuarios.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>{u.nome} · {u.email}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  É por aqui que &quot;Meu Painel&quot; sabe de quem é o funil.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email_remetente">E-mail remetente (opcional)</Label>
              <Input
                id="email_remetente"
                name="email_remetente"
                type="email"
                defaultValue={vendedor?.email_remetente ?? ''}
              />
            </div>

            {tipo === 'sdr' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="direcao">Direção</Label>
                  <select
                    id="direcao"
                    name="direcao"
                    defaultValue={settings.direcao ?? 'both'}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="out">Saída (recebe da distribuição)</option>
                    <option value="in">Entrada (recebe inbound, criado à mão)</option>
                    <option value="both">Os dois</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cota">Empresas por semana</Label>
                  <Input
                    id="cota"
                    name="cota"
                    type="number"
                    min={1}
                    placeholder="herda a config global"
                    defaultValue={settings.empresas_por_semana ?? ''}
                  />
                </div>
              </div>
            )}

            {TEM_TERRITORIO[tipo] && (
              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Território</p>
                <p className="text-xs text-muted-foreground">
                  {tipo === 'vendedor'
                    ? 'Define quais contas são deste closer. É o que o SDR vê sugerido ao agendar a reunião.'
                    : 'Recorta o que este SDR recebe na distribuição semanal.'}{' '}
                  Em branco NÃO significa &quot;atende tudo&quot;: território vazio é ignorado,
                  senão um cadastro incompleto abocanha a base inteira.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="ufs">UFs (separadas por vírgula)</Label>
                  <Input
                    id="ufs"
                    name="ufs"
                    placeholder="SP, MG, PR"
                    defaultValue={(territorio?.ufs ?? []).join(', ')}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="fat_min">Faturamento mínimo</Label>
                    <Input id="fat_min" name="fat_min" type="number" min={0} step="1000"
                      defaultValue={territorio?.faturamento_min ?? ''} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fat_max">Faturamento máximo</Label>
                    <Input id="fat_max" name="fat_max" type="number" min={0} step="1000"
                      defaultValue={territorio?.faturamento_max ?? ''} />
                  </div>
                </div>
              </div>
            )}

            {tipo === 'originador' && (
              <CarteiraOriginador
                escolhidas={escolhidas}
                onChange={setEscolhidas}
              />
            )}

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="ativo" defaultChecked={vendedor?.ativo ?? true} />
              Ativo
            </label>
          </div>

          {erro ? <p className="pb-2 text-sm text-destructive">{erro}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
