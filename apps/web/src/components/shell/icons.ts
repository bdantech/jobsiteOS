import {
  Banknote,
  Bell,
  Building2,
  CalendarClock,
  Gavel,
  LayoutGrid,
  type LucideIcon,
  Map,
  MessageCircle,
  Radar,
  Settings,
  Shield,
  Users,
  Wallet,
} from 'lucide-react'

/**
 * `AppModule.icon` is a platform-neutral token ("building-2"), because the registry
 * lives in packages/core and must not import lucide-react (the mobile app resolves
 * the same token against lucide-react-native).
 *
 * This is the web half of that contract. It is an explicit map, not a dynamic lookup
 * against lucide's full export list: a dynamic map defeats tree-shaking and pulls all
 * ~1500 icons into the client bundle.
 *
 * Tokens for the modules named in the roadmap (Mercado, Radar, Cadências, WhatsApp
 * Hub, Carteira, Cobrança, Jurídico) are pre-registered, so adding one of them stays
 * a three-step job — migration, screens, registry entry — with no detour through here.
 */
const MODULE_ICONS: Record<string, LucideIcon> = {
  'building-2': Building2,
  shield: Shield,
  bell: Bell,
  map: Map,
  radar: Radar,
  'calendar-clock': CalendarClock,
  'message-circle': MessageCircle,
  wallet: Wallet,
  banknote: Banknote,
  gavel: Gavel,
  users: Users,
  settings: Settings,
}

/** Unknown token → a neutral placeholder. A missing icon must never blank the sidebar. */
export function moduleIcon(token: string): LucideIcon {
  return MODULE_ICONS[token] ?? LayoutGrid
}
