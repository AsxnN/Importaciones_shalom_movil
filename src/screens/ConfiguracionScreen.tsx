import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Almacen } from '../types';
import { supabase } from '../lib/supabase';
import { fetchAlmacenes } from '../services/recepcion';
import {
  getHapticEnabled,
  saveHapticEnabled,
  setActiveWarehouse,
} from '../services/storage';
import { hapticImpact, hapticSuccess, setHapticsActive } from '../lib/haptics';

interface Props {
  almacenActual: Almacen;
  onAlmacenCambiado: (nuevoAlmacen: Almacen) => void;
  onBackToMenu: () => void;
}

export function ConfiguracionScreen({
  almacenActual,
  onAlmacenCambiado,
  onBackToMenu,
}: Props) {
  const [almacenes, setAlmacenes] = useState<Almacen[]>([almacenActual]);
  const [loadingAlmacenes, setLoadingAlmacenes] = useState(false);
  const [hapticOn, setHapticOn] = useState(true);

  // Estados de Auth
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [passInput, setPassInput] = useState('');
  const [autenticando, setAutenticando] = useState(false);

  useEffect(() => {
    async function init() {
      setLoadingAlmacenes(true);
      const [lista, hapt] = await Promise.all([
        fetchAlmacenes(),
        getHapticEnabled(),
      ]);
      setAlmacenes(lista);
      setHapticOn(hapt);
      setHapticsActive(hapt);

      const { data } = await supabase.auth.getSession();
      setUserEmail(data.session?.user?.email ?? null);
      setLoadingAlmacenes(false);
    }
    void init();
  }, []);

  const handleToggleHaptic = async (val: boolean) => {
    setHapticOn(val);
    setHapticsActive(val);
    await saveHapticEnabled(val);
    if (val) void hapticImpact();
  };

  const handleSelectAlmacen = async (alm: Almacen) => {
    void hapticSuccess();
    await setActiveWarehouse(alm);
    onAlmacenCambiado(alm);
    Alert.alert('Almacén Actualizado', `La terminal ahora opera en: ${alm.nombre}`);
  };

  const handleLogin = async () => {
    if (!emailInput.trim() || !passInput.trim()) {
      Alert.alert('Datos requeridos', 'Ingrese correo y contraseña.');
      return;
    }

    setAutenticando(true);
    void hapticImpact();
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailInput.trim(),
        password: passInput.trim(),
      });

      if (error) {
        Alert.alert('Error de autenticación', error.message);
      } else {
        void hapticSuccess();
        setUserEmail(data.user?.email ?? null);
        setEmailInput('');
        setPassInput('');
        Alert.alert('Sesión Iniciada', `Conectado como: ${data.user?.email}`);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Fallo de red');
    } finally {
      setAutenticando(false);
    }
  };

  const handleLogout = async () => {
    void hapticImpact();
    await supabase.auth.signOut();
    setUserEmail(null);
    Alert.alert('Sesión Cerrada', 'La terminal ha cerrado sesión en Supabase.');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerEyebrow}>MÓDULO 7 · PARÁMETROS</Text>
          <Text style={styles.headerTitle}>Configuración de la Terminal</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Selector de Almacén Activo */}
        <Text style={styles.sectionHeader}>ALMACÉN ACTIVO DE TRABAJO:</Text>
        {loadingAlmacenes ? (
          <ActivityIndicator color="#00b4d8" />
        ) : (
          almacenes.map((alm) => {
            const isSelected = alm.id_almacen === almacenActual.id_almacen;
            return (
              <Pressable
                key={alm.id_almacen}
                style={[styles.warehouseOption, isSelected && styles.warehouseOptionSelected]}
                onPress={() => handleSelectAlmacen(alm)}
              >
                <View>
                  <Text style={[styles.warehouseName, isSelected && { color: '#ffffff' }]}>
                    {alm.nombre}
                  </Text>
                  <Text style={styles.warehouseSub}>
                    ID #{alm.id_almacen} · Tipo: {alm.tipo ?? 'PRINCIPAL'}
                  </Text>
                </View>
                {isSelected && <Text style={styles.checkText}>✓ ACTIVO</Text>}
              </Pressable>
            );
          })
        )}

        {/* Respuesta Háptica */}
        <Text style={[styles.sectionHeader, { marginTop: 20 }]}>RETROALIMENTACIÓN SENSORIAL:</Text>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Respuesta Háptica (Vibración)</Text>
            <Text style={styles.toggleSub}>
              Vibrar en lecturas exitosas y alertas de duplicados
            </Text>
          </View>
          <Switch
            value={hapticOn}
            onValueChange={handleToggleHaptic}
            trackColor={{ false: '#334155', true: '#e52521' }}
            thumbColor={hapticOn ? '#ffffff' : '#94a3b8'}
          />
        </View>

        {/* Autenticación de Operario / Supervisor */}
        <Text style={[styles.sectionHeader, { marginTop: 20 }]}>SESIÓN DE SEGURIDAD OPERATIVA:</Text>
        <View style={styles.authCard}>
          {userEmail ? (
            <View>
              <Text style={styles.authStatusLabel}>USUARIO AUTENTICADO EN SUPABASE:</Text>
              <Text style={styles.authEmail}>{userEmail}</Text>
              <Pressable style={styles.logoutButton} onPress={handleLogout}>
                <Text style={styles.logoutButtonText}>Cerrar Sesión Operativa</Text>
              </Pressable>
            </View>
          ) : (
            <View>
              <Text style={styles.authNotice}>
                Inicie sesión con su cuenta de operario o administrador para acceder a funciones con permisos restringidos.
              </Text>

              <TextInput
                style={styles.textInput}
                placeholder="Correo electrónico"
                placeholderTextColor="#64748b"
                value={emailInput}
                onChangeText={setEmailInput}
                autoCapitalize="none"
                keyboardType="email-address"
              />

              <TextInput
                style={[styles.textInput, { marginTop: 8 }]}
                placeholder="Contraseña"
                placeholderTextColor="#64748b"
                value={passInput}
                onChangeText={setPassInput}
                secureTextEntry
              />

              <Pressable
                style={[styles.loginButton, autenticando && { opacity: 0.6 }]}
                onPress={handleLogin}
                disabled={autenticando}
              >
                {autenticando ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.loginButtonText}>Iniciar Sesión</Text>
                )}
              </Pressable>
            </View>
          )}
        </View>

        <Pressable style={styles.backButton} onPress={onBackToMenu}>
          <Text style={styles.backButtonText}>⬅ Volver al Menú Principal</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#070a12',
  },
  header: {
    paddingTop: 52,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: '#0d1322',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerEyebrow: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 18,
    paddingBottom: 40,
  },
  sectionHeader: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 10,
  },
  warehouseOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 14,
    marginBottom: 10,
  },
  warehouseOptionSelected: {
    borderColor: '#00b4d8',
    borderWidth: 1.5,
    backgroundColor: '#0c1a2e',
  },
  warehouseName: {
    color: '#cbd5e1',
    fontSize: 15,
    fontWeight: 'bold',
  },
  warehouseSub: {
    color: '#64748b',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  checkText: {
    color: '#00b4d8',
    fontWeight: 'bold',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 14,
  },
  toggleLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  toggleSub: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  authCard: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    marginBottom: 16,
  },
  authStatusLabel: {
    color: '#4ade80',
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  authEmail: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  logoutButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  logoutButtonText: {
    color: '#f87171',
    fontWeight: 'bold',
    fontSize: 13,
  },
  authNotice: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  textInput: {
    backgroundColor: '#090d16',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  loginButton: {
    backgroundColor: '#00b4d8',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  loginButtonText: {
    color: '#000000',
    fontWeight: 'bold',
    fontSize: 14,
  },
  backButton: {
    backgroundColor: '#0b1120',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  backButtonText: {
    color: '#94a3b8',
    fontWeight: '600',
    fontSize: 13,
  },
});
