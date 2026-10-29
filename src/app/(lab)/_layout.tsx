import { Drawer } from 'expo-router/drawer';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, FlatList } from 'react-native';
import { router, usePathname, useNavigation } from 'expo-router';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Image } from 'expo-image';
import { authHeader, API_BASE } from '../../../src/utils/auth';

const LAB_MENUS = [
  { name: 'dashboard',         title: 'Dashboard',           icon: '📊' },
  { name: 'patients',          title: 'Patients',            icon: '👥' },
  { name: 'change-status',     title: 'Change Status',       icon: '🔄' },
  { name: 'results',           title: 'Results',             icon: '📋' },
  { name: 'tat-report',        title: 'TAT Report',          icon: '⏱️' },
  { name: 'sample-tubes',      title: 'Sample Tubes',        icon: '🧪' },
  { name: 'org-groups',        title: 'Org Groups',          icon: '🏢' },
  { name: 'organizations',     title: 'Organizations',       icon: '🏛️' },
  { name: 'branches',          title: 'Branches',            icon: '🌿' },
  { name: 'pricing',           title: 'Group / Org Pricing', icon: '💰' },
  { name: 'tests-catalog',     title: 'Tests Catalog',       icon: '📚' },
  { name: 'departments',       title: 'Departments',         icon: '🏬' },
  { name: 'users-staff',       title: 'Users & Staff',       icon: '👤' },
  { name: 'report-settings',   title: 'Report Settings',     icon: '📝' },
  { name: 'new-bill',          title: 'New Bill',            icon: '🧾' },
  { name: 'bills',             title: 'Bills',               icon: '💳' },
  { name: 'doctor-commission', title: 'Doctor Commission',   icon: '💊' },
  { name: 'history-needed',    title: 'History Needed',      icon: '📜' },
  { name: 'sample-report',     title: 'Sample Report',       icon: '📄' },
];

// Menu Permissions (web) stores hidden items under the WEB sidebar's keys, so the
// same setting drives both apps. Anything not listed here has no web counterpart
// and is always shown.
const MENU_KEY: Record<string, string> = {
  dashboard: 'dashboard', patients: 'patients', 'change-status': 'status',
  results: 'results', 'tat-report': 'tat', 'sample-tubes': 'tubes',
  'org-groups': 'orggroups', organizations: 'organizations', branches: 'branches',
  pricing: 'pricing', 'tests-catalog': 'testscatalog', departments: 'departments',
  'users-staff': 'users', 'report-settings': 'reportsettings', 'new-bill': 'billing',
  bills: 'bills', 'doctor-commission': 'doctors', 'history-needed': 'historyneeded',
  'sample-report': 'samplereport',
};

// Which menus this login may see. Lab admin / super admin always get everything
// (the server returns an empty list for them). Returns null until it has loaded,
// so nothing is shown or redirected on a guess.
function useVisibleMenus() {
  const [hidden, setHidden] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/admin/my-menu-hidden`, { headers: authHeader() })
      .then(r => r.ok ? r.json() : { hidden_keys: [] })
      .then(d => { if (alive) setHidden(Array.isArray(d?.hidden_keys) ? d.hidden_keys : []); })
      .catch(() => { if (alive) setHidden([]); });
    return () => { alive = false; };
  }, []);
  if (hidden === null) return null;
  return LAB_MENUS.filter(m => !hidden.includes(MENU_KEY[m.name] ?? m.name));
}

// ── Notification Bells (shared across all lab screens) ──
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

  const goHistory = () => { setOpenBell(null); router.push('/(lab)/history-needed' as any); };
  const goResults = () => { setOpenBell(null); router.push('/(lab)/results' as any); };

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

function CustomDrawer({ navigation, menus }: { navigation: any; menus: typeof LAB_MENUS | null }) {
  const pathname = usePathname();
  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      <View style={[styles.drawerHeader, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
        <Image source={require('../../../assets/images/brand-logo.png')} style={styles.drawerLogoImg} contentFit="contain" />
        <View>
          <Text style={styles.drawerLogo}>Healthycian</Text>
          <Text style={styles.drawerRole}>Lab Portal v1.0</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
        {(menus ?? []).map(menu => {
          const isActive = pathname.endsWith(menu.name);
          return (
            <TouchableOpacity key={menu.name}
              style={[styles.menuItem, isActive && styles.menuItemActive]}
              onPress={() => { navigation.closeDrawer(); router.push(`/(lab)/${menu.name}` as any); }}>
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

export default function LabLayout() {
  const pathname = usePathname();
  const menus = useVisibleMenus();

  // The login screen always lands on /(lab)/dashboard, but most non-admin roles
  // have Dashboard hidden — move them on to the first screen they can open.
  useEffect(() => {
    if (!menus) return;
    const current = LAB_MENUS.find(m => pathname.endsWith(m.name));
    if (current && !menus.some(m => m.name === current.name) && menus.length > 0) {
      router.replace(`/(lab)/${menus[0].name}` as any);
    }
  }, [menus, pathname]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Drawer
        drawerContent={(props) => <CustomDrawer {...props} menus={menus} />}
        screenOptions={{
          headerStyle:      { backgroundColor: '#F8FAFC' },
          headerTintColor:  '#0F172A',
          headerTitleStyle: { fontWeight: 'bold' },
          drawerStyle:      { backgroundColor: '#F8FAFC', width: 280 },
          headerLeft:       () => <MenuButton />,
          headerRight:      () => <NotificationBells />,
        }}
      >
        {LAB_MENUS.map(menu => (
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
  drawerRole:      { fontSize: 12, color: '#17B9A1', marginTop: 2 },
  menuBtn:         { paddingHorizontal: 14, paddingVertical: 6 },
  menuBtnIcon:     { fontSize: 22, color: '#0F172A' },
  menuItem:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, marginHorizontal: 8 },
  menuItemActive:  { backgroundColor: '#FFFFFF' },
  menuIcon:        { fontSize: 18, marginRight: 12 },
  menuLabel:       { fontSize: 14, color: '#64748B' },
  menuLabelActive: { color: '#17B9A1', fontWeight: '600' },
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
