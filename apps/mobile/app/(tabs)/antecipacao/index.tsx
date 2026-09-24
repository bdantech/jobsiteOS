import { FunilNotas } from '@/features/antecipacao'

/**
 * O FUNIL É A TELA PRINCIPAL DO MÓDULO no mobile (§9) — não um dashboard. A tela
 * mora em `features/antecipacao/components/funil-notas.tsx` porque o Comercial abre
 * o mesmo funil, recortado na carteira, como "Funil de NFs".
 */
export default function FunilScreen() {
  return <FunilNotas titulo="Funil" atalhos />
}
