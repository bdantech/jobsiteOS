-- 0297d — A razão do certificado é calculada UMA vez por consulta, e não por linha.
--
-- No ramo `cert_balde` de `app__rp_detalhe`, a subconsulta que chama
-- `app__rp_certificados_cegos` era achatada pelo planejador e a função rodava a cada
-- matriz sem certificado: 19,5 s para abrir a lista. `offset 0` é a cerca que impede o
-- achatamento. Medido depois: abaixo de 1 s.
--
-- Aplicada como troca de texto sobre a função viva, para não reenviar as 500 linhas dela.
-- A 0297b do repositório já traz a linha corrigida; rodar isto de novo não muda nada.
do $$
declare
  v_def text := pg_get_functiondef('public.app__rp_detalhe(text,date,date,date,jsonb,integer,integer)'::regprocedure);
  v_de text := $a$->> 'razao')::numeric as razao) rz$a$;
  v_para text := $a$->> 'razao')::numeric as razao offset 0) rz$a$;
begin
  if position(v_de in v_def) > 0 then
    execute replace(v_def, v_de, v_para);
  end if;
end $$;
