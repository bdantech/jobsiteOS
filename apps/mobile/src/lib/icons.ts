import {
  Bell,
  Building2,
  LayoutGrid,
  Map,
  Shield,
  type LucideIcon,
} from 'lucide-react-native'

/**
 * The registry stores an icon *token* (AppModule.icon) precisely so it stays
 * platform-agnostic: web resolves it against lucide-react, mobile against
 * lucide-react-native. Add the module's token here when you register a module —
 * an unknown token falls back to a grid rather than crashing the tab bar.
 */
const MODULE_ICONS: Record<string, LucideIcon> = {
  'building-2': Building2,
  shield: Shield,
  bell: Bell,
  map: Map,
}

export function moduleIcon(token: string): LucideIcon {
  return MODULE_ICONS[token] ?? LayoutGrid
}

export type { LucideIcon }
