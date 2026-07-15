'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Laptop, Moon, Sun } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const TEMAS = [
  { value: 'system', label: 'Sistema', Icon: Laptop },
  { value: 'light', label: 'Claro', Icon: Sun },
  { value: 'dark', label: 'Escuro', Icon: Moon },
] as const

export function AparenciaCard() {
  const { theme, setTheme } = useTheme()

  // next-themes only knows the resolved theme after mount (it reads
  // localStorage / the system query). Rendering the real value on the server
  // would hydrate with the wrong option selected, so hold a skeleton until then.
  const [montado, setMontado] = useState(false)
  useEffect(() => setMontado(true), [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aparência</CardTitle>
        <CardDescription>
          O tema é salvo neste navegador e segue o sistema por padrão.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="tema">Tema</Label>

          {montado ? (
            <Select value={theme ?? 'system'} onValueChange={setTheme}>
              <SelectTrigger id="tema" className="w-44">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {TEMAS.map(({ value, label, Icon }) => (
                  <SelectItem key={value} value={value}>
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4" aria-hidden />
                      {label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Skeleton className="h-10 w-44" />
          )}
        </div>
      </CardContent>
    </Card>
  )
}
