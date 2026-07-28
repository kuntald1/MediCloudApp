import { Drawer } from 'expo-router/drawer';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, FlatList } from 'react-native';
import { router, usePathname, useNavigation } from 'expo-router';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Image } from 'expo-image';
import { authHeader, API_BASE } from '../../../src/utils/auth';

const FRANCHISE_MENUS = [
  { name: 'dashboard',      title: 'Dashboard',      icon: '📊' },
  { name: 'patients',       title: 'Patients',       icon: '👥' },
  { name: 'results',        title: 'Results',        icon: '📋' },
  { name: 'new-bill',       title: 'New Bill',       icon: '🧾' },
  { name: 'bills',          title: 'Bills',          icon: '💳' },
  { name: 'manage-credit',  title: 'Manage Credit',  icon: '🏦' },
  { name: 'history-needed', title: 'History Needed', icon: '📜' },
  { name: 'sample-report',  title: 'Sample Report',  icon: '📄' },
];

// ── Notification Bells (shared across all franchise screens) ──
function NotificationBells() {
  const [history, setHistory]   = useState<any[]>([]);
  const [rejected, setRejected] = useState<any[]>([]);
  const [openBell, setOpenBell] = useState<'history' | 'rejected' | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifs = useCallback(async () => {
    try {
      const [h, r] = await Promise.all([
        fetch(`${API_BASE}/api/reports/notifications/history`,  { headers: authHeader() }).then(x => x.ok ? x.json() : { items: [] }),
        fetch(`${API_BASE}/api/reports/notifications/rejected`, { headers: authHeader() }).then(x => x.ok ? x.json() : { items: [] }),
      ]);
      setHistory(h.items ?? []);
      setRejected(r.items ?? []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchNotifs();
    timer.current = setInterval(fetchNotifs, 30000); // refresh every 30s
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [fetchNotifs]);

  const goHistory = () => { setOpenBell(null); router.push('/(franchise)/history-needed' as any); };
  const goResults = () => { setOpenBell(null); router.push('/(franchise)/results' as any); };

  return (
    <View style={{ flexDirection: 'row', marginRight: 12, gap: 4 }}>
      {/* History bell */}
      <TouchableOpacity style={styles.bell} onPress={() => { fetchNotifs(); setOpenBell('history'); }}>
        <Text style={styles.bellIcon}>🔔</Text>
        {history.length > 0 && <View style={[styles.badge, { backgroundColor: '#F59E0B' }]}><Text style={styles.badgeText}>{history.length}</Text></View>}
      </TouchableOpacity>

      {/* Rejected bell */}
      <TouchableOpacity style={styles.bell} onPress={() => { fetchNotifs(); setOpenBell('rejected'); }}>
        <Text style={styles.bellIcon}>🚫</Text>
        {rejected.length > 0 && <View style={[styles.badge, { backgroundColor: '#EF4444' }]}><Text style={styles.badgeText}>{rejected.length}</Text></View>}
      </TouchableOpacity>

      {/* Dropdown modal */}
      <Modal visible={openBell !== null} transparent animationType="fade" onRequestClose={() => setOpenBell(null)}>
        <TouchableOpacity style={styles.notifOverlay} activeOpacity={1} onPress={() => setOpenBell(null)}>
          <View style={styles.notifCard}>
            <Text style={styles.notifTitle}>
              {openBell === 'history'
                ? `🔔 History Needed (${history.length})`
                : `🚫 Rejected Samples (${rejected.length})`}
            </Text>
            <FlatList
              data={openBell === 'history' ? history : rejected}
              keyExtractor={(it, i) => (it.patient_id ?? it.barcode ?? i).toString()}
              style={{ maxHeight: 340 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.notifItem}
                  onPress={openBell === 'history' ? goHistory : goResults}>
                  <Text style={styles.notifName}>{item.patient_name}</Text>
                  <Text style={[styles.notifSub, { color: openBell === 'history' ? '#F59E0B' : '#EF4444' }]}>
                    {item.barcode} · {openBell === 'history' ? 'needs history' : 'sample rejected'}
                  </Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.notifEmpty}>Nothing here 🎉</Text>}
            />
            {(openBell === 'history' ? history.length : rejected.length) > 0 && (
              <TouchableOpacity style={styles.notifAction} onPress={openBell === 'history' ? goHistory : goResults}>
                <Text style={styles.notifActionText}>
                  {openBell === 'history' ? 'Go to History Needed →' : 'Go to Results →'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ── Menu button (plain text glyph so it always renders, even if the
// default drawer-toggle vector icon fails to load) ──
function MenuButton() {
  const navigation = useNavigation<any>();
  return (
    <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.openDrawer()} hitSlop={12}>
      <Text style={styles.menuBtnIcon}>☰</Text>
    </TouchableOpacity>
  );
}

function CustomDrawer({ navigation }: { navigation: any }) {
  const pathname = usePathname();
  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      <View style={[styles.drawerHeader, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
        <Image source={require('../../../assets/images/brand-logo.png')} style={styles.drawerLogoImg} contentFit="contain" />
        <View>
          <Text style={styles.drawerLogo}>Healthycian</Text>
          <Text style={styles.drawerRole}>Franchise Portal v1.0</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
        {FRANCHISE_MENUS.map(menu => {
          const isActive = pathname.endsWith(menu.name);
          return (
            <TouchableOpacity
              key={menu.name}
              style={[styles.menuItem, isActive && styles.menuItemActive]}
              onPress={() => { navigation.closeDrawer(); router.push(`/(franchise)/${menu.name}` as any); }}
            >
              <Text style={styles.menuIcon}>{menu.icon}</Text>
              <Text style={[styles.menuLabel, isActive && styles.menuLabelActive]}>{menu.title}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <TouchableOpacity style={styles.logoutBtn} onPress={() => router.replace('/')}>
        <Text style={styles.logoutText}>🚪  Logout</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function FranchiseLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Drawer
        drawerContent={(props) => <CustomDrawer {...props} />}
        screenOptions={{
          headerStyle:      { backgroundColor: '#F8FAFC' },
          headerTintColor:  '#0F172A',
          headerTitleStyle: { fontWeight: 'bold' },
          drawerStyle:      { backgroundColor: '#F8FAFC', width: 280 },
          headerLeft:       () => <MenuButton />,
          headerRight:      () => <NotificationBells />,
        }}
      >
        {FRANCHISE_MENUS.map(menu => (
          <Drawer.Screen key={menu.name} name={menu.name} options={{ title: menu.title }} />
        ))}
      </Drawer>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  drawerHeader:    { paddingTop: 56, paddingBottom: 18, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  drawerLogoImg:   { width: 34, height: 34 },
  drawerLogo:      { fontSize: 18, fontWeight: 'bold', color: '#0F172A' },
  drawerRole:      { fontSize: 12, color: '#10B981', marginTop: 2 },
  menuBtn:         { paddingHorizontal: 14, paddingVertical: 6 },
  menuBtnIcon:     { fontSize: 22, color: '#0F172A' },
  menuItem:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, marginHorizontal: 8 },
  menuItemActive:  { backgroundColor: '#FFFFFF' },
  menuIcon:        { fontSize: 18, marginRight: 12 },
  menuLabel:       { fontSize: 14, color: '#64748B' },
  menuLabelActive: { color: '#10B981', fontWeight: '600' },
  logoutBtn:       { margin: 12, padding: 14, borderRadius: 10, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0' },
  logoutText:      { color: '#EF4444', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  // Bells
  bell:            { padding: 6, position: 'relative' },
  bellIcon:        { fontSize: 20 },
  badge:           { position: 'absolute', top: 0, right: 0, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText:       { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  notifOverlay:    { flex: 1, backgroundColor: '#00000066', paddingTop: 90, paddingHorizontal: 12 },
  notifCard:       { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#E2E8F0' },
  notifTitle:      { color: '#0F172A', fontSize: 15, fontWeight: 'bold', marginBottom: 12 },
  notifItem:       { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  notifName:       { color: '#0F172A', fontSize: 14, fontWeight: '600' },
  notifSub:        { fontSize: 12, marginTop: 2 },
  notifEmpty:      { color: '#64748B', textAlign: 'center', paddingVertical: 20 },
  notifAction:     { marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: '#17B9A1', alignItems: 'center' },
  notifActionText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
