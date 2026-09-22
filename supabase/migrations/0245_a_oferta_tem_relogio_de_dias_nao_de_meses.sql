-- 0245 — A oferta tem relógio de dias, não de meses
--
-- ─── O QUE O PRIMEIRO CARREGAMENTO REAL MOSTROU ────────────────────────────
-- A varredura de ESTADO nasceu com 92 dias para as duas fontes — o teto do
-- endpoint. Para o título está certo: uma parcela vive até o vencimento dela, que
-- pode estar noventa dias à frente, e ela pode sair de `ready_to_create` para
-- `offer_created` no dia sessenta. Encurtar seria deixar de ver a parcela virar
-- oferta.
--
-- Para a pré-autorização estava errado, e os números do dia 22/09/2026 não deixam
-- dúvida:
--
--     WAITING_CONTRACTED mais antiga ......  5 dias
--     a_prospectar com mais de 30 dias ....  ZERO
--     gravadas com mais de 30 dias ........  778, todas em estágio encerrado
--
-- Uma oferta tem relógio de poucos dias: ou o fornecedor aceita, ou ela expira, ou
-- a construtora revoga. Noventa e dois dias traziam seis semanas de arquivo para
-- render setenta e sete cards vivos. O filtro de 92 dias não estava trazendo
-- trabalho nenhum — só volume.
--
-- A janela nova é de 30 dias (`janela_estado_preauth_dias`), o que cobre o ciclo
-- inteiro de uma oferta com folga larga e ainda deixa um mês de denominador para a
-- taxa de conversão e para o bloco de perdas.
update public.antecipacao_config
   set valor = valor || jsonb_build_object('janela_estado_preauth_dias', 30),
       atualizado_em = now()
 where chave = 'funil_oportunidades';

-- ─── E o arquivo que o primeiro sync já tinha trazido ──────────────────────
--
-- 903 linhas, R$ 25,1 milhões, TODAS em estágio encerrado — 636 convertidas, 236
-- expiradas, 31 perdidas. Decisão do usuário em 22/09/2026, com o custo explicitado:
-- perde-se o denominador de conversão anterior a 30 dias.
--
-- É seguro no sentido que importa: nenhuma delas estava no funil de trabalho
-- (`a_prospectar` com mais de 30 dias era zero), e a janela nova não as traz de
-- volta. O que se perde é histórico de métrica, não trabalho.
delete from public.pre_autorizacoes
 where criada_em < current_date - 30;
