import { Tabs } from 'expo-router';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useState, useEffect, useCallback, useRef } from 'react';
import { authHeader, API_BASE } from '../../../src/utils/auth';

// Poll for reports awaiting this doctor's validation — same list the
// "Report Validate" screen shows, so the badge count always matches.
const POLL_MS = 8000;

function NotificationBell() {
  const [pending, setPending] = useState<any[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPending = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/reports/pending`, { headers: authHeader() });
      const data = res.ok ? await res.json() : [];
      setPending(Array.isArray(data) ? data : []);
    } catch { /* silent — keep last known count on transient network errors */ }
  }, []);

  useEffect(() => {
    fetchPending();
    timer.current = setInterval(fetchPending, POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [fetchPending]);

  return (
    <TouchableOpacity style={styles.bell} onPress={() => router.push('/(doctor)/validate' as any)}>
      <Text style={styles.bellIcon}>🔔</Text>
      {pending.length > 0 && (
        <View style={styles.badge}><Text style={styles.badgeText}>{pending.length}</Text></View>
      )}
    </TouchableOpacity>
  );
}

export default function DoctorLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle:           { backgroundColor: '#0F172A' },
        headerTintColor:       '#F1F5F9',
        headerTitleStyle:      { fontWeight: 'bold' },
        tabBarStyle:           { backgroundColor: '#0F172A', borderTopColor: '#1E293B', paddingBottom: 4 },
        tabBarActiveTintColor:   '#8B5CF6',
        tabBarInactiveTintColor: '#475569',
        headerLeft: () => (
          <Text style={{ color: '#8B5CF6', fontSize: 18, marginLeft: 16 }}>👨‍⚕️</Text>
        ),
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
            <NotificationBell />
            <TouchableOpacity onPress={() => router.replace('/')} style={{ marginRight: 8 }}>
              <Text style={{ color: '#EF4444', fontSize: 13 }}>Logout</Text>
            </TouchableOpacity>
          </View>
        ),
      }}
    >
      <Tabs.Screen
        name="validate"
        options={{
          title: 'Report Validate',
          tabBarLabel: 'Validate',
          tabBarIcon: ({ color, size }) => <Text style={{ fontSize: size - 4, color }}>✅</Text>,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Validate History',
          tabBarLabel: 'History',
          tabBarIcon: ({ color, size }) => <Text style={{ fontSize: size - 4, color }}>📜</Text>,
        }}
      />
      <Tabs.Screen
        name="commission"
        options={{
          title: 'My Commission',
          tabBarLabel: 'Commission',
          tabBarIcon: ({ color, size }) => <Text style={{ fontSize: size - 4, color }}>💰</Text>,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bell:      { padding: 6, marginRight: 4, position: 'relative' },
  bellIcon:  { fontSize: 19 },
  badge:     { position: 'absolute', top: 0, right: 0, minWidth: 15, height: 15, borderRadius: 8, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: 'bold' },
});
