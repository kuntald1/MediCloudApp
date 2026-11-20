/**
 * Department filter chips + helpers for the bill list.
 * Every test belongs to a department (test catalog); the API takes `department_id`.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { API_BASE, authHeader } from '../utils/auth';

export type Dept = { id: number; name: string };

/** Today as YYYY-MM-DD in the device's local time — the default From / To of every list. */
export function todayStr() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function useDepartments() {
  const [depts, setDepts] = useState<Dept[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/catalog/departments`, { headers: authHeader() })
      .then(r => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((d: any) => { if (alive) setDepts(Array.isArray(d) ? d : []); });
    return () => { alive = false; };
  }, []);
  return depts;
}

export default function DepartmentFilter(
  { value, onChange, depts, label = 'Department' }:
  { value: string; onChange: (v: string) => void; depts: Dept[]; label?: string },
) {
  if (!depts.length) return null;
  const all: { id: string; name: string }[] = [{ id: '', name: 'All' }, ...depts.map(d => ({ id: String(d.id), name: d.name }))];
  return (
    <View style={s.wrap}>
      <Text style={s.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 12 }}>
        {all.map(d => {
          const on = value === d.id;
          return (
            <TouchableOpacity key={d.id || 'all'} style={[s.chip, on && s.chipOn]} onPress={() => onChange(d.id)}>
              <Text style={[s.chipText, on && { color: '#fff' }]}>{d.name}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── per-test status shown on the bill list (a test group counts once, under the group's name)
export const BILL_TEST_STATUS_LABEL: Record<string, string> = {
  collected: 'Collected', dispatched: 'Dispatched', received: 'Received', tested: 'Tested',
  validated: 'Validated', reported: 'Reported', sample_rejected: 'Rejected',
};
export const BILL_TEST_STATUS_COLOR: Record<string, string> = {
  collected: '#64748B', dispatched: '#0EA5E9', received: '#2563EB', tested: '#F59E0B',
  validated: '#16A34A', reported: '#7C3AED', sample_rejected: '#DC2626',
};
export function billTests(items?: any[]) {
  const out: { key: string; name: string; status: string; department: string }[] = [];
  const seen = new Set<string>();
  (items || []).forEach((i: any) => {
    const key = i.package_id ? `p${i.package_id}` : `i${i.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, name: i.package_id ? (i.package_name || i.test_name) : i.test_name, status: i.status || 'collected', department: i.department_name || '' });
  });
  return out;
}

const s = StyleSheet.create({
  wrap:   { flex: 1 },
  label:  { color: '#64748B', fontSize: 11, fontWeight: '700', marginBottom: 4 },
  chip:   { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' },
  chipOn: { backgroundColor: '#0E7490', borderColor: '#0E7490' },
  chipText: { color: '#64748B', fontSize: 11, fontWeight: '600' },
});
