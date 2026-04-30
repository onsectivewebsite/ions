/**
 * Bottom tab nav for the signed-in staff app.
 *
 * Four tabs map to the four mobile-friendly chunks of the firm app:
 *   - Dashboard: hi + headline counts
 *   - Cases:     list → detail (read-only on mobile in 9.2)
 *   - Queue:     telecaller's "my leads"
 *   - Agenda:    today's appointments
 *
 * Stack-screen detail pages live OUTSIDE this group at /(staff)/cases/[id]
 * etc. — pushing onto the stack rather than the tab stack so the tab bar
 * stays visible.
 */
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { C } from '../../../src/shared/ui';

function TabIcon({ children, focused }: { children: string; focused: boolean }) {
  return (
    <Text style={{ color: focused ? C.primary : C.textMuted, fontSize: 11, fontWeight: focused ? '700' : '500' }}>
      {children}
    </Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.textMuted,
        tabBarStyle: { borderTopColor: C.border, backgroundColor: C.surface, height: 60, paddingBottom: 6, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused}>•</TabIcon>,
        }}
      />
      <Tabs.Screen
        name="cases"
        options={{
          title: 'Cases',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused}>•</TabIcon>,
        }}
      />
      <Tabs.Screen
        name="queue"
        options={{
          title: 'Queue',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused}>•</TabIcon>,
        }}
      />
      <Tabs.Screen
        name="agenda"
        options={{
          title: 'Agenda',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused}>•</TabIcon>,
        }}
      />
    </Tabs>
  );
}
