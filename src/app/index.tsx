import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, KeyboardAvoidingView,
  Platform, Alert, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
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
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>🧪</Text>
          <Text style={styles.title}>MediCloud</Text>
          <Text style={styles.subtitle}>Laboratory Information System</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail}
            placeholder="admin@medicloud.local" placeholderTextColor="#475569"
            autoCapitalize="none" keyboardType="email-address" autoComplete="email" />

          <Text style={[styles.label, { marginTop: 16 }]}>Password</Text>
          <TextInput style={styles.input} value={password} onChangeText={setPassword}
            placeholder="Enter password" placeholderTextColor="#475569" secureTextEntry />

          <TouchableOpacity style={[styles.loginBtn, loading && { opacity: 0.7 }]}
            onPress={handleLogin} disabled={loading} activeOpacity={0.85}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginBtnText}>Login</Text>}
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>Vorpet © 2026</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0F172A' },
  center:       { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' },
  scroll:       { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header:       { alignItems: 'center', marginBottom: 40 },
  logo:         { fontSize: 60 },
  title:        { fontSize: 34, fontWeight: 'bold', color: '#F1F5F9', marginTop: 10 },
  subtitle:     { fontSize: 14, color: '#64748B', marginTop: 4 },
  form:         {},
  label:        { fontSize: 13, color: '#CBD5E1', marginBottom: 6 },
  input:        { backgroundColor: '#1E293B', color: '#F1F5F9', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 10, fontSize: 15, borderWidth: 1.5, borderColor: '#334155' },
  loginBtn:     { padding: 16, borderRadius: 12, backgroundColor: '#0EA5E9', alignItems: 'center', marginTop: 24 },
  loginBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  footer:       { textAlign: 'center', color: '#334155', marginTop: 32, fontSize: 12 },
});
