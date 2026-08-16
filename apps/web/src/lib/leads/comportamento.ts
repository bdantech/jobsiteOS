import 'server-only'

/**
 * O JavaScript que roda no navegador do visitante — na página standalone e dentro da
 * landing page de terceiro. Um só, pelo mesmo motivo do HTML: duas cópias divergem.
 *
 * É string e não módulo porque precisa ser injetado inline no shadow DOM do embed,
 * sem bundler, sem framework e sem nenhuma dependência. Cabe em poucos KB e é o preço
 * total que a página do cliente paga por ter o formulário.
 */
export function scriptDoFormulario(base: string): string {
  return `
(function () {
  var BASE = ${JSON.stringify(base)};

  /**
   * O tema vem da LUMINÂNCIA DO FUNDO, subindo a árvore até achar cor opaca.
   * A media query prefers-color-scheme seria a resposta errada: numa página preta
   * por quem usa o sistema no claro, ele deixaria o formulário branco no meio do
   * preto. O que importa é o fundo em que o formulário foi colado.
   */
  function ehFundoEscuro(el) {
    var n = el;
    while (n && n !== document.documentElement) {
      var c = getComputedStyle(n).backgroundColor;
      var m = c && c.match(/rgba?\\(([^)]+)\\)/);
      if (m) {
        var p = m[1].split(',').map(function (x) { return parseFloat(x); });
        var alfa = p.length > 3 ? p[3] : 1;
        if (alfa > 0.1) {
          // Luminância relativa aproximada (ITU-R BT.601): suficiente para decidir
          // entre duas paletas, e não precisa de mais.
          return (p[0] * 299 + p[1] * 587 + p[2] * 114) / 1000 < 128;
        }
      }
      n = n.parentElement;
    }
    return false;
  }

  function mascaraCnpj(v) {
    var d = v.replace(/\\D/g, '').slice(0, 14);
    if (d.length > 12) return d.replace(/^(\\d{2})(\\d{3})(\\d{3})(\\d{4})(\\d+)$/, '$1.$2.$3/$4-$5');
    if (d.length > 8) return d.replace(/^(\\d{2})(\\d{3})(\\d{3})(\\d+)$/, '$1.$2.$3/$4');
    if (d.length > 5) return d.replace(/^(\\d{2})(\\d{3})(\\d+)$/, '$1.$2.$3');
    if (d.length > 2) return d.replace(/^(\\d{2})(\\d+)$/, '$1.$2');
    return d;
  }

  function cnpjValido(c) {
    var d = c.replace(/\\D/g, '');
    if (d.length !== 14 || /^(\\d)\\1{13}$/.test(d)) return false;
    var calc = function (base, pesos) {
      var s = 0;
      for (var i = 0; i < pesos.length; i++) s += parseInt(base[i], 10) * pesos[i];
      var r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    var p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    var p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    return calc(d, p1) === parseInt(d[12], 10) && calc(d, p2) === parseInt(d[13], 10);
  }

  function utmDaPagina() {
    var out = {};
    try {
      var q = new URL(window.location.href).searchParams;
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
        var v = q.get(k);
        if (v) out[k] = v;
      });
    } catch (e) { /* URL exótica não pode derrubar o formulário */ }
    return out;
  }

  window.__josMontar = function (raiz, slug) {
    var form = raiz.querySelector('[data-jos-form]');
    if (!form || form.dataset.josPronto) return;
    form.dataset.josPronto = '1';

    var root = raiz.querySelector('.jos-root') || raiz;
    if (ehFundoEscuro(root.parentElement || root)) root.classList.add('jos-dark');

    var nascido = Date.now();
    var alerta = raiz.querySelector('[data-alerta]');
    var sucesso = raiz.querySelector('[data-sucesso]');

    // Visualização: é o denominador da taxa de conversão. keepalive para o beacon
    // sobreviver a quem fecha a aba no mesmo segundo.
    try {
      fetch(BASE + '/api/f/' + slug + '/view', {
        method: 'POST', keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pagina_url: location.href, utm: utmDaPagina() }),
      }).catch(function () {});
    } catch (e) {}

    var cnpjEl = form.querySelector('[name="cnpj"]');
    var razaoEl = form.querySelector('[name="razao_social"]');
    if (cnpjEl) {
      cnpjEl.addEventListener('input', function () {
        cnpjEl.value = mascaraCnpj(cnpjEl.value);
        /*
         * Autocomplete da razão social pela BrasilAPI aos 14 dígitos. O ganho não é
         * cosmético: quem digita o próprio nome de empresa erra, e um lead com razão
         * social errada é um lead que o dedup não encontra depois.
         *
         * Falha em silêncio de propósito — a API é gratuita e cai. O campo continua
         * editável, e o cadastral definitivo vem da nossa fila mesmo.
         */
        if (razaoEl && !razaoEl.dataset.tocado && cnpjValido(cnpjEl.value)) {
          var d = cnpjEl.value.replace(/\\D/g, '');
          fetch('https://brasilapi.com.br/api/cnpj/v1/' + d)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
              if (j && (j.razao_social || j.nome_fantasia) && !razaoEl.value) {
                razaoEl.value = j.razao_social || j.nome_fantasia;
              }
            })
            .catch(function () {});
        }
      });
      if (razaoEl) {
        razaoEl.addEventListener('input', function () { razaoEl.dataset.tocado = '1'; });
      }
    }

    function mostrarErro(msg, campo) {
      raiz.querySelectorAll('[data-erro]').forEach(function (e) { e.hidden = true; });
      if (campo) {
        var alvo = raiz.querySelector('[data-erro="' + campo + '"]');
        if (alvo) { alvo.textContent = msg; alvo.hidden = false; alerta.hidden = true; return; }
      }
      alerta.textContent = msg;
      alerta.hidden = false;
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var botao = form.querySelector('button[type="submit"]');
      var fd = new FormData(form);
      var dados = {};
      fd.forEach(function (v, k) {
        if (k === 'intencao' || k === 'consentimento' || k === 'empresa_site') return;
        dados[k] = v;
      });

      if (cnpjEl && !cnpjValido(cnpjEl.value)) {
        mostrarErro('Confira o CNPJ — os dígitos não fecham.', 'cnpj');
        return;
      }

      botao.disabled = true;
      alerta.hidden = true;

      fetch(BASE + '/api/f/' + slug, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dados: dados,
          intencao: fd.get('intencao') || null,
          consentimento_aceito: fd.get('consentimento') ? true : false,
          _hp: fd.get('empresa_site') || '',
          _ms: Date.now() - nascido,
          referrer: document.referrer || null,
          pagina_url: location.href,
          utm: utmDaPagina(),
        }),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          // Spam recebe 200 e a tela de sucesso: o bot não pode aprender o que o
          // denunciou, e um humano falso-positivo não vê erro nenhum.
          if (res.ok) {
            form.hidden = true;
            sucesso.hidden = false;
            return;
          }
          botao.disabled = false;
          mostrarErro((res.j && res.j.erro) || 'Não conseguimos enviar. Tente de novo.', res.j && res.j.campo);
        })
        .catch(function () {
          botao.disabled = false;
          mostrarErro('Sem conexão com o servidor. Tente de novo.');
        });
    });
  };
})();
`
}
