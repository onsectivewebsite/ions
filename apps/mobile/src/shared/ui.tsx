/**
 * Mobile UI primitives — small, opinionated, RN-native.
 *
 * The web side uses @onsecboad/ui (web-only — Tailwind classes + DOM).
 * On mobile we redo the same handful of components with RN StyleSheet.
 * Shape and prop names match the web side so screens can be ported
 * without churn.
 */
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import type { ReactNode } from 'react';

export const C = {
  bg: '#FAFAF7',
  surface: '#FFFFFF',
  surfaceMuted: '#F4F4F0',
  border: '#E5E5DF',
  borderMuted: '#EFEFEA',
  text: '#111827',
  textMuted: '#6b7280',
  textOnPrimary: '#FFFFFF',
  primary: '#B5132B',
  primaryHover: '#9C0F25',
  success: '#15803D',
  warning: '#B45309',
  danger: '#B91C1C',
};

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.cardTitle}>{children}</Text>;
}

export type BadgeTone = 'success' | 'warning' | 'neutral' | 'danger' | 'info';

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  const palette = TONE[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Text style={[styles.badgeText, { color: palette.text }]}>{children}</Text>
    </View>
  );
}

const TONE: Record<BadgeTone, { bg: string; border: string; text: string }> = {
  success: { bg: '#DCFCE7', border: '#86EFAC', text: '#166534' },
  warning: { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E' },
  neutral: { bg: '#F3F4F6', border: '#E5E7EB', text: '#374151' },
  danger: { bg: '#FEE2E2', border: '#FECACA', text: '#991B1B' },
  info: { bg: '#DBEAFE', border: '#BFDBFE', text: '#1E40AF' },
};

export function Button({
  children,
  variant = 'primary',
  busy,
  disabled,
  style,
  textStyle,
  ...rest
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
  textStyle?: StyleProp<TextStyle>;
} & Omit<PressableProps, 'children' | 'style'> & {
    style?: StyleProp<ViewStyle>;
  }) {
  const variantStyle =
    variant === 'primary'
      ? { backgroundColor: C.primary, borderWidth: 0 }
      : variant === 'danger'
        ? { backgroundColor: C.danger, borderWidth: 0 }
        : variant === 'ghost'
          ? { backgroundColor: 'transparent', borderWidth: 0 }
          : { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border };
  const text =
    variant === 'primary' || variant === 'danger'
      ? { color: C.textOnPrimary }
      : variant === 'ghost'
        ? { color: C.textMuted }
        : { color: C.text };
  const isDisabled = !!disabled || !!busy;
  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variantStyle,
        pressed && !isDisabled && { opacity: 0.7 },
        isDisabled && { opacity: 0.5 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={text.color} />
      ) : (
        <Text style={[styles.buttonText, text, textStyle]}>{children}</Text>
      )}
    </Pressable>
  );
}

export function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: 'muted' | 'success' | 'warning' | 'danger';
}) {
  const valueColor =
    tone === 'success'
      ? C.success
      : tone === 'warning'
        ? C.warning
        : tone === 'danger'
          ? C.danger
          : tone === 'muted'
            ? C.textMuted
            : C.text;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 8 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  button: {
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    flexDirection: 'row',
  },
  buttonText: { fontWeight: '600', fontSize: 15 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  rowLabel: {
    fontSize: 12,
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rowValue: { fontSize: 14, fontWeight: '500' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.borderMuted, marginVertical: 8 },
  empty: { paddingVertical: 32, alignItems: 'center' },
  emptyTitle: { color: C.text, fontSize: 14, fontWeight: '500' },
  emptyHint: { color: C.textMuted, fontSize: 12, marginTop: 6, textAlign: 'center' },
});
