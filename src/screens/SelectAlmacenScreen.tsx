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
import { fetchAlmacenes } from '../services/recepcion';
import { setActiveWarehouse } from '../services/storage';
import { hapticImpact, hapticSuccess } from '../lib/haptics';

interface Props {
  almacenActual: Almacen;
  operarioEmail: string;
  onAlmacenConfirmado: (almacen: Almacen) => void;
}

export function SelectAlmacenScreen({
  almacenActual,
  operarioEmail,
  onAlmacenConfirmado,
}: Props) {
  const [almacenes, setAlmacenes] = useState<Almacen[]>([almacenActual]);
  const [seleccionado, setSeleccionado] = useState<Almacen>(almacenActual);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const lista = await fetchAlmacenes();
      setAlmacenes(lista);
      // Si el actual está en la lista, mantenerlo, sino tomar el primero
      const match = lista.find((a) => a.id_almacen === almacenActual.id_almacen) ?? lista[0];
      if (match) {
        setSeleccionado(match);
      }
      setLoading(false);
    }
    void load();
  }, [almacenActual]);

  const handleConfirmar = async () => {
    void hapticSuccess();
    await setActiveWarehouse(seleccionado);
    onAlmacenConfirmado(seleccionado);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerEyebrow}>ASIGNACIÓN DE PUESTO</Text>
        <Text style={styles.headerTitle}>Seleccionar Almacén de Trabajo</Text>
        <Text style={styles.headerSubtitle}>
          Operario activo: {operarioEmail}
        </Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionNotice}>
          Indique en qué almacén operará la terminal móvil. Todas las recepciones RFID y movimientos inmediatos afectarán las existencias de este almacén:
        </Text>

        {loading ? (
          <ActivityIndicator color="#00b4d8" style={{ marginVertical: 30 }} />
        ) : (
          almacenes.map((alm) => {
            const isSelected = alm.id_almacen === seleccionado.id_almacen;
            return (
              <Pressable
                key={alm.id_almacen}
                style={[styles.optionCard, isSelected && styles.optionCardSelected]}
                onPress={() => {
                  void hapticImpact();
                  setSeleccionado(alm);
                }}
              >
                <View style={styles.optionInfo}>
                  <Text style={[styles.optionName, isSelected && { color: '#ffffff' }]}>
                    {alm.nombre}
                  </Text>
                  <Text style={styles.optionDetail}>
                    ID #{alm.id_almacen} · Tipo: {alm.tipo ?? 'PRINCIPAL'} · Capacidad: {alm.capacidad_m3 ?? '-'} m³
                  </Text>
                </View>
                <View style={[styles.checkCircle, isSelected && styles.checkCircleSelected]}>
                  {isSelected && <Text style={styles.checkText}>✓</Text>}
                </View>
              </Pressable>
            );
          })
        )}

        <Pressable style={styles.confirmButton} onPress={handleConfirmar}>
          <Text style={styles.confirmButtonText}>
            CONFIRMAR Y CONTINUAR AL MENÚ ➔
          </Text>
        </Pressable>

        <Text style={styles.note}>
          ℹ️ Siempre podrá modificar el almacén activo desde el Módulo 7 (Configuración).
        </Text>
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
    paddingTop: 54,
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
    marginTop: 2,
  },
  headerSubtitle: {
    color: '#4ade80',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 18,
    paddingBottom: 40,
  },
  sectionNotice: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 16,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#1e293b',
    padding: 16,
    marginBottom: 12,
  },
  optionCardSelected: {
    borderColor: '#00b4d8',
    backgroundColor: '#0c1a2e',
  },
  optionInfo: {
    flex: 1,
  },
  optionName: {
    color: '#cbd5e1',
    fontSize: 15,
    fontWeight: 'bold',
  },
  optionDetail: {
    color: '#64748b',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  checkCircleSelected: {
    borderColor: '#00b4d8',
    backgroundColor: '#00b4d8',
  },
  checkText: {
    color: '#000000',
    fontWeight: '900',
    fontSize: 14,
  },
  confirmButton: {
    backgroundColor: '#e52521',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 14,
  },
  confirmButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  note: {
    color: '#64748b',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 16,
  },
});
