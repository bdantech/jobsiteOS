/*
 * Dois modelos que entregam o link de antecipação — WhatsApp e e-mail.
 *
 * ── O QUE O TEXTO NÃO PODE PROMETER ─────────────────────────────────────────
 * Em ~99% das NF-e o vencimento NÃO vem na nota, e é o emissor quem informa essa
 * data ao solicitar. O link abre um formulário preenchido, não uma antecipação
 * pronta em um clique — e o guia da API pede, em letras, que a comunicação seja
 * ajustada a isso. Um template que dissesse "antecipe em um clique" produziria
 * uma frustração por envio, na mão de quem a gente está tentando conquistar.
 *
 * ── POR QUE NÃO USA `{qtd_notas}` NEM `{valor_total}` ───────────────────────
 * Essas duas falam da CARTEIRA do fornecedor (todas as notas vivas dele), e o
 * link é de UMA nota. "Você tem 12 notas somando R$ 300 mil" ao lado de um link
 * que abre uma delas faz o leitor procurar as outras onze. O texto fala do que
 * o link faz, e só.
 *
 * ── A DISPENSA DO A1 É O ARGUMENTO, E É VERDADE ─────────────────────────────
 * Empresa que se cadastra pelo link entra dispensada do certificado digital A1.
 * É a maior fricção do nosso funil de aquisição dita em uma linha, então ela
 * está nos dois textos.
 *
 * `on conflict` para que reaplicar a migração não duplique nem apague uma edição
 * feita na tela — o corpo é config, e quem escreve mensagem é quem manda nela.
 */

insert into public.templates_mensagem (nome, canal, funil, objetivo, assunto, corpo, variaveis, ativo)
values
  (
    'Link de antecipação da nota',
    'whatsapp',
    'nfs',
    'antecipar_nf',
    null,
    'Olá, {contato_nome}! Aqui é {remetente_nome}, da ONE OS.

Dá para antecipar o valor de uma nota que a {empresa_nome} emitiu. Este link abre o pedido já preenchido, com o arquivo da nota junto:

{link_antecipacao}

Você confere os dados, informa a data de vencimento e confirma. Se ainda não tiver conta, dá para criar na hora — e entrando por aqui você fica dispensado do certificado digital A1.

Qualquer dúvida, é só me chamar por aqui.',
    array['contato_nome', 'remetente_nome', 'empresa_nome', 'link_antecipacao'],
    true
  ),
  (
    'Link de antecipação da nota',
    'email',
    'nfs',
    'antecipar_nf',
    'Antecipação da nota emitida pela {empresa_nome}',
    'Olá, {contato_nome},

Aqui é {remetente_nome}, da ONE OS.

Uma nota emitida pela {empresa_nome} pode ser antecipada. O link abaixo abre a solicitação já preenchida com os dados e o arquivo da nota:

{link_antecipacao}

O que falta é do seu lado e leva um minuto: conferir os dados, informar a data de vencimento e confirmar. O vencimento quase nunca vem escrito na nota, por isso ele é pedido ali.

Se a {empresa_nome} ainda não tiver conta, dá para criar pelo próprio link — e quem entra por ele fica dispensado do certificado digital A1.

Fico à disposição para qualquer dúvida.

{remetente_nome}
ONE OS',
    array['contato_nome', 'remetente_nome', 'empresa_nome', 'link_antecipacao'],
    true
  )
on conflict (nome, canal) do update set
  funil = excluded.funil,
  objetivo = excluded.objetivo,
  assunto = excluded.assunto,
  corpo = excluded.corpo,
  variaveis = excluded.variaveis,
  atualizado_em = now();
