import { authHeader, API_BASE } from '../../../src/utils/auth';
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, FlatList } from 'react-native';

const STATUS_FLOW = [
  { key: 'collected',  label: '🧪 Collected',  color: '#3B82F6' },
  { key: 'received',   label: '📥 Received',   color: '#06B6D4' },
  { key: 'tested',     label: '🔬 Tested',     color: '#F97316' },
  { key: 'validated',  label: '✅ Validated',  color: '#A855F7' },
  { key: 'reported',   label: '📄 Reported',   color: '#10B981' },
];

const STATUS_COLOR: Record<string, string> = { pending: '#F59E0B', collected: '#3B82F6', received: '#06B6D4', tested: '#F97316', validated: '#A855F7', reported: '#10B981', sample_rejected: '#EF4444' };

export default function ChangeStatus() {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState<any[]>([]);
  const [selected, setSelected] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  const searchSamples = async () => {
    if (!query.trim()) return;
    setSearching(true); setResults([]); setSelected([]);
    try {
      const res  = await fetch(`${API_BASE}/api/sample-status/search?barcode=${encodeURIComponent(query.trim())}`, { headers: authHeader() });
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSearching(false); }
  };

  const toggleSelect = (id: number) =>
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const advance = async (status: string) => {
    if (selected.length === 0) { Alert.alert('Select at least one sample'); return; }
    setAdvancing(true);
    try {
      const res  = await fetch(`${API_BASE}/api/sample-status/advance`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_ids: selected, status }),
      });
      const data = await res.json();
      Alert.alert('✅ Done', `${data.updated} sample(s) → ${status}`);
      setResults(prev => prev.map(r => selected.includes(r.id) ? { ...r, status } : r));
      setSelected([]);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setAdvancing(false); }
  };

  const reject = () => Alert.alert('Reject Samples', `Reject ${selected.length} sample(s)?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Reject', style: 'destructive', onPress: () => advance('sample_rejected') },
  ]);

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput style={styles.searchInput} value={query} onChangeText={setQuery}
          placeholder="Search by barcode..." placeholderTextColor="#475569"
          onSubmitEditing={searchSamples} returnKeyType="search" />
        <TouchableOpacity style={styles.searchBtn} onPress={searchSamples}>
          <Text style={styles.searchBtnText}>Search</Text>
        </TouchableOpacity>
      </View>

      {/* Advance buttons */}
      {selected.length > 0 && (
        <View style={styles.advanceBar}>
          <Text style={styles.selectedCount}>{selected.length} selected · advance to:</Text>
          <View style={styles.advanceBtns}>
            {STATUS_FLOW.map(s => (
              <TouchableOpacity key={s.key} style={[styles.advBtn, { borderColor: s.color }]}
                onPress={() => advance(s.key)} disabled={advancing}>
                <Text style={[styles.advBtnText, { color: s.color }]}>{s.label.split(' ')[1]}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.advBtn, { borderColor: '#EF4444' }]} onPress={reject} disabled={advancing}>
              <Text style={[styles.advBtnText, { color: '#EF4444' }]}>Reject</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Results */}
      {searching ? <ActivityIndicator color="#0EA5E9" style={{ marginTop: 48 }} /> : (
        <FlatList data={results} keyExtractor={r => r.id.toString()}
          contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
          renderItem={({ item: r }) => {
            const isSel = selected.includes(r.id);
            const color = STATUS_COLOR[r.status] ?? '#64748B';
            return (
              <TouchableOpacity style={[styles.card, isSel && styles.cardSelected]} onPress={() => toggleSelect(r.id)}>
                <View style={styles.cardRow}>
                  <View style={styles.checkbox}>
                    {isSel && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.patName}>{r.patient_name}</Text>
                    <Text style={styles.barcode}>{r.barcode}</Text>
                  </View>
                  <View style={[styles.badge, { borderColor: color }]}>
                    <Text style={[styles.badgeText, { color }]}>{r.status}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyText}>Search a barcode to begin</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0F172A' },
  searchRow:       { flexDirection: 'row', padding: 12, gap: 8 },
  searchInput:     { flex: 1, backgroundColor: '#1E293B', color: '#F1F5F9', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#334155' },
  searchBtn:       { backgroundColor: '#0EA5E9', paddingHorizontal: 16, borderRadius: 10, justifyContent: 'center' },
  searchBtnText:   { color: '#fff', fontWeight: '700' },
  advanceBar:      { backgroundColor: '#1E293B', padding: 12, borderBottomWidth: 1, borderBottomColor: '#334155' },
  selectedCount:   { color: '#94A3B8', fontSize: 12, marginBottom: 8 },
  advanceBtns:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  advBtn:          { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  advBtnText:      { fontSize: 11, fontWeight: '700' },
  card:            { backgroundColor: '#1E293B', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#334155' },
  cardSelected:    { borderColor: '#0EA5E9', backgroundColor: '#0EA5E915' },
  cardRow:         { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox:        { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#334155', alignItems: 'center', justifyContent: 'center' },
  checkmark:       { color: '#0EA5E9', fontWeight: 'bold' },
  patName:         { color: '#F1F5F9', fontSize: 14, fontWeight: '600' },
  barcode:         { color: '#64748B', fontSize: 11 },
  badge:           { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  badgeText:       { fontSize: 10, fontWeight: '700' },
  empty:           { alignItems: 'center', marginTop: 60 },
  emptyIcon:       { fontSize: 48 },
  emptyText:       { color: '#475569', fontSize: 16, marginTop: 12 },
});
