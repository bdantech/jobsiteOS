import 'server-only'
import type { Campo, PerguntaIntencao } from '@jobsiteos/core'

/**
 * O HTML e o CSS do formulário público, em UM lugar.
 *
 * Os dois consumidores — a página standalone `/f/{slug}` e o script embutível
 * `/f/{slug}.js` — precisam renderizar EXATAMENTE o mesmo formulário. Duas
 * implementações divergiriam no primeiro campo novo, e o cliente que testou na página
 * veria outra coisa na landing page dele.
 *
 * É HTML em string, e não React, porque o embed injeta dentro de um shadow DOM na
 * página de terceiro — não há React lá, e não vamos mandar um bundle de framework
 * para dentro da landing page de ninguém.
 */

export interface FormularioPublico {
  id: string
  slug: string
  titulo: string | null
  subtitulo: string | null
  texto_botao: string
  mensagem_sucesso: string | null
  ajuda_cnpj: string | null
  campos: Campo[]
  pergunta_intencao: PerguntaIntencao | null
  consentimento_texto: string | null
  consentimento_obrigatorio: boolean
}

/** Escapa para contexto de texto/atributo HTML. A entrada vem do construtor, mas o
 *  construtor é uma tela — e tela é entrada de usuário. */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Tokens da plataforma (zinc + verde #1a7a4a), com as duas paletas declaradas.
 *
 * O tema não vem de `prefers-color-scheme`: vem da LUMINÂNCIA DO FUNDO do container.
 * Uma landing page escura no sistema claro de quem visita é o caso comum, e seguir a
 * preferência do sistema deixaria o formulário claro dentro de uma página preta.
 */
const CSS = `
:host, .jos-root { all: initial; }
.jos-root {
  --jos-bg: #ffffff; --jos-fg: #18181b; --jos-muted: #71717a;
  --jos-border: #e4e4e7; --jos-input: #ffffff; --jos-accent: #1a7a4a;
  --jos-accent-fg: #ffffff; --jos-erro: #b91c1c;
  display: block; box-sizing: border-box; width: 100%;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--jos-fg); font-size: 15px; line-height: 1.5;
}
.jos-root.jos-dark {
  --jos-bg: transparent; --jos-fg: #fafafa; --jos-muted: #a1a1aa;
  --jos-border: #3f3f46; --jos-input: #18181b; --jos-accent: #22a366;
  --jos-accent-fg: #08130d; --jos-erro: #f87171;
}
.jos-root *, .jos-root *::before, .jos-root *::after { box-sizing: border-box; }
.jos-titulo { margin: 0 0 4px; font-size: 20px; font-weight: 600; line-height: 1.3; }
.jos-sub { margin: 0 0 16px; color: var(--jos-muted); font-size: 14px; }
.jos-campo { margin-bottom: 12px; }
.jos-label { display: block; margin-bottom: 4px; font-size: 13px; font-weight: 500; }
.jos-req { color: var(--jos-erro); }
.jos-input, .jos-select, .jos-textarea {
  width: 100%; padding: 9px 11px; font: inherit; font-size: 15px;
  color: var(--jos-fg); background: var(--jos-input);
  border: 1px solid var(--jos-border); border-radius: 8px; outline: none;
}
.jos-input:focus, .jos-select:focus, .jos-textarea:focus {
  border-color: var(--jos-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--jos-accent) 25%, transparent);
}
.jos-textarea { min-height: 84px; resize: vertical; }
.jos-ajuda { margin: 4px 0 0; font-size: 12px; color: var(--jos-muted); }
.jos-erro-campo { margin: 4px 0 0; font-size: 12px; color: var(--jos-erro); }
/* Aviso NÃO impede o envio (e-mail de provedor pessoal, por exemplo). Âmbar, e não
   vermelho, porque vermelho ensina a pessoa que ela errou — e ela não errou. */
.jos-aviso-campo { margin: 4px 0 0; font-size: 12px; color: #a16207; }
.jos-dark .jos-aviso-campo { color: #fbbf24; }
.jos-input[aria-invalid="true"] { border-color: var(--jos-erro); }
.jos-fieldset { margin: 0 0 12px; padding: 0; border: 0; }
.jos-legend { padding: 0; margin-bottom: 6px; font-size: 13px; font-weight: 500; }
.jos-opcao {
  display: flex; gap: 8px; align-items: flex-start; padding: 9px 11px; margin-bottom: 6px;
  border: 1px solid var(--jos-border); border-radius: 8px; cursor: pointer; font-size: 14px;
}
.jos-opcao:hover { border-color: var(--jos-accent); }
.jos-opcao input { margin: 2px 0 0; accent-color: var(--jos-accent); }
.jos-consent { display: flex; gap: 8px; align-items: flex-start; margin: 4px 0 14px; font-size: 13px; color: var(--jos-muted); }
.jos-consent input { margin: 3px 0 0; accent-color: var(--jos-accent); }
.jos-botao {
  width: 100%; padding: 11px 16px; font: inherit; font-size: 15px; font-weight: 600;
  color: var(--jos-accent-fg); background: var(--jos-accent);
  border: 0; border-radius: 8px; cursor: pointer;
}
.jos-botao:hover { filter: brightness(1.06); }
.jos-botao[disabled] { opacity: .6; cursor: progress; }
.jos-alerta { padding: 10px 12px; margin-bottom: 12px; border-radius: 8px; font-size: 14px;
  color: var(--jos-erro); border: 1px solid color-mix(in srgb, var(--jos-erro) 40%, transparent); }
.jos-sucesso { padding: 20px 16px; text-align: center; font-size: 15px; }
.jos-sucesso strong { display: block; margin-bottom: 4px; font-size: 17px; }
/* O honeypot: fora da tela para o humano, presente no DOM para o bot. Não usa
   display:none — parte dos bots ignora campo escondido assim. */
.jos-hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
@media (max-width: 380px) { .jos-root { font-size: 14px; } }
`

export function cssDoFormulario(): string {
  return CSS
}

function inputDoCampo(c: Campo): string {
  const id = `jos-${esc(c.key)}`
  const req = c.obrigatorio ? ' required' : ''
  const ph = c.placeholder ? ` placeholder="${esc(c.placeholder)}"` : ''
  const comum = `id="${id}" name="${esc(c.key)}"${req}${ph}`

  if (c.tipo === 'textarea') return `<textarea class="jos-textarea" ${comum}></textarea>`
  if (c.tipo === 'select') {
    const opcoes = (c.opcoes ?? [])
      .map((o) => `<option value="${esc(o)}">${esc(o)}</option>`)
      .join('')
    return `<select class="jos-select" ${comum}><option value="">Selecione…</option>${opcoes}</select>`
  }
  const tipoHtml =
    c.tipo === 'email' ? 'email' : c.tipo === 'telefone' ? 'tel' : c.tipo === 'numero' ? 'number' : 'text'
  // `inputmode numeric` no CNPJ abre o teclado certo no celular, que é onde a maior
  // parte do tráfego de landing page chega.
  const extra = c.tipo === 'cnpj' ? ' inputmode="numeric" maxlength="18" autocomplete="off"' : ''
  return `<input class="jos-input" type="${tipoHtml}" ${comum}${extra} />`
}

/** O corpo do formulário. `raiz` é a classe que o script troca para o tema escuro. */
export function htmlDoFormulario(f: FormularioPublico): string {
  const campos = [...f.campos].sort((a, b) => a.ordem - b.ordem)

  const camposHtml = campos
    .map((c) => {
      const ajuda =
        c.key === 'cnpj' ? (c.ajuda ?? f.ajuda_cnpj ?? '') : (c.ajuda ?? '')
      return `<div class="jos-campo">
  <label class="jos-label" for="jos-${esc(c.key)}">${esc(c.label)}${c.obrigatorio ? ' <span class="jos-req">*</span>' : ''}</label>
  ${inputDoCampo(c)}
  ${ajuda ? `<p class="jos-ajuda" data-ajuda="${esc(c.key)}">${esc(ajuda)}</p>` : ''}
  <p class="jos-erro-campo" data-erro="${esc(c.key)}" hidden></p>
  <p class="jos-aviso-campo" data-aviso="${esc(c.key)}" hidden></p>
</div>`
    })
    .join('\n')

  const intencao = f.pergunta_intencao
    ? `<fieldset class="jos-fieldset">
  <legend class="jos-legend">${esc(f.pergunta_intencao.titulo)}</legend>
  ${f.pergunta_intencao.opcoes
    .map(
      (o) =>
        `<label class="jos-opcao"><input type="radio" name="intencao" value="${esc(o.valor)}" /><span>${esc(o.label)}</span></label>`,
    )
    .join('\n  ')}
</fieldset>`
    : ''

  /*
   * O consentimento nasce MARCADO.
   *
   * O opt-in aqui não é o de uma newsletter: a pessoa está preenchendo um formulário
   * para pedir contato, e o consentimento descreve exatamente o que ela veio fazer.
   * Deixá-lo desmarcado transforma um checkbox de transparência num obstáculo, e o
   * campo mais abandonado de um formulário é o que a pessoa não entende por que está
   * ali. Ela continua podendo desmarcar — e aí o envio é barrado, como deve ser.
   */
  const consentimento = f.consentimento_texto
    ? `<label class="jos-consent"><input type="checkbox" name="consentimento" checked${f.consentimento_obrigatorio ? ' required' : ''} /><span>${esc(f.consentimento_texto)}</span></label>`
    : ''

  // Título e subtítulo ficam DENTRO de [data-cabecalho]: no sucesso o formulário some
  // e eles têm de sumir junto, senão a tela fica dizendo "Responda em 30 segundos"
  // logo acima de "Recebemos seu contato".
  return `<div class="jos-root" data-slug="${esc(f.slug)}">
  <div data-cabecalho>
  ${f.titulo ? `<h2 class="jos-titulo">${esc(f.titulo)}</h2>` : ''}
  ${f.subtitulo ? `<p class="jos-sub">${esc(f.subtitulo)}</p>` : ''}
  </div>
  <form novalidate data-jos-form>
    <div class="jos-alerta" data-alerta hidden></div>
    ${camposHtml}
    ${intencao}
    ${consentimento}
    <label class="jos-hp" aria-hidden="true"><span>Não preencha</span><input type="text" name="empresa_site" tabindex="-1" autocomplete="off" /></label>
    <button class="jos-botao" type="submit">${esc(f.texto_botao)}</button>
  </form>
  <div class="jos-sucesso" data-sucesso hidden>
    <strong>Recebemos seu contato.</strong>
    <span>${esc(f.mensagem_sucesso ?? 'Em breve alguém do time fala com você.')}</span>
  </div>
</div>`
}
