import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cssDoFormulario, htmlDoFormulario, type FormularioPublico } from '@/lib/leads/render'
import { scriptDoFormulario } from '@/lib/leads/comportamento'

export const dynamic = 'force-dynamic'

/**
 * O snippet de uma linha: `<script src="{APP_URL}/f/{slug}.js" async></script>`.
 *
 * Chega aqui por rewrite em next.config (o caminho `/f/{slug}.js` colidiria com a
 * página standalone `/f/{slug}`, que ocupa o mesmo segmento dinâmico).
 *
 * ─── SHADOW DOM, e não classes prefixadas ───────────────────────────────────
 * A landing page do cliente tem CSS que não controlamos, e um `* { box-sizing }`
 * ou um reset agressivo de `input` deforma o formulário de um jeito que só aparece
 * na página dele. Prefixo de classe protege contra colisão de NOME, não contra
 * herança e seletor de elemento. O shadow root corta os dois.
 *
 * ─── CACHE CURTO ────────────────────────────────────────────────────────────
 * 60s com `stale-while-revalidate`. Editar o formulário tem que refletir na página
 * do cliente sem ele mexer em nada — mas sem que cada visita bata no banco.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const base = process.env.NEXT_PUBLIC_APP_URL ?? ''

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('formulario_publico', { p_slug: slug })

  if (error || !data) {
    // Erro vira `console.warn` e um comentário no lugar do formulário, NUNCA uma
    // exceção: um script de terceiro que estoura pode derrubar o JS da página
    // inteira do cliente, e o custo do nosso erro não pode ser a landing page dele.
    return new NextResponse(
      `console.warn('[JobsiteOS] formulário "${slug}" não encontrado ou inativo.');`,
      { status: 200, headers: cabecalhos() },
    )
  }

  const f = data as unknown as FormularioPublico
  const html = htmlDoFormulario(f)
  const css = cssDoFormulario()

  const js = `
${scriptDoFormulario(base)}
(function () {
  var SLUG = ${JSON.stringify(slug)};
  var HTML = ${JSON.stringify(html)};
  var CSS = ${JSON.stringify(css)};

  function montar() {
    // O <div id="jobsiteos-form-{slug}"> é opcional: sem ele o formulário nasce
    // onde a tag <script> está, que é o comportamento que a pessoa espera ao colar
    // o snippet no meio da página.
    var alvo = document.getElementById('jobsiteos-form-' + SLUG);
    if (!alvo) {
      alvo = document.createElement('div');
      alvo.id = 'jobsiteos-form-' + SLUG;
      var self = document.currentScript || document.querySelector('script[src*="/f/' + SLUG + '.js"]');
      if (self && self.parentNode) self.parentNode.insertBefore(alvo, self.nextSibling);
      else document.body.appendChild(alvo);
    }
    if (alvo.dataset.josMontado) return;
    alvo.dataset.josMontado = '1';

    var raiz = alvo.attachShadow ? alvo.attachShadow({ mode: 'open' }) : alvo;
    var estilo = document.createElement('style');
    estilo.textContent = CSS;
    var caixa = document.createElement('div');
    caixa.innerHTML = HTML;
    raiz.appendChild(estilo);
    raiz.appendChild(caixa);
    window.__josMontar(raiz, SLUG);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
`

  return new NextResponse(js, { status: 200, headers: cabecalhos() })
}

function cabecalhos(): HeadersInit {
  return {
    'content-type': 'application/javascript; charset=utf-8',
    'cache-control': 'public, max-age=60, stale-while-revalidate=300',
    // O script é servido para qualquer origem por definição — ele existe para rodar
    // na landing page de terceiro. Não carrega segredo nem dado de ninguém.
    'access-control-allow-origin': '*',
  }
}
