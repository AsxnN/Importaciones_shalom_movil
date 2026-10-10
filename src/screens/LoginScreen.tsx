import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { hapticError, hapticImpact, hapticSuccess } from '../lib/haptics';
import { asegurarDatosPruebaEnSupabase } from '../services/recepcion';

interface Props {
  onLoginSuccess: (email: string) => void;
}

export function LoginScreen({ onLoginSuccess }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      void hapticError();
      setErrorMsg('Por favor ingrese su correo y contraseña de operario.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    void hapticImpact();

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password.trim(),
      });

      if (error) {
        void hapticError();
        setErrorMsg(error.message);
      } else if (data.user) {
        void hapticSuccess();
        // Aprovisionar datos maestros si es administrador/operario
        void asegurarDatosPruebaEnSupabase();
        onLoginSuccess(data.user.email ?? email.trim());
      } else {
        void hapticError();
        setErrorMsg('No se pudo establecer la sesión con el servidor.');
      }
    } catch (err: any) {
      void hapticError();
      setErrorMsg(err?.message ?? 'Fallo de conexión con Supabase.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Cabecera Táctica de Marca */}
        <View style={styles.brandHeader}>
          <Text style={styles.spiderIcon}>🕸️</Text>
          <Text style={styles.brandEyebrow}>IMPORTACIONES SHALOM</Text>
          <Text style={styles.brandTitle}>Terminal de Operaciones</Text>
          <Text style={styles.brandSubtitle}>
            Autenticación obligatoria para acceso a recepción RFID y gestión de almacén.
          </Text>
        </View>

        {/* Tarjeta de Inicio de Sesión */}
        <View style={styles.card}>
          <Text style={styles.cardHeader}>ACCESO DE SEGURIDAD</Text>

          <Text style={styles.inputLabel}>CORREO ELECTRÓNICO:</Text>
          <TextInput
            style={styles.input}
            placeholder="ej. 76601880@shalomcontrol.com"
            placeholderTextColor="#64748b"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
          />

          <Text style={[styles.inputLabel, { marginTop: 14 }]}>CONTRASEÑA:</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor="#64748b"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
          />

          {errorMsg && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {errorMsg}</Text>
            </View>
          )}

          <Pressable
            style={[styles.loginButton, loading && { opacity: 0.6 }]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.loginButtonText}>
                INGRESAR A LA TERMINAL ➔
              </Text>
            )}
          </Pressable>
        </View>

        {/* Nota de Seguridad */}
        <View style={styles.footerNote}>
          <Text style={styles.footerText}>
            Acceso restringido a personal de operaciones autorizado.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#070a12',
  },
  scrollContent: {
    paddingHorizontal: 22,
    paddingTop: 65,
    paddingBottom: 40,
    justifyContent: 'center',
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  spiderIcon: {
    fontSize: 44,
    marginBottom: 8,
  },
  brandEyebrow: {
    color: '#e52521',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    letterSpacing: 2,
  },
  brandTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 4,
    marginBottom: 6,
    textAlign: 'center',
  },
  brandSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 10,
  },
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#1e293b',
    padding: 20,
    marginBottom: 20,
  },
  cardHeader: {
    color: '#00b4d8',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 16,
  },
  inputLabel: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#070a12',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#334155',
    color: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 8,
    padding: 10,
    marginTop: 14,
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
  },
  loginButton: {
    backgroundColor: '#e52521',
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  loginButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
    letterSpacing: 0.5,
    fontFamily: 'monospace',
  },
  footerNote: {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  footerText: {
    color: '#64748b',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
});
