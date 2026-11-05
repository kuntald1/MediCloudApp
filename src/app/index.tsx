import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, KeyboardAvoidingView,
  Platform, ActivityIndicator,
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
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const pwRef = useRef<TextInput>(null);

  // Load any saved token into memory (so API calls work after Razorpay browser switch)
  // but ALWAYS show the login screen — no auto-navigation
  useEffect(() => {
    loadAuth();
  }, []);

  const handleLogin = async () => {
    if (loading) return;
    if (!email.trim() || !password.trim()) {
      setError('Please enter email and password');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? data.message ?? 'Invalid credentials');
        return;
      }
      await setAuth(data.access_token, data.user);
      router.replace(navFor(data.user?.role) as any);
    } catch (e: any) {
      setError('Could not connect to server. Check internet.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* The web login's corner waves, baked to an image — the app has no
          react-native-svg, and this keeps the two screens identical. */}
      <Image
        source={require('../../assets/images/login-bg.jpg')}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>

            <Image
              source={require('../../assets/images/healthycian-wordmark.png')}
              style={styles.logo}
              contentFit="contain"
            />

            <Text style={styles.welcome}>Welcome Back!</Text>
            <Text style={styles.welcomeSub}>Login to your account to continue</Text>

            <View style={styles.fieldWrap}>
              <Text style={styles.fieldIcon}>✉</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={t => { setEmail(t); setError(''); }}
                placeholder="Email"
                placeholderTextColor="#94A3B8"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="next"
                onSubmitEditing={() => pwRef.current?.focus()}
              />
            </View>

            <View style={styles.fieldWrap}>
              <Text style={styles.fieldIcon}>🔒</Text>
              <TextInput
                ref={pwRef}
                style={[styles.input, { paddingRight: 46 }]}
                value={password}
                onChangeText={t => { setPassword(t); setError(''); }}
                placeholder="Password"
                placeholderTextColor="#94A3B8"
                secureTextEntry={!showPw}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity
                style={styles.eye}
                onPress={() => setShowPw(v => !v)}
                hitSlop={10}
                accessibilityLabel={showPw ? 'Hide password' : 'Show password'}
              >
                <Text style={styles.eyeText}>{showPw ? '🙈' : '👁'}</Text>
              </TouchableOpacity>
            </View>

            {/* Inline, next to the fields — an Alert popup hides the form and
                has to be dismissed before the wrong value can be corrected. */}
            {!!error && (
              <View style={styles.errBox}>
                <Text style={styles.errText}>⚠  {error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.loginBtnWrap, loading && { opacity: 0.7 }]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.88}
            >
              <LinearGradient
                colors={['#34b97f', '#17b9a1', '#19a7c4']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.loginBtn}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.loginBtnText}>Sign In  →</Text>}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f6fbfc' },
  scroll:       { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 22, paddingVertical: 24 },

  card:         {
    width: '100%', maxWidth: 400, backgroundColor: '#ffffff', borderRadius: 20,
    paddingHorizontal: 24, paddingVertical: 30,
    borderWidth: 1, borderColor: '#eef3f7',
    shadowColor: '#0f172a', shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.10, shadowRadius: 30, elevation: 8,
  },

  logo:         { width: '100%', height: 52, alignSelf: 'center', marginBottom: 28 },
  welcome:      { fontSize: 23, fontWeight: '800', color: '#0F2744' },
  welcomeSub:   { fontSize: 13, color: '#64748B', marginBottom: 20 },

  fieldWrap:    { position: 'relative', marginBottom: 12 },
  fieldIcon:    { position: 'absolute', left: 15, top: 15, fontSize: 14, color: '#94A3B8', zIndex: 1 },
  input:        {
    backgroundColor: '#F7FAFC', color: '#0F172A', paddingLeft: 42, paddingRight: 16,
    paddingVertical: 14, borderRadius: 11, fontSize: 15, borderWidth: 1, borderColor: '#E4EBF2',
  },
  eye:          { position: 'absolute', right: 12, top: 12, padding: 4 },
  eyeText:      { fontSize: 16, color: '#94A3B8' },

  errBox:       {
    backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 9,
    paddingVertical: 9, paddingHorizontal: 12, marginBottom: 4,
  },
  errText:      { color: '#DC2626', fontSize: 12.5, fontWeight: '600' },

  loginBtnWrap: { marginTop: 16, borderRadius: 11, overflow: 'hidden' },
  loginBtn:     { paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  loginBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
