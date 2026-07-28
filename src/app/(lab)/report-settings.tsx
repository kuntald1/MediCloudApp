import { authHeader, API_BASE, getToken } from '../../../src/utils/auth';
import { uploadPickedFile } from '../../../src/utils/uploadPickedFile';
import * as ImagePicker from 'expo-image-picker';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  TextInput, Alert, Image, RefreshControl,
} from 'react-native';

// Mirrors the web Report Settings page (Master → Report Settings):
// Letterhead (lab identity block), Report Layout (continuous/page_break),
// Lab Logo. Pathologist signature/qualification live on each doctor's own
// Referral Doctor profile (Doctor Commission page), NOT here — matches the
// note on the web page.
//
// Endpoint (assumed, matching the earlier admin/report-settings pattern —
// confirm against the web app's Network tab): GET/PUT /api/admin/report-settings,
// logo via POST/DELETE /api/admin/report-settings/upload/logo.

interface ReportSettings {
  lab_name?: string | null;
  tagline?: string | null;
  unit_of?: string | null;
  address_lines?: string[] | null;
  phones?: string[] | null;
  email?: string | null;
  website?: string | null;
  layout?: 'continuous' | 'page_break';
  logo_url?: string | null;
}

export default function ReportSettingsScreen() {
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const [labName, setLabName]       = useState('');
  const [tagline, setTagline]       = useState('');
  const [unitOf, setUnitOf]         = useState('');
  const [address, setAddress]       = useState('');
  const [phones, setPhones]         = useState('');
  const [email, setEmail]           = useState('');
  const [website, setWebsite]       = useState('');
  const [layoutMode, setLayoutMode] = useState<'continuous' | 'page_break'>('continuous');
  const [logoUri, setLogoUri]       = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/report-settings`, { headers: authHeader() });
      if (res.ok) {
        const data: ReportSettings = await res.json();
        setLabName(data.lab_name ?? '');
        setTagline(data.tagline ?? '');
        setUnitOf(data.unit_of ?? '');
        setAddress((data.address_lines ?? []).join('\n'));
        setPhones((data.phones ?? []).join(', '));
        setEmail(data.email ?? '');
        setWebsite(data.website ?? '');
        setLayoutMode(data.layout === 'page_break' ? 'page_break' : 'continuous');
        setLogoUri(data.logo_url ? (data.logo_url.startsWith('http') ? data.logo_url : `${API_BASE}${data.logo_url}`) : null);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);
  const onRefresh = async () => { setRefreshing(true); await fetchSettings(); setRefreshing(false); };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/report-settings`, {
        method: 'PUT', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lab_name: labName.trim(),
          tagline: tagline.trim(),
          unit_of: unitOf.trim(),
          address_lines: address.split('\n').map(l => l.trim()).filter(Boolean),
          phones: phones.split(',').map(p => p.trim()).filter(Boolean),
          email: email.trim(),
          website: website.trim(),
          layout: layoutMode,
        }),
      });
      if (res.ok) { Alert.alert('✅ Saved', 'Report settings updated'); }
      else { Alert.alert('Error', 'Could not save report settings'); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  const pickLogo = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo library access to pick a logo image.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setUploadingLogo(true);
    try {
      const tok = getToken();
      const up = await uploadPickedFile(
        `${API_BASE}/api/admin/report-settings/upload/logo`,
        asset.uri, asset.fileName || 'logo.png', asset.mimeType || 'image/png', tok,
      );
      if (up.ok) { setLogoUri(asset.uri); fetchSettings(); }
      else { Alert.alert('Error', 'Logo upload failed'); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setUploadingLogo(false); }
  };

  const removeLogo = () => {
    Alert.alert('Remove Logo', 'Remove and use the default logo?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try {
          const res = await fetch(`${API_BASE}/api/admin/report-settings/upload/logo`, { method: 'DELETE', headers: authHeader() });
          if (res.ok) { setLogoUri(null); fetchSettings(); }
          else { Alert.alert('Error', 'Could not remove logo'); }
        } catch (e: any) { Alert.alert('Error', e.message); }
      }},
    ]);
  };

  if (loading) return <ActivityIndicator color="#8B5CF6" size="large" style={{ marginTop: 48 }} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}>

      <Text style={styles.pageHint}>
        Letterhead and layout for the official sample report PDF. Each doctor's own signature is set on their profile under Doctor Commission → Referral Doctors.
      </Text>

      {/* ── Letterhead ── */}
      <Text style={styles.sectionTitle}>Letterhead</Text>

      <Text style={styles.fieldLabel}>Lab Name</Text>
      <TextInput style={styles.input} value={labName} onChangeText={setLabName} placeholder="HEALTHYCIAN" placeholderTextColor="#94A3B8" autoCapitalize="characters" />

      <Text style={styles.fieldLabel}>Tagline</Text>
      <TextInput style={styles.input} value={tagline} onChangeText={setTagline} placeholder="Improving Lives With a Smile" placeholderTextColor="#94A3B8" />

      <Text style={styles.fieldLabel}>Unit Of <Text style={styles.fieldSub}>(business/subsidiary name shown in the footer)</Text></Text>
      <TextInput style={styles.input} value={unitOf} onChangeText={setUnitOf} placeholder="e.g. Healthnode Bioscience Pvt. Ltd." placeholderTextColor="#94A3B8" />

      <Text style={styles.fieldLabel}>Address <Text style={styles.fieldSub}>(one line per row)</Text></Text>
      <TextInput style={styles.textArea} value={address} onChangeText={setAddress} multiline
        placeholder={'20/1/5 Bhagaban Chatterjee Lane,\nKadamtala, Howrah - 711101.'} placeholderTextColor="#94A3B8" />

      <Text style={styles.fieldLabel}>Phones <Text style={styles.fieldSub}>(comma-separated)</Text></Text>
      <TextInput style={styles.input} value={phones} onChangeText={setPhones} placeholder="9088801015, 9088801016" placeholderTextColor="#94A3B8" keyboardType="phone-pad" />

      <Text style={styles.fieldLabel}>Email</Text>
      <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="corporatepartner@example.com" placeholderTextColor="#94A3B8" keyboardType="email-address" autoCapitalize="none" />

      <Text style={styles.fieldLabel}>Website</Text>
      <TextInput style={styles.input} value={website} onChangeText={setWebsite} placeholder="www.example.com" placeholderTextColor="#94A3B8" autoCapitalize="none" />

      {/* ── Report Layout ── */}
      <Text style={styles.sectionTitle}>Report Layout</Text>
      <Text style={styles.hint}>How multiple test panels flow in one combined report.</Text>

      <TouchableOpacity style={[styles.layoutCard, layoutMode === 'continuous' && styles.layoutCardActive]} onPress={() => setLayoutMode('continuous')}>
        <View style={styles.layoutRadioRow}>
          <View style={[styles.radioDot, layoutMode === 'continuous' && styles.radioDotActive]} />
          <Text style={[styles.layoutCardTitle, layoutMode === 'continuous' && styles.layoutCardTitleActive]}>Continuous</Text>
        </View>
        <Text style={styles.layoutCardDesc}>All panels flow one after another on shared pages.</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.layoutCard, layoutMode === 'page_break' && styles.layoutCardActive]} onPress={() => setLayoutMode('page_break')}>
        <View style={styles.layoutRadioRow}>
          <View style={[styles.radioDot, layoutMode === 'page_break' && styles.radioDotActive]} />
          <Text style={[styles.layoutCardTitle, layoutMode === 'page_break' && styles.layoutCardTitleActive]}>Page Break</Text>
        </View>
        <Text style={styles.layoutCardDesc}>Each test panel starts on its own page.</Text>
      </TouchableOpacity>

      {/* ── Lab Logo ── */}
      <Text style={styles.sectionTitle}>Lab Logo</Text>
      <Text style={styles.hint}>Shown top-left of every report and as a faint watermark behind the body. PNG or JPG.</Text>
      {logoUri ? (
        <View style={styles.logoBox}>
          <Image source={{ uri: logoUri }} style={styles.logoImg} resizeMode="contain" />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <TouchableOpacity style={styles.smallBtnBlue} onPress={pickLogo} disabled={uploadingLogo}>
              <Text style={styles.smallBtnBlueText}>{uploadingLogo ? 'Uploading...' : 'Change'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallBtnRed} onPress={removeLogo} disabled={uploadingLogo}>
              <Text style={styles.smallBtnRedText}>Remove & use default</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.pickBtn} onPress={pickLogo} disabled={uploadingLogo}>
          {uploadingLogo ? <ActivityIndicator color="#8B5CF6" /> : <Text style={styles.pickBtnText}>🖼️ Click to upload logo</Text>}
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
        <Text style={styles.saveText}>{saving ? 'Saving...' : 'Save Report Settings'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#F8FAFC' },
  pageHint:       { color: '#64748B', fontSize: 12, lineHeight: 17, marginBottom: 8 },
  sectionTitle:   { color: '#0F172A', fontSize: 15, fontWeight: 'bold', marginTop: 20, marginBottom: 8 },
  hint:           { color: '#64748B', fontSize: 12, marginBottom: 10, lineHeight: 17 },
  fieldLabel:     { color: '#94A3B8', fontSize: 11, fontWeight: '700', letterSpacing: 0.3, marginBottom: 6, marginTop: 10, textTransform: 'uppercase' },
  fieldSub:       { textTransform: 'none', fontWeight: '400', color: '#94A3B8' },
  input:          { backgroundColor: '#FFFFFF', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  textArea:       { backgroundColor: '#FFFFFF', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#E2E8F0', minHeight: 70, textAlignVertical: 'top' },
  layoutCard:     { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 10, padding: 14, marginBottom: 10 },
  layoutCardActive:{ borderColor: '#17B9A1', backgroundColor: '#17B9A10D' },
  layoutRadioRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  radioDot:       { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#CBD5E1' },
  radioDotActive: { borderColor: '#17B9A1', backgroundColor: '#17B9A1' },
  layoutCardTitle:{ color: '#0F172A', fontSize: 14, fontWeight: '700' },
  layoutCardTitleActive: { color: '#0F766E' },
  layoutCardDesc: { color: '#64748B', fontSize: 12, marginLeft: 22 },
  pickBtn:        { backgroundColor: '#8B5CF622', borderWidth: 1, borderColor: '#8B5CF644', borderStyle: 'dashed', borderRadius: 10, padding: 20, alignItems: 'center' },
  pickBtnText:    { color: '#8B5CF6', fontWeight: '600', fontSize: 13 },
  logoBox:        { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 14, alignItems: 'center' },
  logoImg:        { width: '100%', height: 100 },
  smallBtnBlue:   { flex: 1, backgroundColor: '#3B82F622', padding: 10, borderRadius: 8, alignItems: 'center' },
  smallBtnBlueText: { color: '#3B82F6', fontWeight: '600', fontSize: 12 },
  smallBtnRed:    { flex: 1.4, backgroundColor: '#EF444422', padding: 10, borderRadius: 8, alignItems: 'center' },
  smallBtnRedText:{ color: '#EF4444', fontWeight: '600', fontSize: 12 },
  saveBtn:        { marginTop: 28, backgroundColor: '#F97316', padding: 15, borderRadius: 10, alignItems: 'center' },
  saveText:       { color: '#fff', fontWeight: '700', fontSize: 15 },
});
