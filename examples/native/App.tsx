import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

const ISSUER = process.env.EXPO_PUBLIC_OIDC_ISSUER ?? 'https://identity.example';
const CLIENT_ID = process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? 'approved-native-client-id';
const REDIRECT_URI = AuthSession.makeRedirectUri({ scheme: 'org.dt.identitydemo', path: 'callback', isTripleSlashed: true });

export default function App() {
  const discovery = AuthSession.useAutoDiscovery(ISSUER);
  const [request, response, promptAsync] = AuthSession.useAuthRequest({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    responseType: AuthSession.ResponseType.Code,
    scopes: ['openid', 'profile', 'email'],
    usePKCE: true,
  }, discovery);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (response?.type !== 'success' || !request || !discovery) return;
    let cancelled = false;
    setBusy(true);
    setError('');
    (async () => {
      const code = response.params.code;
      if (!code || !request.codeVerifier) throw new Error('The authorization response is incomplete.');
      const tokens = await AuthSession.exchangeCodeAsync({
        clientId: CLIENT_ID,
        code,
        redirectUri: REDIRECT_URI,
        extraParams: { code_verifier: request.codeVerifier },
      }, discovery);
      const result = await AuthSession.fetchUserInfoAsync(tokens, discovery);
      if (!cancelled) setProfile(result);
    })().catch(() => {
      if (!cancelled) setError('Sign-in could not be completed. Start again.');
    }).finally(() => {
      if (!cancelled) setBusy(false);
    });
    return () => { cancelled = true; };
  }, [response, request, discovery]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card}>
        <Text style={styles.brand}>DT Identity</Text>
        <Text style={styles.title}>Native OIDC example</Text>
        <Text style={styles.copy}>Authorization Code + S256 PKCE with the system browser.</Text>
        {!profile ? (
          <Button
            title={busy ? 'Signing in…' : 'Sign in'}
            disabled={!request || !discovery || busy}
            onPress={() => { void promptAsync(); }}
          />
        ) : (
          <>
            <Text style={styles.label}>UserInfo response</Text>
            <Text selectable style={styles.result}>{JSON.stringify(profile, null, 2)}</Text>
            <Button title="Clear local profile" onPress={() => setProfile(null)} />
          </>
        )}
        {busy ? <ActivityIndicator style={styles.spinner} /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Text selectable style={styles.uri}>Registered callback: {REDIRECT_URI}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f3f6fb', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: '#fff', borderColor: '#dfe6ef', borderWidth: 1, borderRadius: 16, padding: 24, gap: 16 },
  brand: { color: '#3657d6', fontWeight: '700', fontSize: 14 },
  title: { color: '#172033', fontWeight: '700', fontSize: 26 },
  copy: { color: '#526174', fontSize: 16, lineHeight: 23 },
  label: { color: '#172033', fontWeight: '600' },
  result: { color: '#172033', fontFamily: 'monospace', fontSize: 13 },
  spinner: { marginTop: 8 },
  error: { color: '#b42318' },
  uri: { color: '#526174', fontSize: 12 },
});
