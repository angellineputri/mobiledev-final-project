import { View, type ViewProps } from 'react-native';

import { ThemeTokens } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedViewProps = ViewProps & {
  type?: keyof ThemeTokens;
};

export function ThemedView({ style, type = 'bg', ...otherProps }: ThemedViewProps) {
  const theme = useTheme();
  return <View style={[{ backgroundColor: theme[type] }, style]} {...otherProps} />;
}
