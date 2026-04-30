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

export default function ClientTabsLayout() {
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
      <Tabs.Screen name="index" options={{ title: 'Files', tabBarIcon: ({ focused }) => <TabIcon focused={focused}>•</TabIcon> }} />
      <Tabs.Screen name="invoices" options={{ title: 'Invoices', tabBarIcon: ({ focused }) => <TabIcon focused={focused}>•</TabIcon> }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarIcon: ({ focused }) => <TabIcon focused={focused}>•</TabIcon> }} />
    </Tabs>
  );
}
