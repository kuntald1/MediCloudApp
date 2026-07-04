import { authHeader, API_BASE, getToken } from '../../../src/utils/auth';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, Alert } from 'react-native';

interface Param  { name: string; value: number | string; unit?: string; ref_min?: number; ref_max?: number; flag?: string; }
interface Result {
  id: number; barcode: string; patient_name: string;
  test_name?: string; status: string; lifecycle_status?: string;
  created_at: string; device_name?: string;
  parsed_data?: { parameters?: Param[]; protocol?: string };
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#F59E0B', collected: '#3B82F6', tested: '#F97316',
  validated: '#A855F7', reported: '#10B981', completed: '#10B981',
  sample_rejected: '#EF4444', rejected: '#EF4444',
};

export default function Results() {
  const [results, setResults]       = useState<Result[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch]         = useState('');
  const [pdfLoading, setPdfLoading] = useState<number | null>(null);

  const fetchResults = useCallback(async () => {
    try {
      const url = search.trim()
        ? `${API_BASE}/api/results/?barcode=${encodeURIComponent(search.trim())}`
        : `${API_BASE}/api/results/`;
      const res  = await fetch(url, { headers: authHeader() });
      const data = await res.json();
      setResults(Array.isArray(data) ? data : data.items ?? []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { setLoading(true); fetchResults(); }, [fetchResults]);
  const onRefresh = async () => { setRefreshing(true); await fetchResults(); setRefreshing(false); };

  // Download PDF with auth token → share sheet
  const viewPDF = async (r: Result) => {
    if (!r.id) { Alert.alert('Error', 'No report id'); return; }
    setPdfLoading(r.id);
    try {
      const tok = getToken();
      const fileUri = FileSystem.cacheDirectory + `Report_${r.barcode}_${r.id}.pdf`;
      const dl = await FileSystem.downloadAsync(
        `${API_BASE}/api/results/${r.id}/pdf`, fileUri,
        { headers: { Authorization: `Bearer ${tok}` } }
      );
      if (dl.status !== 200) { Alert.alert('Error', 'Report not accessible'); return; }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dl.uri, { mimeType: 'application/pdf', dialogTitle: `Report ${r.barcode}` });
      } else { Alert.alert('Saved', dl.uri); }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally { setPdfLoading(null); }
  };

  const renderItem = ({ item: r }: { item: Result }) => {
    const life  = r.lifecycle_status ?? r.status;
    const color = STATUS_COLOR[life] ?? '#64748B';
    const params = r.parsed_data?.parameters ?? [];
    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <Text style={styles.barcode}>📋 {r.barcode}</Text>
          <View style={[styles.badge, { borderColor: color }]}>
            <Text style={[styles.badgeText, { color }]}>● {life}</Text>
          </View>
        </View>
        <Text style={styles.name}>{r.patient_name}</Text>
        {r.test_name && <Text style={styles.testName}>🧪 {r.test_name}</Text>}

        {/* Parameters */}
        {params.length > 0 && (
          <View style={styles.paramBox}>
            {params.map((p, i) => {
              const flag = p.flag === 'H' || p.flag === 'L';
              return (
                <View key={i} style={styles.paramRow}>
                  <Text style={styles.paramName}>{p.name}</Text>
                  <Text style={[styles.paramValue, flag && { color: '#EF4444', fontWeight: '700' }]}>
                    {p.value}{p.unit ? ` ${p.unit}` : ''}
                    {p.flag ? ` ${p.flag === 'H' ? '↑' : p.flag === 'L' ? '↓' : ''}` : ''}
                  </Text>
                  {(p.ref_min != null || p.ref_max != null) && (
                    <Text style={styles.paramRef}>{p.ref_min}–{p.ref_max}</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        <Text style={styles.date}>🕐 {new Date(r.created_at).toLocaleString('en-IN')}{r.device_name ? ` · ${r.device_name}` : ''}</Text>
        <TouchableOpacity style={styles.pdfBtn} onPress={() => viewPDF(r)} disabled={pdfLoading === r.id}>
          <Text style={styles.pdfBtnText}>{pdfLoading === r.id ? 'Loading...' : '📄 View / Share PDF'}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <TextInput style={styles.search} value={search} onChangeText={setSearch}
          placeholder="🔍  Search by barcode..." placeholderTextColor="#475569"
          onSubmitEditing={fetchResults} returnKeyType="search" />
      </View>
      {loading ? <ActivityIndicator color="#0EA5E9" size="large" style={{ marginTop: 48 }} /> : (
        <FlatList data={results} keyExtractor={(r, i) => (r.id ?? i).toString()} renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0EA5E9" />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>📋</Text><Text style={styles.emptyText}>No results found</Text></View>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#0F172A' },
  searchWrap: { padding: 12 },
  search:     { backgroundColor: '#1E293B', color: '#F1F5F9', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#334155' },
  card:       { backgroundColor: '#1E293B', marginHorizontal: 12, marginBottom: 10, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#334155' },
  cardRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  barcode:    { color: '#64748B', fontSize: 12 },
  badge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  badgeText:  { fontSize: 11, fontWeight: '700' },
  name:       { color: '#F1F5F9', fontSize: 16, fontWeight: 'bold', marginBottom: 2 },
  testName:   { color: '#60A5FA', fontSize: 13, marginBottom: 8 },
  paramBox:   { backgroundColor: '#0F172A', borderRadius: 8, padding: 10, marginBottom: 8 },
  paramRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  paramName:  { flex: 1, color: '#94A3B8', fontSize: 12 },
  paramValue: { color: '#F1F5F9', fontSize: 13, fontWeight: '600', marginRight: 8 },
  paramRef:   { color: '#475569', fontSize: 10, width: 60, textAlign: 'right' },
  date:       { color: '#475569', fontSize: 11, marginBottom: 10 },
  pdfBtn:     { backgroundColor: '#1E40AF', padding: 10, borderRadius: 8, alignSelf: 'flex-start' },
  pdfBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  empty:      { alignItems: 'center', marginTop: 60 },
  emptyIcon:  { fontSize: 48 },
  emptyText:  { color: '#475569', fontSize: 16, marginTop: 12 },
});
