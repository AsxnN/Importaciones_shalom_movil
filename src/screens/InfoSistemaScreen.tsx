import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Almacen } from '../types';
import { supabase } from '../lib/supabase';
import { hapticImpact } from '../lib/haptics';

interface Props {
  almacen: Almacen;
  onBackToMenu: () => void;
}

export function InfoSistemaScreen({ almacen, onBackToMenu }: Props) {
  const [latency, setLatency] = useState<number | null>(null);
  const [dbStatus, setDbStatus] = useState<'probando' | 'conectado' | 'error'>('probando');
  const [usuarioEmail, setUsuarioEmail] = useState<string | null>(null);

  const testConnection = async () => {
    setDbStatus('probando');
    const start = Date.now();
    try {
      const { error } = await supabase.from('almacen').select('id_almacen').limit(1);
      const elapsed = Date.now() - start;
      setLatency(elapsed);

      if (error && error.code !== 'PGRST116') {
        setDbStatus('error');
      } else {
        setDbStatus('conectado');
      }

      const { data: authData } = await supabase.auth.getSession();
      setUsuarioEmail(authData.session?.user?.email ?? 'Sesión Terminal Anónima');
    } catch {
      setDbStatus('error');
      setLatency(null);
    }
  };

  useEffect(() => {
    void testConnection();
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerEyebrow}>MÓDULO 6 · TELEMETRÍA</Text>
          <Text style={styles.headerTitle}>Información y Diagnóstico</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Tarjeta de Estado Cloud */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>ENLACE CLOUD SUPABASE</Text>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Estado del Servidor:</Text>
            {dbStatus === 'probando' ? (
              <ActivityIndicator size="small" color="#00b4d8" />
            ) : dbStatus === 'conectado' ? (
              <Text style={[styles.statusVal, { color: '#4ade80' }]}>🟢 EN LÍNEA</Text>
            ) : (
              <Text style={[styles.statusVal, { color: '#ef4444' }]}>🔴 ERROR / SIN RED</Text>
            )}
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Latencia RTT:</Text>
            <Text style={[styles.statusVal, { color: '#38bdf8' }]}>
              {latency !== null ? `${latency} ms` : 'N/A'}
            </Text>
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Proyecto Supabase ID:</Text>
            <Text style={styles.statusVal}>pzsxzzfrwpamjkyyjodj</Text>
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Región Cloud:</Text>
            <Text style={styles.statusVal}>us-west-2 (Oregon)</Text>
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Sesión de Usuario:</Text>
            <Text style={[styles.statusVal, { fontSize: 12 }]}>{usuarioEmail ?? 'Cargando…'}</Text>
          </View>
        </View>

        {/* Tarjeta de Hardware & Terminal */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>ESPECIFICACIONES DE LA TERMINAL</Text>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Aplicación:</Text>
            <Text style={styles.statusVal}>Shalom Móvil Táctica</Text>
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Versión de Software:</Text>
            <Text style={styles.statusVal}>v1.0.0 (Expo SDK 57)</Text>
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Almacén Asignado:</Text>
            <Text style={styles.statusVal}>{almacen.nombre}</Text>
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Lector RFID:</Text>
            <Text style={styles.statusVal}>NFC / Barcode / Teclado Táctico</Text>
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Batería Estimada:</Text>
            <Text style={[styles.statusVal, { color: '#4ade80' }]}>94% (Óptima)</Text>
          </View>
        </View>

        <Pressable
          style={styles.refreshButton}
          onPress={() => {
            void hapticImpact();
            void testConnection();
          }}
        >
          <Text style={styles.refreshButtonText}>⚡ Ejecutar Health-Check / Ping</Text>
        </Pressable>

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
    color: '#00b4d8',
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
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    color: '#00b4d8',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  statusLabel: {
    color: '#94a3b8',
    fontSize: 13,
  },
  statusVal: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  refreshButton: {
    backgroundColor: 'rgba(0, 180, 216, 0.15)',
    borderWidth: 1,
    borderColor: '#00b4d8',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  refreshButtonText: {
    color: '#00b4d8',
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
  },
  backButtonText: {
    color: '#94a3b8',
    fontWeight: '600',
    fontSize: 13,
  },
});
