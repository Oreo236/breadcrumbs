import { SymbolView } from 'expo-symbols';
import { Tabs } from 'expo-router';

import { colors } from '@/constants/theme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.toast,
        headerShown: useClientOnlyValue(false, true),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'house.fill', android: 'home', web: 'home' }}
              tintColor={color}
              size={26}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Memory Map',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'map.fill', android: 'map', web: 'map' }}
              tintColor={color}
              size={26}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="join"
        options={{
          title: 'Join',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'qrcode', android: 'qr_code', web: 'qr_code' }}
              tintColor={color}
              size={26}
            />
          ),
        }}
      />
    </Tabs>
  );
}
