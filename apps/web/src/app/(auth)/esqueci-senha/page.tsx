import type { Metadata } from 'next'
import { EsqueciSenhaForm } from './esqueci-senha-form'

export const metadata: Metadata = {
  title: 'Esqueci minha senha',
}

/**
 * Pede o link para criar uma nova senha (0262). Pública — é para quem não consegue
 * entrar —, e por isso a rota de API por trás responde sempre a mesma frase.
 */
export default function EsqueciSenhaPage() {
  return <EsqueciSenhaForm />
}
