import { StyleSheet, Text, type TextProps } from 'react-native';

import { ThemeTokens } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';

export type ThemedTextType =
  | 'default'      // 15 / 500 — general body
  | 'small'        // 12 / 400 — secondary meta line
  | 'smallBold'    // 13 / 600 — chip labels, small headers
  | 'title'        // 22 / 700 / ls-0.4 — tab root page title
  | 'subtitle'     // 38 / 600 / ls-1.4 / tabular — hero amount
  | 'section'      // 15 / 600 — section headers
  | 'eyebrow'      // 11 / 600 / ls+1.4 / UPPER — TOTAL BALANCE
  | 'badge'        // 10 / 600 / ls+0.4 — SPLIT badge
  | 'stackTitle'   // 18 / 600 — stack screen titles
  | 'amountInput'; // 40 / 600 / ls-1.4 / tabular — amount entry

export type ThemedTextProps = TextProps & {
  type?: ThemedTextType;
  themeColor?: keyof ThemeTokens;
};

export function ThemedText({
  style,
  type = 'default',
  themeColor,
  ...rest
}: ThemedTextProps) {
  const theme = useTheme();
  const color = theme[themeColor ?? 'text'];

  return (
    <Text
      style={[{ color }, styles[type], style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: { fontSize: 15, fontWeight: '500', lineHeight: 22 },
  small: { fontSize: 12, fontWeight: '400', lineHeight: 18 },
  smallBold: { fontSize: 13, fontWeight: '600', lineHeight: 19 },
  title: { fontSize: 22, fontWeight: '700', lineHeight: 30, letterSpacing: -0.4 },
  subtitle: {
    fontSize: 38,
    fontWeight: '600',
    lineHeight: 50,
    letterSpacing: -1.4,
    fontVariant: ['tabular-nums'],
  },
  section: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
  eyebrow: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  badge: {
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 13,
    letterSpacing: 0.4,
  },
  stackTitle: { fontSize: 18, fontWeight: '600', lineHeight: 26 },
  amountInput: {
    fontSize: 52,
    fontWeight: '600',
    lineHeight: 64,
    letterSpacing: -2.4,
    fontVariant: ['tabular-nums'],
  },
});
