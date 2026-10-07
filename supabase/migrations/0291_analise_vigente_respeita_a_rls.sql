/*
 * `analise_vigente` estava legível sem login.
 *
 * Achada em 07/10/2026 na mesma varredura que pegou `antecipacao_sacados_a_prospectar`
 * (0290): view sem `security_invoker` e com SELECT para `anon`. Rodando com as
 * permissões do dono, ela passava por cima da RLS de `analises_credito` e entregava
 * CNPJ, estágio e LIMITE APROVADO das 124 análises a quem tivesse só a chave pública
 * do app.
 *
 * ── O QUE MUDA, MEDIDO ANTES DE APLICAR (um usuário de cada perfil) ─────────
 *   Admin, Originador, Comercial, Closer, SDR ... 124 → 124  (todos têm `empresas`,
 *                                                  que a política libera inteira)
 *   Revisão de loja ............................ 124 → 0    (só `mercado`; a política
 *                                                  de `analises_credito` nunca o deixou
 *                                                  ver análise — a view é que vazava)
 *   Leitura da ficha em `mercado_explorador` por CNPJ: sem piora em nenhum perfil.
 *
 * A grade do Explorador NÃO muda para ninguém: ela lê pela `mercado_explorar`, que é
 * SECURITY DEFINER (0026), e dentro dela as views rodam como o dono. Quem lê esta view
 * direto no código é o worker, com service role.
 *
 * Sem `create or replace`: a definição fica como está e só a opção muda — que é
 * justamente o que um `create or replace` sem ela teria apagado.
 */

alter view public.analise_vigente set (security_invoker = true);

revoke all on public.analise_vigente from anon;
grant select on public.analise_vigente to authenticated;
