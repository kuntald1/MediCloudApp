import { authHeader, API_BASE } from '../../../src/utils/auth';
import { WebView } from 'react-native-webview';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Modal, Alert,
} from 'react-native';

interface LedgerEntry { id: number; type: 'bill' | 'payment' | string; amount: number; balance_after: number; ref: string; created_at: string; }
interface Ledger {
  organization: { id: number; name: string; credit_limit: number; phone?: string };
  outstanding: number;
  entries: LedgerEntry[];
}

const inr = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// Builds the Razorpay Checkout.js page loaded inside the WebView.
// The result is bridged back to React Native via window.ReactNativeWebView.postMessage.
function buildCheckoutHtml(order: { key_id: string; order_id: string; amount: number; currency: string; name: string; description: string }) {
  return `
<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F8FAFC;">
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
  var options = {
    key: "${order.key_id}",
    amount: "${order.amount}",
    currency: "${order.currency}",
    name: "${order.name}",
    description: "${order.description}",
    order_id: "${order.order_id}",
    handler: function (response) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ status: 'success', response: response }));
    },
    modal: {
      ondismiss: function () {
        window.ReactNativeWebView.postMessage(JSON.stringify({ status: 'dismissed' }));
      }
    },
    theme: { color: "#F97316" }
  };
  var rzp = new Razorpay(options);
  rzp.on('payment.failed', function (response) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ status: 'failed', error: response.error }));
  });
  document.addEventListener('DOMContentLoaded', function () { rzp.open(); });
  window.onload = function () { rzp.open(); };
</script>
</body>
</html>`;
}

export default function ManageCredit() {
  const [ledger, setLedger]         = useState<Ledger | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [checkoutHtml, setCheckoutHtml]   = useState<string | null>(null);
  const [verifying, setVerifying]   = useState(false);

  const fetchLedger = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/b2b/my-ledger`, { headers: authHeader() });
      const data = await res.json();
      setLedger(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchLedger(); }, [fetchLedger]);

  const onRefresh = () => { setRefreshing(true); fetchLedger(); };

  const startPayment = async () => {
    if (!ledger || ledger.outstanding <= 0) return;
    setCreatingOrder(true);
    try {
      const res  = await fetch(`${API_BASE}/api/b2b/pay/razorpay/order`, { method: 'POST', headers: authHeader() });
      const data = await res.json();
      if (!res.ok || !data.order_id) { Alert.alert('Error', data.detail ?? 'Could not start payment'); return; }
      setCheckoutHtml(buildCheckoutHtml(data));
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setCreatingOrder(false); }
  };

  // Verify the payment server-side with the id/signature Razorpay's checkout
  // handler gives us, then refresh the ledger so the new payment entry and
  // updated outstanding actually show up.
  const verifyAndRefresh = async (rzpResponse: any) => {
    setVerifying(true);
    try {
      const res  = await fetch(`${API_BASE}/api/b2b/pay/razorpay/verify`, {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id:   rzpResponse.razorpay_order_id,
          razorpay_payment_id: rzpResponse.razorpay_payment_id,
          razorpay_signature:  rzpResponse.razorpay_signature,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        await fetchLedger(); // pulls in the new payment row + fresh balances
        Alert.alert(
          '✅ Payment successful',
          `Paid ${inr(data.paid)}.${!data.locked ? ' Your reports are now unlocked.' : ''}`
        );
      } else {
        Alert.alert('Verification failed', data.detail ?? 'Payment could not be confirmed. Please contact support if the amount was deducted.');
      }
    } catch (e: any) {
      Alert.alert('Error', 'Could not verify payment: ' + e.message);
    } finally { setVerifying(false); }
  };

  const handleCheckoutMessage = (event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.status === 'success') {
        setCheckoutHtml(null);
        verifyAndRefresh(msg.response);
      } else if (msg.status === 'dismissed') {
        // User closed the checkout themselves
        setCheckoutHtml(null);
      }
      // 'failed' → deliberately do nothing here. Razorpay's checkout.js
      // already shows its own failure screen ("Payment failed / Please use
      // another method") and lets the user retry with a different card or
      // method inside the same session. Closing the WebView at this point
      // would cut that retry flow short and force them to start over.
    } catch {
      setCheckoutHtml(null);
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#F97316" size="large" /></View>;
  }
  if (!ledger) {
    return <View style={styles.center}><Text style={styles.emptyText}>Could not load credit ledger</Text></View>;
  }

  const { organization: org, outstanding, entries } = ledger;
  const overLimit = outstanding > org.credit_limit;
  const available = Math.max(0, org.credit_limit - outstanding);

  return (
    <View style={styles.container}>
      <FlatList
        data={entries}
        keyExtractor={e => e.id.toString()}
        contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F97316" />}
        ListHeaderComponent={
          <View>
            <Text style={styles.orgName}>{org.name}</Text>

            <View style={styles.statRow}>
              <View style={[styles.statBox, overLimit && styles.statBoxAlert]}>
                <Text style={styles.statLabel}>Outstanding</Text>
                <Text style={[styles.statVal, { color: '#EF4444' }]}>{inr(outstanding)}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Credit Limit</Text>
                <Text style={styles.statVal}>{inr(org.credit_limit)}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Available</Text>
                <Text style={[styles.statVal, { color: available > 0 ? '#10B981' : '#EF4444' }]}>{inr(available)}</Text>
              </View>
            </View>

            {overLimit && (
              <View style={styles.warnBox}>
                <Text style={styles.warnText}>
                  ⚠️ Outstanding has crossed the credit limit. Report values stay locked until the balance is brought within limit.
                </Text>
              </View>
            )}

            <View style={styles.payCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.payTitle}>Pay Outstanding</Text>
                <Text style={styles.paySub}>Clear your balance online via Razorpay.</Text>
              </View>
              <TouchableOpacity
                style={[styles.payBtn, outstanding <= 0 && { opacity: 0.4 }]}
                onPress={startPayment}
                disabled={outstanding <= 0 || creatingOrder}
              >
                {creatingOrder ? <ActivityIndicator color="#fff" size="small" /> : (
                  <Text style={styles.payBtnText}>💳 Pay {inr(outstanding)}</Text>
                )}
              </TouchableOpacity>
            </View>

            <Text style={styles.ledgerTitle}>Ledger · debit & credit</Text>
          </View>
        }
        renderItem={({ item: e }) => {
          const isBill = e.type === 'bill';
          return (
            <View style={styles.entryRow}>
              <View style={[styles.typeBadge, { backgroundColor: isBill ? '#EF444422' : '#10B98122' }]}>
                <Text style={[styles.typeBadgeText, { color: isBill ? '#EF4444' : '#10B981' }]}>
                  {isBill ? 'Invoice' : 'Payment'}
                </Text>
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.entryRef}>{e.ref}</Text>
                <Text style={styles.entryDate}>{fmtDate(e.created_at)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.entryAmt, { color: isBill ? '#EF4444' : '#10B981' }]}>
                  {isBill ? '+' : '–'} {inr(e.amount)}
                </Text>
                <Text style={styles.entryBalance}>{inr(e.balance_after)}</Text>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.noData}>No ledger entries</Text>}
      />

      {/* Razorpay Checkout WebView */}
      <Modal visible={!!checkoutHtml} animationType="slide" onRequestClose={() => setCheckoutHtml(null)}>
        <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
          <TouchableOpacity style={styles.checkoutClose} onPress={() => setCheckoutHtml(null)}>
            <Text style={styles.checkoutCloseText}>✕ Cancel</Text>
          </TouchableOpacity>
          {checkoutHtml && (
            <WebView
              originWhitelist={['*']}
              source={{ html: checkoutHtml }}
              onMessage={handleCheckoutMessage}
              javaScriptEnabled
              domStorageEnabled
              startInLoadingState
              renderLoading={() => <ActivityIndicator color="#F97316" size="large" style={{ marginTop: 60 }} />}
            />
          )}
        </View>
      </Modal>

      {/* Verifying payment overlay */}
      <Modal visible={verifying} transparent animationType="fade">
        <View style={styles.verifyOverlay}>
          <View style={styles.verifyBox}>
            <ActivityIndicator color="#F97316" size="large" />
            <Text style={styles.verifyText}>Confirming payment…</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#F8FAFC' },
  center:         { flex: 1, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center' },
  emptyText:      { color: '#64748B', fontSize: 15 },
  orgName:        { color: '#0F172A', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  statRow:        { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statBox:        { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#E2E8F0' },
  statBoxAlert:   { borderColor: '#EF4444' },
  statLabel:      { color: '#64748B', fontSize: 10, fontWeight: '600', marginBottom: 4 },
  statVal:        { color: '#0F172A', fontSize: 15, fontWeight: 'bold' },
  warnBox:        { backgroundColor: '#EF444418', borderWidth: 1, borderColor: '#EF444455', borderRadius: 10, padding: 12, marginBottom: 12 },
  warnText:       { color: '#F87171', fontSize: 12, lineHeight: 17 },
  payCard:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 16 },
  payTitle:       { color: '#0F172A', fontSize: 14, fontWeight: '700' },
  paySub:         { color: '#64748B', fontSize: 11, marginTop: 2 },
  payBtn:         { backgroundColor: '#3B82F6', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10 },
  payBtnText:     { color: '#fff', fontWeight: '700', fontSize: 12.5 },
  ledgerTitle:    { color: '#94A3B8', fontSize: 13, fontWeight: '700', marginBottom: 10 },
  entryRow:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  typeBadge:      { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  typeBadgeText:  { fontSize: 10, fontWeight: '700' },
  entryRef:       { color: '#0F172A', fontSize: 13, fontWeight: '600' },
  entryDate:      { color: '#475569', fontSize: 11, marginTop: 2 },
  entryAmt:       { fontSize: 13, fontWeight: '700' },
  entryBalance:   { color: '#64748B', fontSize: 11, marginTop: 2 },
  noData:         { color: '#475569', textAlign: 'center', marginTop: 24, fontSize: 13 },
  checkoutClose:  { padding: 16, paddingTop: 50 },
  checkoutCloseText: { color: '#94A3B8', fontSize: 14, fontWeight: '600' },
  verifyOverlay:  { flex: 1, backgroundColor: '#000000AA', justifyContent: 'center', alignItems: 'center' },
  verifyBox:      { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 28, alignItems: 'center' },
  verifyText:     { color: '#0F172A', fontSize: 14, fontWeight: '600', marginTop: 12 },
});
