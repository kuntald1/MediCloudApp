import { Tabs } from 'expo-router';
import { View, Text, TouchableOpacity, StyleSheet, Modal, FlatList } from 'react-native';
import { router } from 'expo-router';
import { useState, useEffect, useCallback, useRef } from 'react';
import { authHeader, API_BASE } from '../../../src/utils/auth';

// Poll for reports awaiting this doctor's validation — same list the
// "Report Validate" screen shows, so the badge count always matches.
const POLL_MS = 8000;

function NotificationBell() {
  const [pending, setPending] = useState<any[]>([]);
  const [openBell, setOpenBell] = useState(false);
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

  // router.navigate (not push) so switching to an already-mounted Tabs
  // screen reuses it instead of stacking a duplicate on top.
  const goValidate = () => { setOpenBell(false); router.navigate('/(doctor)/validate' as any); };

  return (
    <>
      <TouchableOpacity style={styles.bell} onPress={() => { fetchPending(); setOpenBell(true); }}>
        <Text style={styles.bellIcon}>🔔</Text>
        {pending.length > 0 && (
          <View style={styles.badge}><Text style={styles.badgeText}>{pending.length}</Text></View>
        )}
      </TouchableOpacity>

      <Modal visible={openBell} transparent animationType="fade" onRequestClose={() => setOpenBell(false)}>
        <TouchableOpacity style={styles.notifOverlay} activeOpacity={1} onPress={() => setOpenBell(false)}>
          <View style={styles.notifCard}>
            <Text style={styles.notifTitle}>🩺 Awaiting Validation ({pending.length})</Text>
            <FlatList
              data={pending}
              keyExtractor={(it, i) => (it.id ?? i).toString()}
              style={{ maxHeight: 340 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.notifItem} onPress={goValidate}>
                  <Text style={styles.notifName}>{item.patient_name}</Text>
                  <Text style={styles.notifSub}>
                    {item.barcode}{item.accession_numbers && item.accession_numbers.length > 0 ? ` · ${item.accession_numbers.join(', ')}` : ''} · awaiting validation
                  </Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.notifEmpty}>Nothing here 🎉</Text>}
            />
            {pending.length > 0 && (
              <TouchableOpacity style={styles.notifAction} onPress={goValidate}>
                <Text style={styles.notifActionText}>Go to Report Validate →</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

export default function DoctorLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle:           { backgroundColor: '#F8FAFC' },
        headerTintColor:       '#0F172A',
        headerTitleStyle:      { fontWeight: 'bold' },
        tabBarStyle:           { backgroundColor: '#F8FAFC', borderTopColor: '#E2E8F0', paddingBottom: 4 },
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
  notifOverlay:    { flex: 1, backgroundColor: '#00000066', paddingTop: 90, paddingHorizontal: 12 },
  notifCard:       { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#E2E8F0' },
  notifTitle:      { color: '#0F172A', fontSize: 15, fontWeight: 'bold', marginBottom: 12 },
  notifItem:       { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  notifName:       { color: '#0F172A', fontSize: 14, fontWeight: '600' },
  notifSub:        { fontSize: 12, marginTop: 2, color: '#8B5CF6' },
  notifEmpty:      { color: '#64748B', textAlign: 'center', paddingVertical: 20 },
  notifAction:     { marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: '#8B5CF6', alignItems: 'center' },
  notifActionText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
