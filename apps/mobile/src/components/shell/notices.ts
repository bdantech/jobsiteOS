import type { AppModule } from '@jobsiteos/core'

/**
 * The two ways the registry can refuse a module on mobile. Both are shown to the
 * user verbatim, so the copy lives in one place: the "Mais" grid and the
 * deep-link interceptor must say exactly the same thing about the same module.
 */
export interface ModuleNotice {
  title: string
  description: string
}

/** The module exists, the user may even have it — but it has no mobile UI (admin). */
export function webOnlyNotice(module: AppModule): ModuleNotice {
  return {
    title: 'Disponível apenas na web',
    description: `O módulo ${module.name} não existe no aplicativo. Acesse o JobsiteOS pelo navegador, em um computador, para utilizá-lo.`,
  }
}

/** The module has a mobile UI, but the user's perfil does not grant it. */
export function notGrantedNotice(module: AppModule): ModuleNotice {
  return {
    title: 'Acesso não liberado',
    description: `Seu perfil não tem acesso ao módulo ${module.name}. Fale com um administrador se você precisa desse acesso.`,
  }
}
