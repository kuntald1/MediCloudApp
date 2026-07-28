import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, KeyboardAvoidingView,
  Platform, Alert, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { setAuth, loadAuth, getUser, API_BASE } from '../utils/auth';

const ROLE_NAV: Record<string, string> = {
  lab_admin:   '/(lab)/dashboard',
  lab_staff:   '/(lab)/dashboard',
  pathologist: '/(doctor)/validate',
  franchise:   '/(franchise)/dashboard',
  doctor:      '/(doctor)/validate',
};

function navFor(role?: string) {
  return ROLE_NAV[role ?? 'lab_admin'] ?? '/(lab)/dashboard';
}

export default function LoginScreen() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  // Load any saved token into memory (so API calls work after Razorpay browser switch)
  // but ALWAYS show the login screen — no auto-navigation
  useEffect(() => {
    loadAuth();
  }, []);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        Alert.alert('Login Failed', data.detail ?? data.message ?? 'Invalid credentials');
        return;
      }
      await setAuth(data.access_token, data.user);
      router.replace(navFor(data.user?.role) as any);
    } catch (e: any) {
      Alert.alert('Error', 'Could not connect to server. Check internet.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={['#1a1f2e', '#0b6e5d', '#17b9a1']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.header}>
              <View style={styles.logoBadge}>
                <Image source={require('../../assets/images/brand-logo.png')} style={styles.logoImg} contentFit="contain" />
              </View>
              <View>
                <Text style={styles.title}>Healthycian</Text>
                <Text style={styles.subtitle}>Laboratory Information System</Text>
              </View>
            </View>

            <View style={styles.form}>
              <Text style={styles.label}>EMAIL</Text>
              <TextInput style={styles.input} value={email} onChangeText={setEmail}
                placeholder="admin@healthycian.local" placeholderTextColor="#94A3B8"
                autoCapitalize="none" keyboardType="email-address" autoComplete="email" />

              <Text style={[styles.label, { marginTop: 18 }]}>PASSWORD</Text>
              <TextInput style={styles.input} value={password} onChangeText={setPassword}
                placeholder="Enter password" placeholderTextColor="#94A3B8" secureTextEntry />

              <TouchableOpacity style={[styles.loginBtnWrap, loading && { opacity: 0.7 }]}
                onPress={handleLogin} disabled={loading} activeOpacity={0.88}>
                <LinearGradient
                  colors={['#f58519', '#f7a325']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.loginBtn}
                >
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginBtnText}>Sign In</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.footer}>Healthycian © 2026</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1 },
  scroll:       { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  card:         {
    width: '100%', maxWidth: 400, backgroundColor: '#ffffff', borderRadius: 24,
    padding: 28, shadowColor: '#000', shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18, shadowRadius: 24, elevation: 10,
  },
  header:       { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 28 },
  logoBadge:    {
    width: 56, height: 56, borderRadius: 14, backgroundColor: '#F0FDFA',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  logoImg:      { width: 44, height: 44 },
  title:        { fontSize: 24, fontWeight: '800', color: '#0F172A' },
  subtitle:     { fontSize: 12.5, color: '#64748B', marginTop: 2 },
  form:         {},
  label:        { fontSize: 11, fontWeight: '700', color: '#64748B', letterSpacing: 0.6, marginBottom: 8 },
  input:        {
    backgroundColor: '#F8FAFC', color: '#0F172A', paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: 12, fontSize: 15, borderWidth: 1.5, borderColor: '#E2E8F0',
  },
  loginBtnWrap: { marginTop: 26, borderRadius: 14, overflow: 'hidden' },
  loginBtn:     { paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  loginBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  footer:       { textAlign: 'center', color: 'rgba(255,255,255,0.75)', marginTop: 24, fontSize: 12 },
});
