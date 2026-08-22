'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Check, Copy, Plus, Trash2, X } from 'lucide-react'
import {
  AJUDA_CNPJ_DEFAULT,
  CATALOGO_CONTATO,
  CATALOGO_EMPRESA,
  PERGUNTA_INTENCAO_DEFAULT,
  normalizarCampos,
  type Campo,
  type CampoCatalogo,
} from '@jobsiteos/core'
import { salvarFormularioAction } from '@/actions/leads'
import { buscarVendedores, comercialKeys } from '@/components/comercial/queries'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { leadsKeys, type FormularioCompleto } from './queries'

/**
 * O construtor (04i §2).
 *
 * O CNPJ não aparece na lista de campos removíveis, e não é esquecimento: ele é o que
 * faz o pipeline inteiro existir. Sem CNPJ não há dedup de empresa, nem cadastral, nem
 * score — o lead vira um e-mail solto numa caixa. `normalizarCampos` garante isso de
 * novo no servidor, porque a tela não é a única porta.
 */

const CATALOGOS: { titulo: string; itens: readonly CampoCatalogo[] }[] = [
  { titulo: 'Empresa', itens: CATALOGO_EMPRESA.filter((c) => c.key !== 'cnpj') },
  { titulo: 'Contato', itens: CATALOGO_CONTATO },
]

function campoNovo(c: CampoCatalogo, ordem: number): Campo {
  return {
    key: c.key,
    label: c.label,
    tipo: c.tipo,
    obrigatorio: false,
    ordem,
    placeholder: c.placeholder ?? null,
    ajuda: null,
    opcoes: c.opcoes ? [...c.opcoes] : null,
  }
}

const VAZIO: FormularioCompleto = {
  id: '',
  slug: '',
  nome: '',
  descricao: null,
  titulo: 'Vamos conversar',
  subtitulo: 'Preencha seus dados e nossa equipe entrará em contato rapidamente',
  texto_botao: 'Enviar',
  mensagem_sucesso: null,
  ajuda_cnpj: AJUDA_CNPJ_DEFAULT,
  campos: normalizarCampos([campoNovo(CATALOGO_CONTATO[0]!, 1), campoNovo(CATALOGO_CONTATO[2]!, 2)]),
  pergunta_intencao: PERGUNTA_INTENCAO_DEFAULT,
  consentimento_texto: 'Autorizo o contato e o tratamento dos meus dados conforme a LGPD.',
  consentimento_obrigatorio: true,
  vendedor_destino_id: null,
  auto_resposta_habilitada: true,
  auto_resposta_assunto: null,
  auto_resposta_corpo: null,
  enriquecimento_pago: false,
  ativo: true,
}

export function Construtor({
  inicial,
  onFechar,
}: {
  inicial: FormularioCompleto | null
  onFechar: () => void
}) {
  const qc = useQueryClient()
  const [f, setF] = React.useState<FormularioCompleto>(inicial ?? VAZIO)
  const [salvando, setSalvando] = React.useState(false)
  const [copiado, setCopiado] = React.useState(false)

  const vendedores = useQuery({ queryKey: comercialKeys.vendedores(), queryFn: buscarVendedores })

  const set = <K extends keyof FormularioCompleto>(k: K, v: FormularioCompleto[K]) =>
    setF((prev) => ({ ...prev, [k]: v }))

  const campos = normalizarCampos(f.campos)
  const usadas = new Set(campos.map((c) => c.key))

  function adicionar(c: CampoCatalogo) {
    setF((prev) => ({ ...prev, campos: [...prev.campos, campoNovo(c, prev.campos.length + 1)] }))
  }
  function remover(key: string) {
    setF((prev) => ({ ...prev, campos: prev.campos.filter((c) => c.key !== key) }))
  }
  function mover(key: string, delta: number) {
    setF((prev) => {
      const lista = normalizarCampos(prev.campos)
      const i = lista.findIndex((c) => c.key === key)
      const j = i + delta
      // Índice 0 é o CNPJ e ele não sai do lugar — por isso o piso é 1.
      if (i < 1 || j < 1 || j >= lista.length) return prev
      const copia = [...lista]
      ;[copia[i], copia[j]] = [copia[j]!, copia[i]!]
      return { ...prev, campos: copia.map((c, k) => ({ ...c, ordem: k })) }
    })
  }
  function alterarCampo(key: string, patch: Partial<Campo>) {
    setF((prev) => ({
      ...prev,
      campos: prev.campos.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    }))
  }

  async function salvar() {
    setSalvando(true)
    const r = await salvarFormularioAction({ ...f, id: f.id || null, campos })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Formulário salvo.')
    void qc.invalidateQueries({ queryKey: leadsKeys.all })
    onFechar()
  }

  const base = typeof window === 'undefined' ? '' : window.location.origin
  const snippet = `<script src="${base}/f/${f.slug || 'seu-slug'}.js" async></script>`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{f.id ? 'Editar formulário' : 'Novo formulário'}</h2>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onFechar}>
            <X className="mr-1 h-3.5 w-3.5" aria-hidden />
            Cancelar
          </Button>
          <Button size="sm" disabled={salvando || !f.nome || !f.slug} onClick={() => void salvar()}>
            <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
            Salvar
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Identificação</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="nome">Nome interno</Label>
                <Input
                  id="nome"
                  value={f.nome}
                  onChange={(e) => set('nome', e.target.value)}
                  placeholder="LP Antecipação SP"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="slug">Endereço (slug)</Label>
                <Input
                  id="slug"
                  value={f.slug}
                  onChange={(e) =>
                    set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
                  }
                  placeholder="lp-antecipacao-sp"
                />
                <p className="text-xs text-muted-foreground">
                  Vira a URL pública e o nome do script. Trocar depois quebra o que já está colado
                  na landing page.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Textos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="titulo">Título</Label>
                  <Input id="titulo" value={f.titulo ?? ''} onChange={(e) => set('titulo', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="botao">Texto do botão</Label>
                  <Input
                    id="botao"
                    value={f.texto_botao}
                    onChange={(e) => set('texto_botao', e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="subtitulo">Subtítulo</Label>
                <Input
                  id="subtitulo"
                  value={f.subtitulo ?? ''}
                  onChange={(e) => set('subtitulo', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sucesso">Mensagem de sucesso</Label>
                <Input
                  id="sucesso"
                  value={f.mensagem_sucesso ?? ''}
                  onChange={(e) => set('mensagem_sucesso', e.target.value)}
                  placeholder="Em breve alguém do time fala com você."
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ajudacnpj">Microtexto sob o CNPJ</Label>
                <Input
                  id="ajudacnpj"
                  value={f.ajuda_cnpj ?? ''}
                  onChange={(e) => set('ajuda_cnpj', e.target.value)}
                  placeholder={AJUDA_CNPJ_DEFAULT}
                />
                <p className="text-xs text-muted-foreground">
                  Pedir CNPJ numa landing page assusta. Dizer para que serve é mais barato que
                  perder o lead.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Campos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="space-y-2">
                {campos.map((c, i) => {
                  const fixo = c.key === 'cnpj'
                  return (
                    <li
                      key={c.key}
                      className={cn('flex flex-wrap items-center gap-2 rounded-md border p-2', fixo && 'bg-muted/40')}
                    >
                      <div className="flex flex-col">
                        <button
                          type="button"
                          disabled={fixo || i <= 1}
                          onClick={() => mover(c.key, -1)}
                          className="text-muted-foreground disabled:opacity-30"
                          aria-label={`Subir ${c.label}`}
                        >
                          <ArrowUp className="h-3 w-3" aria-hidden />
                        </button>
                        <button
                          type="button"
                          disabled={fixo || i >= campos.length - 1}
                          onClick={() => mover(c.key, 1)}
                          className="text-muted-foreground disabled:opacity-30"
                          aria-label={`Descer ${c.label}`}
                        >
                          <ArrowDown className="h-3 w-3" aria-hidden />
                        </button>
                      </div>
                      <Input
                        value={c.label}
                        onChange={(e) => alterarCampo(c.key, { label: e.target.value })}
                        className="h-8 max-w-56 text-sm"
                        aria-label={`Rótulo de ${c.key}`}
                      />
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{c.key}</code>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Switch
                          checked={c.obrigatorio}
                          disabled={fixo}
                          onCheckedChange={(v) => alterarCampo(c.key, { obrigatorio: v })}
                        />
                        obrigatório
                      </label>
                      {fixo ? (
                        <span className="ml-auto text-xs text-muted-foreground">sempre presente</span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-7 text-muted-foreground"
                          onClick={() => remover(c.key)}
                          aria-label={`Remover ${c.label}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>

              <div className="space-y-2 border-t pt-3">
                {CATALOGOS.map((cat) => (
                  <div key={cat.titulo} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-16 text-xs text-muted-foreground">{cat.titulo}</span>
                    {cat.itens.map((c) => (
                      <Button
                        key={c.key}
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={usadas.has(c.key)}
                        onClick={() => adicionar(c)}
                      >
                        <Plus className="mr-1 h-3 w-3" aria-hidden />
                        {c.label}
                      </Button>
                    ))}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Comportamento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-start gap-2 text-sm">
                <Switch
                  checked={f.pergunta_intencao !== null}
                  onCheckedChange={(v) => set('pergunta_intencao', v ? PERGUNTA_INTENCAO_DEFAULT : null)}
                />
                <span>
                  Perguntar o que a pessoa procura
                  <span className="block text-xs text-muted-foreground">
                    Cedente, sacado ou ERP. Muda o pitch do SDR — e o cruzamento com o CNAE
                    levanta a bandeira quando a resposta não bate com o CNPJ.
                  </span>
                </span>
              </label>

              <div className="space-y-1">
                <Label htmlFor="consent">Texto do consentimento (LGPD)</Label>
                <Textarea
                  id="consent"
                  rows={2}
                  value={f.consentimento_texto ?? ''}
                  onChange={(e) => set('consentimento_texto', e.target.value || null)}
                  placeholder="Deixe vazio para não exibir o checkbox."
                />
                {f.consentimento_texto ? (
                  <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                    <Switch
                      checked={f.consentimento_obrigatorio}
                      onCheckedChange={(v) => set('consentimento_obrigatorio', v)}
                    />
                    obrigatório para enviar
                  </label>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label>Vendedor de destino</Label>
                <Select
                  value={f.vendedor_destino_id ?? 'nenhum'}
                  onValueChange={(v) => set('vendedor_destino_id', v === 'nenhum' ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Nenhum" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">Nenhum</SelectItem>
                    {(vendedores.data ?? []).map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Destino pré-selecionado da futura reunião. Quem trabalha o lead continua sendo o
                  SDR roteado por território e carga.
                </p>
              </div>

              <label className="flex items-start gap-2 text-sm">
                <Switch
                  checked={f.enriquecimento_pago}
                  onCheckedChange={(v) => set('enriquecimento_pago', v)}
                />
                <span>
                  Enriquecimento pago (Apollo)
                  <span className="block text-xs text-muted-foreground">
                    Cadastral, domínio, faturamento estimado e scorecard rodam sempre — são de
                    graça. Este toggle liga só a busca de decisores, que <strong>custa dinheiro</strong>{' '}
                    e respeita o teto mensal em Configurações. Protesto fica sob demanda do SDR.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 text-sm">
                <Switch checked={f.ativo} onCheckedChange={(v) => set('ativo', v)} />
                <span>
                  Ativo
                  <span className="block text-xs text-muted-foreground">
                    Desativado, o script na landing page para de renderizar e a página pública
                    devolve 404.
                  </span>
                </span>
              </label>
            </CardContent>
          </Card>
        </div>

        {/* ─── Preview ao vivo ─────────────────────────────────────────────── */}
        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <Preview f={{ ...f, campos }} />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Como colar no Framer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <ol className="list-inside list-decimal space-y-1">
                <li>Na página do Framer, insira um componente <strong>Embed</strong> (HTML).</li>
                <li>Cole o snippet abaixo dentro dele.</li>
                <li>Funciona no preview e no publicado — não precisa de mais nada.</li>
              </ol>
              <pre className="overflow-x-auto rounded-md bg-muted p-2 text-[11px] text-foreground">
                {snippet}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  void navigator.clipboard.writeText(snippet)
                  setCopiado(true)
                  setTimeout(() => setCopiado(false), 2000)
                }}
              >
                {copiado ? (
                  <>
                    <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Copiar snippet
                  </>
                )}
              </Button>
              <p>
                Para posicionar num ponto exato, coloque também{' '}
                <code className="rounded bg-muted px-1">
                  {`<div id="jobsiteos-form-${f.slug || 'seu-slug'}"></div>`}
                </code>{' '}
                onde o formulário deve aparecer.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

/**
 * O preview usa os componentes da própria plataforma, não o HTML do embed.
 *
 * É uma aproximação deliberada: reproduzir o shadow DOM aqui exigiria um iframe, e o
 * que a pessoa precisa conferir neste momento é a ORDEM e os RÓTULOS dos campos — não
 * a fidelidade de pixel, que ela confere abrindo a página pública.
 */
function Preview({ f }: { f: FormularioCompleto }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Prévia</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {f.titulo ? <p className="text-lg font-semibold">{f.titulo}</p> : null}
        {f.subtitulo ? <p className="text-sm text-muted-foreground">{f.subtitulo}</p> : null}
        {f.campos.map((c) => (
          <div key={c.key} className="space-y-1">
            <Label className="text-xs">
              {c.label}
              {c.obrigatorio ? <span className="text-destructive"> *</span> : null}
            </Label>
            <Input disabled placeholder={c.placeholder ?? ''} className="h-9" />
            {c.key === 'cnpj' && (f.ajuda_cnpj || c.ajuda) ? (
              <p className="text-[11px] text-muted-foreground">{c.ajuda ?? f.ajuda_cnpj}</p>
            ) : null}
          </div>
        ))}
        {f.pergunta_intencao ? (
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium">{f.pergunta_intencao.titulo}</legend>
            {f.pergunta_intencao.opcoes.map((o) => (
              <div key={o.valor} className="rounded-md border p-2 text-xs text-muted-foreground">
                {o.label}
              </div>
            ))}
          </fieldset>
        ) : null}
        {f.consentimento_texto ? (
          <p className="text-[11px] text-muted-foreground">☐ {f.consentimento_texto}</p>
        ) : null}
        <Button disabled className="w-full">
          {f.texto_botao}
        </Button>
      </CardContent>
    </Card>
  )
}
