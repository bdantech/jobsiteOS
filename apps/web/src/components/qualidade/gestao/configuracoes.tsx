'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Copy, KeyRound, Play } from 'lucide-react'
import type { z } from 'zod'
import {
  PROVEDOR_ANALISE_LABELS,
  PROVEDORES_ANALISE,
  SEGREDO_LABELS,
  SEGREDOS_QUALIDADE,
  calibracaoConfigSchema,
  capturaConfigSchema,
  classificacaoConfigSchema,
  janelaConfigSchema,
  precosQualidadeSchema,
  retencaoConfigSchema,
  vinculacaoConfigSchema,
  type ChaveConfigQualidade,
  type ConfigQualidade,
  type SegredoQualidade,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  processarFilaAction,
  salvarConfigQualidadeAction,
  salvarPessoaQualidadeAction,
  salvarSegredoQualidadeAction,
} from '@/actions/qualidade'
import { Aviso, ErroCarga, Vazio } from './comum'
import { dataHora, numeroBr, textoDeNumero } from './formato'
import {
  buscarConfigQualidade,
  buscarPessoasQualidade,
  buscarSegredosQualidade,
  qualidadeGestaoKeys,
} from './queries'

/**
 * CONFIGURAÇÕES (05C §13) — `webOnly`, só gestor.
 *
 * ─── CADA SEÇÃO SALVA SÓ A SUA CHAVE ────────────────────────────────────────
 * `app_qualidade_salvar_config` faz MERGE (`valor || novo`). Salvar a janela não reescreve
 * os preços com o que estava na tela há dez minutos. O rascunho é validado pelo MESMO
 * schema do core antes de sair — a RPC confia no formato, e um `delta` de 5 (em vez de
 * 0,05) seria uma banda cinzenta que manda tudo para o Claude.
 *
 * ─── SEGREDO NÃO VOLTA PARA A TELA ──────────────────────────────────────────
 * Chaves do Fireflies e do Jev vão para o Vault. A tela só sabe SE cada uma está
 * definida, quando e por quem — nunca o valor. O campo é de senha e começa vazio;
 * salvar vazio apaga. Por isso o botão de apagar é separado: um "Salvar" com o campo
 * vazio por engano não pode remover a credencial de produção.
 */
export function Configuracoes({ urlWebhookFireflies }: { urlWebhookFireflies: string | null }) {
  const cfg = useQuery({ queryKey: qualidadeGestaoKeys.config(), queryFn: buscarConfigQualidade })

  if (cfg.isPending) return <Skeleton className="h-96 w-full" />
  if (cfg.isError) return <ErroCarga erro={cfg.error} oque="as configurações" />
  const c = cfg.data

  return (
    <div className="space-y-4">
      <Fireflies urlWebhook={urlWebhookFireflies} />
      <Captura config={c} />
      <ProcessarFila />
      <Pessoas />

      <div className="grid gap-4 lg:grid-cols-2">
        <Secao
          chave="classificacao"
          titulo="Classificação"
          descricao="O Jev roda em tudo; o Claude decide a banda cinzenta e escreve a citação dos itens reprovados. O provedor Claude existe para quando o Jev não estiver disponível."
          schema={classificacaoConfigSchema}
          valor={c.classificacao}
          campos={[
            {
              chave: 'provedor',
              rotulo: 'Provedor principal',
              tipo: 'select',
              opcoes: PROVEDORES_ANALISE.map((p) => ({ valor: p, rotulo: PROVEDOR_ANALISE_LABELS[p] })),
            },
            { chave: 'delta', rotulo: 'Delta da banda cinzenta', tipo: 'dec', nota: 'Meia-largura em torno do limiar: dentro dela, decide o Claude. Banda larga anula a economia.' },
            { chave: 'limiar_aplicabilidade', rotulo: 'Limiar da condição de aplicabilidade', tipo: 'dec' },
            { chave: 'limiar_padrao', rotulo: 'Limiar padrão (item não calibrado)', tipo: 'dec', nota: 'Só serve à sombra — nunca chega ao vendedor.' },
            { chave: 'max_caracteres_estado', rotulo: 'Máximo de caracteres enviados', tipo: 'int', nota: 'Uma reunião de uma hora tem ~60 mil caracteres.' },
          ]}
        />
        <Secao
          chave="calibracao"
          titulo="Calibração"
          descricao="Nenhuma nota chega a um vendedor antes da calibração. Item abaixo do F1 mínimo fica em sombra como pergunta mal formulada."
          schema={calibracaoConfigSchema}
          valor={c.calibracao}
          campos={[
            { chave: 'f1_minimo', rotulo: 'F1 mínimo para publicar', tipo: 'dec' },
            { chave: 'min_amostras_calibracao', rotulo: 'Mínimo de interações rotuladas', tipo: 'int' },
            { chave: 'min_por_classe', rotulo: 'Mínimo por classe (atendeu / não atendeu)', tipo: 'int', nota: 'Sem nenhuma falta rotulada não há como saber se o classificador enxerga falta.' },
            { chave: 'n_contestacoes_para_recalibrar', rotulo: 'Contestações que pedem recalibração', tipo: 'int' },
          ]}
        />
        <Secao
          chave="janela"
          titulo="Janela de conversa (WhatsApp e e-mail)"
          descricao="Mensagem isolada não tem rubrica aplicável: o que se julga é a janela. Ela fecha só depois do silêncio, para não julgar a conversa no meio."
          schema={janelaConfigSchema}
          valor={c.janela}
          campos={[
            { chave: 'min_mensagens', rotulo: 'Mínimo de mensagens para fechar', tipo: 'int' },
            { chave: 'horas_silencio', rotulo: 'Horas de silêncio antes de fechar', tipo: 'int' },
          ]}
        />
        <Secao
          chave="retencao"
          titulo="Retenção"
          descricao="Expurgo das transcrições. A análise sobrevive ao texto: o expurgo apaga só a transcrição — nota, itens e citações ficam. Vazio = manter para sempre. A mídia nunca é copiada; fica no Fireflies."
          schema={retencaoConfigSchema}
          valor={c.retencao}
          campos={[{ chave: 'dias_transcricao', rotulo: 'Dias até expurgar a transcrição', tipo: 'int_nulo', nota: 'Entre 7 e 3650. Deixe vazio para manter.' }]}
        />
        <Secao
          chave="vinculacao"
          titulo="Vinculação de conversas"
          descricao="Determinístico → Jev → Claude na faixa incerta → fila humana."
          schema={vinculacaoConfigSchema}
          valor={c.vinculacao}
          campos={[
            { chave: 'ligada', rotulo: 'Vinculação automática ligada', tipo: 'bool' },
            { chave: 'aceite_automatico', rotulo: 'Aceite automático a partir de', tipo: 'dec', nota: 'Probabilidade do Jev para aceitar sem o Claude.' },
            { chave: 'banda_inferior', rotulo: 'Abaixo disto, direto para humano', tipo: 'dec', nota: 'Entre isto e o aceite automático, decide o Claude.' },
            { chave: 'max_candidatas', rotulo: 'Máximo de candidatas por conversa', tipo: 'int' },
          ]}
        />
        <Secao
          chave="precos"
          titulo="Preços"
          descricao="Para o custo do painel. Tokens em dólar por milhão; o câmbio converte para reais."
          schema={precosQualidadeSchema}
          valor={c.precos}
          campos={[
            { chave: 'cambio_usd_brl', rotulo: 'Câmbio (R$ por US$)', tipo: 'dec' },
            { chave: 'jev_entrada_usd_mtok', rotulo: 'Jev — entrada (US$/Mtok)', tipo: 'dec', nota: 'A saída do Jev não é cobrada.' },
            { chave: 'claude_entrada_usd_mtok', rotulo: 'Claude — entrada (US$/Mtok)', tipo: 'dec' },
            { chave: 'claude_saida_usd_mtok', rotulo: 'Claude — saída (US$/Mtok)', tipo: 'dec' },
          ]}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Subprocessadores</CardTitle>
          <CardDescription>
            Este módulo manda conversa de cliente para mais dois fornecedores, que precisam constar na lista de
            subprocessadores (§12):
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>
              <strong>Fireflies</strong> — grava e transcreve as reuniões. A mídia fica lá; guardamos só o link, a
              transcrição, o resumo e a análise.
            </li>
            <li>
              <strong>TypeSafe AI (Jev)</strong> — classifica o texto das interações item a item. Recebe texto, não
              devolve texto.
            </li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            O Claude (Anthropic) também recebe trechos, nos itens reprovados e na banda cinzenta.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Salvar por chave ───────────────────────────────────────────────────────

function useSalvarConfig() {
  const qc = useQueryClient()
  return async (chave: ChaveConfigQualidade, valor: Record<string, unknown>, sucesso = 'Configuração salva.') => {
    const r = await salvarConfigQualidadeAction({ chave, valor })
    if (!r.ok) {
      // A mensagem do banco chega intacta — inclusive a recusa de ligar a captura sem as credenciais.
      toast.error(r.message)
      return false
    }
    toast.success(sucesso)
    void qc.invalidateQueries({ queryKey: qualidadeGestaoKeys.config() })
    return true
  }
}

type TipoCampo = 'int' | 'int_nulo' | 'dec' | 'texto' | 'select' | 'bool'

interface DefCampo {
  chave: string
  rotulo: string
  tipo: TipoCampo
  nota?: string
  opcoes?: Array<{ valor: string; rotulo: string }>
}

const paraTexto = (v: unknown, tipo: TipoCampo): string | boolean => {
  if (tipo === 'bool') return Boolean(v)
  if (tipo === 'dec' || tipo === 'int' || tipo === 'int_nulo') return typeof v === 'number' ? textoDeNumero(v) : ''
  return v === null || v === undefined ? '' : String(v)
}

/**
 * Uma seção de configuração com rascunho local: os campos editam o rascunho, "Salvar"
 * valida contra o schema do core e manda SÓ a chave da seção. O rascunho reinicia quando
 * o banco devolve outro valor (salvo por outra pessoa, ou pela própria seção).
 */
function Secao({
  chave,
  titulo,
  descricao,
  schema,
  valor,
  campos,
  aviso,
}: {
  chave: ChaveConfigQualidade
  titulo: string
  descricao: string
  schema: z.ZodTypeAny
  valor: object
  campos: DefCampo[]
  aviso?: React.ReactNode
}) {
  const salvar = useSalvarConfig()
  const v = valor as Record<string, unknown>
  // Comparado como TEXTO: o objeto da config é novo a cada leitura, o conteúdo não.
  const inicial = JSON.stringify(Object.fromEntries(campos.map((c) => [c.chave, paraTexto(v[c.chave], c.tipo)])))
  const [r, setR] = React.useState<Record<string, string | boolean>>(() => JSON.parse(inicial))
  React.useEffect(() => setR(JSON.parse(inicial)), [inicial])
  const alterado = JSON.stringify(r) !== inicial
  const [salvando, setSalvando] = React.useState(false)

  async function gravar() {
    const saida: Record<string, unknown> = {}
    for (const c of campos) {
      const bruto = r[c.chave]
      if (c.tipo === 'bool') saida[c.chave] = Boolean(bruto)
      else if (c.tipo === 'texto' || c.tipo === 'select') saida[c.chave] = String(bruto ?? '').trim()
      else {
        const n = numeroBr(String(bruto ?? ''))
        if (n === null && c.tipo === 'int_nulo') saida[c.chave] = null
        else if (n === null) return void toast.error(`“${c.rotulo}” precisa de um número.`)
        else saida[c.chave] = n
      }
    }
    const val = schema.safeParse(saida)
    if (!val.success) {
      const iss = val.error.issues[0]
      const campo = campos.find((c) => c.chave === iss?.path[0])
      return void toast.error(`${campo ? `“${campo.rotulo}”: ` : ''}${traduzirIssue(iss)}`)
    }
    setSalvando(true)
    await salvar(chave, saida)
    setSalvando(false)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{titulo}</CardTitle>
        <CardDescription>{descricao}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {aviso}
        <div className="grid gap-3 sm:grid-cols-2">
          {campos.map((c) => {
            const id = `cfg-${chave}-${c.chave}`
            if (c.tipo === 'bool') {
              return (
                <div key={c.chave} className="flex items-center justify-between gap-3 sm:col-span-2">
                  <Label htmlFor={id} className="text-sm">
                    {c.rotulo}
                  </Label>
                  <Switch id={id} checked={Boolean(r[c.chave])} onCheckedChange={(b) => setR((a) => ({ ...a, [c.chave]: b }))} />
                </div>
              )
            }
            return (
              <div key={c.chave} className="space-y-1">
                <Label htmlFor={id} className="text-xs">
                  {c.rotulo}
                </Label>
                {c.tipo === 'select' ? (
                  <select
                    id={id}
                    value={String(r[c.chave] ?? '')}
                    onChange={(e) => setR((a) => ({ ...a, [c.chave]: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {(c.opcoes ?? []).map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.rotulo}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={id}
                    inputMode={c.tipo === 'dec' ? 'decimal' : c.tipo === 'texto' ? undefined : 'numeric'}
                    value={String(r[c.chave] ?? '')}
                    placeholder={c.tipo === 'int_nulo' ? 'manter' : undefined}
                    onChange={(e) => setR((a) => ({ ...a, [c.chave]: e.target.value }))}
                  />
                )}
                {c.nota ? <p className="text-[11px] leading-snug text-muted-foreground">{c.nota}</p> : null}
              </div>
            )
          })}
        </div>
        <div className="flex justify-end">
          <Button size="sm" disabled={!alterado || salvando} onClick={() => void gravar()}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/** As mensagens padrão do zod saem em inglês; as poucas que esta tela provoca, em pt-BR. */
function traduzirIssue(iss: z.ZodIssue | undefined): string {
  if (!iss) return 'valor inválido.'
  if (iss.code === 'too_small') return `o mínimo é ${String(iss.minimum).replace('.', ',')}.`
  if (iss.code === 'too_big') return `o máximo é ${String(iss.maximum).replace('.', ',')}.`
  if (iss.code === 'invalid_type' && iss.expected === 'integer') return 'precisa ser um número inteiro.'
  if (iss.code === 'invalid_type') return 'valor inválido.'
  if (iss.code === 'invalid_string') return 'formato inválido.'
  return iss.message
}

// ─── Fireflies: conta, segredos e webhook ───────────────────────────────────

function Fireflies({ urlWebhook }: { urlWebhook: string | null }) {
  const segredos = useQuery({ queryKey: qualidadeGestaoKeys.segredos(), queryFn: buscarSegredosQualidade })
  const porChave = new Map((segredos.data ?? []).map((s) => [s.chave, s]))

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" aria-hidden /> Credenciais e webhook
        </CardTitle>
        <CardDescription>
          Ficam no Vault. A tela mostra só se cada uma está definida — o valor nunca volta.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {segredos.isError ? (
          <ErroCarga erro={segredos.error} oque="o estado das credenciais" />
        ) : (
          <div className="space-y-3">
            {SEGREDOS_QUALIDADE.map((k) => (
              <LinhaSegredo key={k} chave={k} estado={porChave.get(k) ?? null} carregando={segredos.isPending} />
            ))}
          </div>
        )}

        <div className="space-y-1 rounded-md border p-3">
          <p className="text-sm font-medium">URL do webhook a cadastrar no Fireflies</p>
          {urlWebhook ? (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{urlWebhook}</code>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 text-xs"
                onClick={() => {
                  void navigator.clipboard.writeText(urlWebhook).then(
                    () => toast.success('URL copiada.'),
                    () => toast.error('Não foi possível copiar.'),
                  )
                }}
              >
                <Copy className="mr-1 h-3.5 w-3.5" aria-hidden /> Copiar
              </Button>
            </div>
          ) : (
            <p className="text-sm">
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">&lt;URL pública do worker&gt;/webhooks/fireflies</code>
              <span className="mt-1 block text-xs text-muted-foreground">
                A URL pública do worker (Railway) não está configurada neste ambiente; use o domínio público do serviço
                do worker seguido de <code>/webhooks/fireflies</code>.
              </span>
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            No Fireflies, em Developer settings → Webhooks, cadastre esta URL e o mesmo segredo salvo acima: cada
            entrega é assinada com HMAC-SHA256 e verificada aqui antes de qualquer coisa.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function LinhaSegredo({
  chave,
  estado,
  carregando,
}: {
  chave: SegredoQualidade
  estado: { definido_em: string; definido_por: string } | null
  carregando: boolean
}) {
  const qc = useQueryClient()
  const [valor, setValor] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)
  const id = `segredo-${chave}`

  async function gravar(novo: string) {
    setEnviando(true)
    const r = await salvarSegredoQualidadeAction({ chave, valor: novo })
    setEnviando(false)
    if (!r.ok) return void toast.error(r.message)
    setValor('')
    if (r.data.aviso) toast.warning(r.data.aviso)
    else if (r.data.conta) toast.success(`Chave conferida com o Fireflies: conta ${r.data.conta}.`)
    else toast.success(novo ? 'Credencial salva.' : 'Credencial removida.')
    void qc.invalidateQueries({ queryKey: qualidadeGestaoKeys.segredos() })
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id} className="text-sm">
          {SEGREDO_LABELS[chave]}
        </Label>
        {carregando ? null : estado ? (
          <Badge variant="success" className="text-[10px]">
            Definida em {dataHora(estado.definido_em)}
            {estado.definido_por ? ` por ${estado.definido_por}` : ''}
          </Badge>
        ) : (
          <Badge variant="neutral" className="text-[10px]">
            Não definida
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="new-password"
          value={valor}
          maxLength={500}
          placeholder={estado ? 'Digite para substituir' : 'Cole a credencial'}
          onChange={(e) => setValor(e.target.value)}
          className="h-9 min-w-0 flex-1"
        />
        <Button size="sm" disabled={!valor.trim() || enviando} onClick={() => void gravar(valor.trim())}>
          Salvar
        </Button>
        {estado ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={enviando}
            onClick={() => {
              if (window.confirm(`Remover “${SEGREDO_LABELS[chave]}”? O que depende dela para de funcionar.`)) void gravar('')
            }}
          >
            Remover
          </Button>
        ) : null}
      </div>
    </div>
  )
}

// ─── Captura ────────────────────────────────────────────────────────────────

/**
 * A captura tem o seu próprio cartão porque o "ligada" é o único switch desta tela que
 * mexe em reunião de CLIENTE: ligado, todo convite novo leva a conta central e o
 * notetaker. Ele salva na hora (não espera o "Salvar" da seção), e a RPC recusa ligar
 * sem as duas credenciais do Fireflies — a frase dela vira o toast.
 */
function Captura({ config }: { config: ConfigQualidade }) {
  const salvar = useSalvarConfig()
  const [ligando, setLigando] = React.useState(false)
  const ligada = config.captura.ligada

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Captura de reuniões (Fireflies)</CardTitle>
              <CardDescription>
                Ligada, toda reunião criada pela plataforma convida a conta central e o notetaker do Fireflies.
              </CardDescription>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={ligada}
                disabled={ligando}
                aria-label="Captura ligada"
                onCheckedChange={async (b) => {
                  setLigando(true)
                  await salvar('captura', { ligada: b }, b ? 'Captura ligada.' : 'Captura desligada.')
                  setLigando(false)
                }}
              />
              {ligada ? 'Ligada' : 'Desligada'}
            </label>
          </div>
        </CardHeader>
        <CardContent>
          <Aviso tom="warning">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Na conta central do Fireflies, o auto-join deve estar em <strong>&quot;somente quando eu convidar o
                fred&quot;</strong> — nunca &quot;todas as reuniões com link&quot;. Senão qualquer reunião interna que caia
                naquele calendário vira transcript gravado. Convidar a conta central põe a reunião no calendário dela
                (e a torna dona do transcript); convidar o notetaker é o que faz o bot entrar.
              </span>
            </p>
          </Aviso>
        </CardContent>
      </Card>

      <Secao
        chave="captura"
        titulo="Conta e tempo do bot"
        descricao="Se o bot não entrar até este tempo depois do início, quem conduz é avisado e pode chamá-lo à mão."
        schema={capturaConfigSchema.omit({ ligada: true })}
        valor={config.captura}
        campos={[
          { chave: 'email_conta_central', rotulo: 'E-mail da conta central', tipo: 'texto', nota: 'Dona dos transcripts e destino dos webhooks.' },
          { chave: 'email_notetaker', rotulo: 'E-mail do notetaker', tipo: 'texto', nota: 'Quem dispara o join do bot.' },
          { chave: 'minutos_para_bot', rotulo: 'Minutos até alertar sem bot', tipo: 'int' },
          { chave: 'idioma', rotulo: 'Idioma do resgate manual', tipo: 'texto', nota: 'Código curto, ex.: pt.' },
        ]}
      />
    </div>
  )
}

// ─── Fila de análise ────────────────────────────────────────────────────────

function ProcessarFila() {
  const [enviando, setEnviando] = React.useState(false)
  const qc = useQueryClient()
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-sm">
          <p className="font-medium">Fila de análise</p>
          <p className="text-muted-foreground">
            O worker processa a fila sozinho; use isto depois de trocar uma credencial ou para não esperar a próxima
            rodada.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={enviando}
          onClick={async () => {
            setEnviando(true)
            const r = await processarFilaAction()
            setEnviando(false)
            if (!r.ok) return void toast.error(r.message)
            toast.success('Processamento disparado.')
            void qc.invalidateQueries({ queryKey: [...qualidadeGestaoKeys.all, 'agregado'] })
          }}
        >
          <Play className="mr-1 h-3.5 w-3.5" aria-hidden /> {enviando ? 'Disparando…' : 'Processar fila agora'}
        </Button>
      </CardContent>
    </Card>
  )
}

// ─── Por pessoa ─────────────────────────────────────────────────────────────

/**
 * Os dois toggles são independentes (§12), mas não simétricos: desligar a CAPTURA tira
 * o gravador dos convites futuros da pessoa (a RPC marca as reuniões agendadas como
 * dispensadas na hora) e, sem transcript, as reuniões dela deixam de ser analisadas.
 * Desligar a ANÁLISE mantém gravação e transcript — só não julga.
 */
function Pessoas() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: qualidadeGestaoKeys.pessoas(), queryFn: buscarPessoasQualidade })
  const [salvando, setSalvando] = React.useState<string | null>(null)

  async function alternar(vendedorId: string, campo: 'captura_ativa' | 'analise_ativa', valor: boolean) {
    setSalvando(vendedorId)
    const r = await salvarPessoaQualidadeAction({ vendedor_id: vendedorId, [campo]: valor })
    setSalvando(null)
    if (!r.ok) return void toast.error(r.message)
    toast.success(
      campo === 'captura_ativa'
        ? valor
          ? 'Captura ligada para esta pessoa.'
          : 'Captura desligada: o gravador sai dos convites futuros desta pessoa.'
        : valor
          ? 'Análise ligada para esta pessoa.'
          : 'Análise desligada: gravação e transcript continuam.',
    )
    void qc.invalidateQueries({ queryKey: qualidadeGestaoKeys.pessoas() })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Por pessoa</CardTitle>
        <CardDescription>
          Desligar a <strong>captura</strong> tira o gravador dos convites futuros da pessoa e, por consequência,
          para a análise das reuniões dela. Desligar a <strong>análise</strong> mantém a gravação e o transcript — só
          não avalia.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {q.isPending ? (
          <Skeleton className="m-4 h-32" />
        ) : q.isError ? (
          <div className="p-4">
            <ErroCarga erro={q.error} oque="as pessoas" />
          </div>
        ) : q.data.length === 0 ? (
          <Vazio>Nenhum vendedor ativo.</Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-normal">Pessoa</th>
                  <th scope="col" className="w-28 px-3 py-2 text-center font-normal">Captura</th>
                  <th scope="col" className="w-28 px-3 py-2 text-center font-normal">Análise</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {q.data.map((p) => (
                  <tr key={p.vendedor_id}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{p.nome}</span>
                      {p.is_ia ? (
                        <Badge variant="info" className="ml-2 text-[10px]">
                          IA
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Switch
                        checked={p.captura_ativa}
                        disabled={salvando === p.vendedor_id}
                        aria-label={`Captura de ${p.nome}`}
                        onCheckedChange={(b) => void alternar(p.vendedor_id, 'captura_ativa', b)}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Switch
                        checked={p.analise_ativa}
                        disabled={salvando === p.vendedor_id}
                        aria-label={`Análise de ${p.nome}`}
                        onCheckedChange={(b) => void alternar(p.vendedor_id, 'analise_ativa', b)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
