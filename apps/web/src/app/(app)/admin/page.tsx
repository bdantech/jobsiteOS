import { redirect } from 'next/navigation'

/** /admin has no content of its own — Usuários is the landing section. */
export default function AdminPage() {
  redirect('/admin/usuarios')
}
