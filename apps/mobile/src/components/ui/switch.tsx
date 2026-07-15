import { Switch as RNSwitch, type SwitchProps as RNSwitchProps } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'

export interface SwitchProps extends Omit<RNSwitchProps, 'trackColor' | 'thumbColor'> {
  className?: string
}

/**
 * The platform switch, tinted with the brand token. Native, deliberately: users
 * expect the OS control here, and a re-implementation loses the platform's
 * haptics and a11y behaviour for nothing.
 */
export function Switch({ value, ...props }: SwitchProps) {
  const { colors, scheme } = useTheme()

  return (
    <RNSwitch
      value={value}
      trackColor={{ false: colors.input, true: colors.primary }}
      thumbColor={scheme === 'dark' ? colors.foreground : colors.background}
      ios_backgroundColor={colors.input}
      accessibilityRole="switch"
      accessibilityState={{ checked: value === true }}
      {...props}
    />
  )
}
