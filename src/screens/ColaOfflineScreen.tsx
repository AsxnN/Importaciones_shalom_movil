import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { TransaccionOffline } from '../types';
import { clearOfflineQueue, getOfflineQueue } from '../services/storage';
import { sincronizarColaOffline } from '../services/recepcion';
import { hapticError, hapticImpact, hapticSuccess } from '../lib/haptics';

interface Props {
  onBackToMenu: () => void;
  onRefreshColaCount?: () => void;
}

export function ColaOfflineScreen({ onBackToMenu, onRefreshColaCount }: Props) {
  const [cola, setCola] = useState<TransaccionOffline[]>([]);
  const [loading, setLoading] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [logSincronizacion, setLogSincronizacion] = useState<string[]>([]);

  const cargarCola = async () => {
    setLoading(true);
    const items = await getOfflineQueue();
    setCola(items);
    setLoading(false);
    if (onRefreshColaCount) onRefreshColaCount();
  };

  useEffect(() => {
    void cargarCola();
  }, []);

  const handleSincronizar = async () => {
    if (cola.length === 0) {
      Alert.alert('Cola Vacía', 'No hay transacciones pendientes para sincronizar.');
      return;
    }

    setSincronizando(true);
    setLogSincronizacion([]);
    void hapticImpact();

    try {
      const res = await sincronizarColaOffline();
      setLogSincronizacion(res.detalles);
      if (res.sincronizados > 0) {
        void hapticSuccess();
      } else {
        void hapticError();
      }
      await cargarCola();
    } catch (err: any) {
      void hapticError();
      setLogSincronizacion([`❌ Error general: ${err?.message ?? 'Fallo de red'}`]);
    } finally {
      setSincronizando(false);
    }
  };

  const handleVaciarCola = () => {
    Alert.alert(
      '⚠️ Vaciar Cola Offline',
      '¿Está seguro de eliminar todas las transacciones pendientes? Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sí, Vaciar',
          style: 'destructive',
          onPress: async () => {
            void hapticImpact();
            await clearOfflineQueue();
            await cargarCola();
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerEyebrow}>MÓDULO 5 · PERSISTENCIA</Text>
          <Text style={styles.headerTitle}>Cola Pendientes Offline</Text>
        </View>
        <View style={styles.counterBadge}>
          <Text style={styles.counterBadgeText}>{cola.length} TX</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {loading ? (
          <ActivityIndicator color="#00b4d8" style={{ marginVertical: 30 }} />
        ) : cola.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text style={styles.emptyTitle}>Cola Totalmente Sincronizada</Text>
            <Text style={styles.emptyDesc}>
              No hay transacciones pendientes de envío a Supabase en el dispositivo.
            </Text>
          </View>
        ) : (
          <View>
            <Text style={styles.sectionHeader}>TRANSACCIONES ALMACENADAS LOCALMENTE:</Text>
            {cola.map((item, idx) => (
              <View key={item.id} style={styles.txCard}>
                <View style={styles.txHeader}>
                  <Text style={styles.txType}>{item.tipo_operacion}</Text>
                  <Text style={styles.txDate}>
                    {new Date(item.creado_en).toLocaleTimeString()}
                  </Text>
                </View>

                {item.payload.resumen && (
                  <View style={styles.txDetails}>
                    <Text style={styles.txDetailText}>
                      Orden: {item.payload.resumen.numero_orden} ({item.payload.resumen.sku})
                    </Text>
                    <Text style={styles.txDetailSub}>
                      {item.payload.resumen.paletas} paletas completas · {item.payload.resumen.puchos} puchos ({item.payload.resumen.total_tags} tags)
                    </Text>
                  </View>
                )}

                {item.ultimo_error && (
                  <Text style={styles.txErrorText}>Error previo: {item.ultimo_error}</Text>
                )}
              </View>
            ))}

            <Pressable
              style={[styles.syncButton, sincronizando && { opacity: 0.6 }]}
              onPress={handleSincronizar}
              disabled={sincronizando}
            >
              {sincronizando ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.syncButtonText}>
                  🔄 SINCRONIZAR AHORA CON SUPABASE
                </Text>
              )}
            </Pressable>

            <Pressable style={styles.clearButton} onPress={handleVaciarCola}>
              <Text style={styles.clearButtonText}>🗑️ Vaciar Cola Local</Text>
            </Pressable>
          </View>
        )}

        {/* Log de sincronización */}
        {logSincronizacion.length > 0 && (
          <View style={styles.logCard}>
            <Text style={styles.logTitle}>INFORME DE SINCRONIZACIÓN:</Text>
            {logSincronizacion.map((log, i) => (
              <Text key={i} style={styles.logText}>
                {log}
              </Text>
            ))}
          </View>
        )}

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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerEyebrow: {
    color: '#38bdf8',
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
  counterBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: '#38bdf8',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  counterBadgeText: {
    color: '#38bdf8',
    fontSize: 11,
    fontFamily: 'monospace',
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
  emptyCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 30,
    alignItems: 'center',
    marginVertical: 20,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  emptyTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  emptyDesc: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  txCard: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 14,
    marginBottom: 10,
  },
  txHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  txType: {
    color: '#38bdf8',
    fontWeight: 'bold',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  txDate: {
    color: '#64748b',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  txDetails: {
    marginBottom: 4,
  },
  txDetailText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  txDetailSub: {
    color: '#cbd5e1',
    fontSize: 12,
    marginTop: 2,
  },
  txErrorText: {
    color: '#f87171',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 6,
  },
  syncButton: {
    backgroundColor: '#38bdf8',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  syncButtonText: {
    color: '#000000',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 0.5,
  },
  clearButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 14,
  },
  clearButtonText: {
    color: '#f87171',
    fontWeight: 'bold',
    fontSize: 13,
  },
  logCard: {
    backgroundColor: '#090d16',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 12,
    marginVertical: 12,
  },
  logTitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    marginBottom: 6,
  },
  logText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 4,
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
