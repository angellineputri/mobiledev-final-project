import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/use-theme';
export { applyNumpadKey, formatAmountDisplay, rawToAmount, amountToRaw, decimalsFor, displayCursorToRawCursor, rawCursorToDisplayCursor, applyNumpadKeyAtCursor } from './numpadLogic';

interface Props {
  onKey: (key: string) => void;
  bottomLeftKey?: string;
}

export function NumericKeypad({ onKey, bottomLeftKey = '' }: Props) {
  const t = useTheme();
  const rows = [
    ['7', '8', '9'],
    ['4', '5', '6'],
    ['1', '2', '3'],
    [bottomLeftKey, '0', 'backspace'],
  ];
  return (
    <View
      style={[
        styles.pad,
        { backgroundColor: t.surface, borderTopColor: t.border },
      ]}
    >
      {rows.map((row, ri) => (
        <View key={ri} style={styles.row}>
          {row.map((key, ki) => (
            <Pressable
              key={ki}
              style={({ pressed }) => [styles.key, pressed && key && { backgroundColor: t.bg }]}
              onPress={() => key && onKey(key)}
              disabled={!key}
            >
              {key === 'backspace' ? (
                <Feather name="delete" size={22} color={t.text} />
              ) : key ? (
                <Text style={[styles.keyText, { color: t.text }]}>{key}</Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}


const styles = StyleSheet.create({
  pad: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row' },
  key: { flex: 1, height: 58, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 24, fontWeight: '400' },
});
