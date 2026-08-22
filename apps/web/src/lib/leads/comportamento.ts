import 'server-only'
import { PROVEDORES_EMAIL_GENERICOS } from '@jobsiteos/core'

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
  // A lista vem de packages/core (radar/dominio.ts), interpolada no build do script.
  // Copiá-la à mão aqui criaria uma segunda opinião sobre o que é e-mail corporativo,
  // e as duas divergiriam no primeiro provedor novo.
  var GENERICOS = ${JSON.stringify(PROVEDORES_EMAIL_GENERICOS)};

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

  /**
   * Telefone no padrão brasileiro enquanto se digita: (11) 98765-4321.
   *
   * O 9º dígito decide o formato, então a máscara só fecha o hífen quando sabe se é
   * fixo (8 dígitos) ou celular (9). Formatar cedo demais faria o cursor pular no
   * meio da digitação, que é o defeito clássico de máscara em campo de telefone.
   */
  function mascaraTelefone(v) {
    var d = v.replace(/\\D/g, '').slice(0, 11);
    if (d.length <= 2) return d.length ? '(' + d : '';
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }

  function emailFormatoOk(v) {
    return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(v.trim());
  }

  /** Provedor pessoal? Vira AVISO, nunca bloqueio — muita gente de obra usa gmail. */
  function ehEmailPessoal(v) {
    var m = v.trim().toLowerCase().split('@')[1];
    if (!m) return false;
    var host = m.split('.')[0];
    return GENERICOS.indexOf(host) >= 0;
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

  /*
   * A Poppins entra pelo document.head, e nao pelo CSS do shadow root.
   *
   * @font-face declarado dentro de um shadow root e ignorado por parte dos navegadores —
   * o carregamento de fonte e escopo do DOCUMENTO, nao da arvore de sombra. Declarar la
   * dentro funcionaria em alguns navegadores e falharia em silencio nos outros, que e a
   * pior das duas.
   *
   * Idempotente pelo id: a mesma pagina pode ter dois formularios embutidos, e dois links
   * iguais no head sao dois downloads.
   *
   * display=swap de proposito: o texto aparece na hora com a fonte de reserva e troca
   * quando a Poppins chegar. Um formulario invisivel por 3s esperando fonte e um
   * formulario que ninguem preenche.
   *
   * Se a CSP da pagina do cliente bloquear o Google Fonts, isto falha em silencio e a
   * pilha de reserva do CSS assume. E o certo: fonte e acabamento, formulario e funcao.
   */
  function garantirFonte() {
    try {
      if (document.getElementById('jos-fonte')) return;
      var pre = document.createElement('link');
      pre.rel = 'preconnect';
      pre.href = 'https://fonts.gstatic.com';
      pre.crossOrigin = 'anonymous';
      document.head.appendChild(pre);

      var link = document.createElement('link');
      link.id = 'jos-fonte';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap';
      document.head.appendChild(link);
    } catch (e) { /* head inacessivel nao pode derrubar o formulario */ }
  }

  window.__josMontar = function (raiz, slug) {
    var form = raiz.querySelector('[data-jos-form]');
    if (!form || form.dataset.josPronto) return;
    form.dataset.josPronto = '1';
    garantirFonte();

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

    function erroDe(campo) { return raiz.querySelector('[data-erro="' + campo + '"]'); }
    function avisoDe(campo) { return raiz.querySelector('[data-aviso="' + campo + '"]'); }

    function marcar(campo, el, msg) {
      var alvo = erroDe(campo);
      if (alvo) { alvo.textContent = msg || ''; alvo.hidden = !msg; }
      if (el) el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    }
    function avisar(campo, msg) {
      var alvo = avisoDe(campo);
      if (alvo) { alvo.textContent = msg || ''; alvo.hidden = !msg; }
    }

    var cnpjEl = form.querySelector('[name="cnpj"]');
    var razaoEl = form.querySelector('[name="razao_social"]');
    var emailEl = form.querySelector('[name="email"]');
    var telEls = form.querySelectorAll('[name="telefone"], [name="whatsapp"]');
    var botaoEl = form.querySelector('button[type="submit"]');

    /*
     * O botão fica DESABILITADO enquanto o CNPJ não fecha.
     *
     * Antes o erro só aparecia no submit: a pessoa preenchia o formulário inteiro
     * para descobrir no fim que o primeiro campo estava errado. Validar ao vivo e
     * travar o envio é mais honesto — e o erro aparece no campo, não num alerta no
     * topo que some da vista em celular.
     */
    function revalidar() {
      if (!cnpjEl || !botaoEl) return;
      var bruto = cnpjEl.value.replace(/\\D/g, '');
      var ok = cnpjValido(cnpjEl.value);
      // Só reclama quando os 14 dígitos estão lá: acusar erro no terceiro dígito é
      // discutir com quem ainda está digitando.
      marcar('cnpj', cnpjEl, bruto.length === 14 && !ok ? 'Este CNPJ não existe — confira os dígitos.' : '');
      botaoEl.disabled = !ok;
    }

    for (var i = 0; i < telEls.length; i++) {
      (function (el) {
        el.addEventListener('input', function () { el.value = mascaraTelefone(el.value); });
      })(telEls[i]);
    }

    if (emailEl) {
      emailEl.addEventListener('blur', function () {
        var v = emailEl.value.trim();
        if (!v) { marcar('email', emailEl, ''); avisar('email', ''); return; }
        if (!emailFormatoOk(v)) {
          marcar('email', emailEl, 'Confira o e-mail — falta o @ ou o domínio.');
          avisar('email', '');
          return;
        }
        marcar('email', emailEl, '');
        avisar(
          'email',
          ehEmailPessoal(v) ? 'É um e-mail pessoal. Se tiver o corporativo, o atendimento fica mais rápido.' : '',
        );
      });
    }

    if (cnpjEl) {
      cnpjEl.addEventListener('blur', revalidar);
      cnpjEl.addEventListener('input', function () {
        cnpjEl.value = mascaraCnpj(cnpjEl.value);
        revalidar();
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
      // Nasce travado: o CNPJ é obrigatório e ainda está vazio.
      revalidar();
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

      // Cinto e suspensório: o botão já fica travado, mas o submit também chega por
      // Enter no teclado e por navegador que ignora o disabled em campo autopreenchido.
      if (cnpjEl && !cnpjValido(cnpjEl.value)) {
        marcar('cnpj', cnpjEl, 'Este CNPJ não existe — confira os dígitos.');
        cnpjEl.focus();
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
            // O CABEÇALHO SOME JUNTO. Sem isto a tela fica dizendo "Responda em 30
            // segundos e o time entra em contato" logo acima de "Recebemos seu
            // contato" — duas mensagens que se contradizem no mesmo instante.
            var cab = raiz.querySelector('[data-cabecalho]');
            if (cab) cab.hidden = true;
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
