/*
 * `anticipationLink`: o endereço que leva o EMISSOR da nota direto ao pedido de
 * antecipação no Onepay, já preenchido. Publicado por eles em 21/09/2026.
 *
 * ── POR QUE COLUNA E NÃO VIEW ───────────────────────────────────────────────
 * O link é propriedade do DOCUMENTO, não da oportunidade. Quem o mostra é o
 * modal da nota, que já lê `notas_fiscais` por `access_key` para montar as abas
 * Documento e XML — então ele não precisa atravessar `notas_funil` nem as três
 * views por fonte do funil. Uma coluna a mais lá custaria `null::text` nas
 * outras duas fontes e a recriação da união, para um dado que só a NF tem.
 *
 * ── O QUE ESPERAR DO VALOR ──────────────────────────────────────────────────
 * `null` é o caso NORMAL e não é erro: só ganha link a nota `received`, completa,
 * autorizada, com emissor de CNPJ e valor na faixa — cerca de 66% do estoque
 * recebido, pela medição deles. Nota em resumo ganha o link no instante em que o
 * XML completo chega, e link revogado por operador volta a `null` para sempre.
 *
 * O link é PERMANENTE e a mesma nota devolve sempre a mesma URL, então guardar
 * aqui é seguro. Mas ele pode deixar de existir: quem for reenviar depois de
 * muito tempo relê a nota antes.
 *
 * ── ELE NÃO É CREDENCIAL ────────────────────────────────────────────────────
 * A autorização é conferida na abertura (CNPJ da conta = CNPJ do emissor), então
 * a URL não carrega dado sensível e quem não é o emissor só vê um resumo com o
 * CNPJ oculto. O destinatário certo é sempre o FORNECEDOR da nota, nunca o
 * sacado — e é por isso que o resolvedor da variável `{link_antecipacao}` só
 * preenche quando a empresa do destinatário é a do fornecedor.
 */

alter table public.notas_fiscais
  add column if not exists link_antecipacao text;

comment on column public.notas_fiscais.link_antecipacao is
  'URL do pedido de antecipação já preenchido, para o FORNECEDOR da nota. Vem de anticipationLink em GET /api/v1/invoices. Nulo é o caso normal (ver §2 do guia da API).';
