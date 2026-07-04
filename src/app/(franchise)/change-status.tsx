import { View, Text, StyleSheet } from 'react-native';

export default function Screen() {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🔄</Text>
      <Text style={styles.title}>Change Status</Text>
      <Text style={styles.sub}>Update sample/report status</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center', padding: 24 },
  icon:      { fontSize: 56 },
  title:     { fontSize: 22, fontWeight: 'bold', color: '#F1F5F9', marginTop: 16 },
  sub:       { fontSize: 14, color: '#64748B', marginTop: 8, textAlign: 'center' },
});
