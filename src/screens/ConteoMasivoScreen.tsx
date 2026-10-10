import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ScrollView,
  Alert,
} from 'react-native';
import { Almacen } from '../types';
import { hapticImpact, hapticSuccess } from '../lib/haptics';

interface Props {
  almacen: Almacen;
  onBackToMenu: () => void;
}

export function ConteoMasivoScreen({ almacen, onBackToMenu }: Props) {
  const [pasillo, setPasillo] = useState('Pasillo A');
  const [tagsCapturados, setTagsCapturados] = useState<string[]>([]);
  const [barridoActivo, setBarridoActivo] = useState(false);
  const [resultadoEri, setResultadoEri] = useState<{
    fisico: number;
    teorico: number;
    porcentajeEri: number;
  } | null>(null);

  const handleSimularLecturaMasiva = () => {
    void hapticSuccess();
    const nuevoTag = `TAG-INV-${String(tagsCapturados.length + 1).padStart(3, '0')}`;
    setTagsCapturados((prev) => [nuevoTag, ...prev]);
  };

  const handleCerrarAuditoria = () => {
    void hapticSuccess();
    const fisico = tagsCapturados.length || 10;
    const teorico = 10;
    const porcentajeEri = Math.min(100, Math.round((fisico / teorico) * 100));

    setResultadoEri({
      fisico,
      teorico,
      porcentajeEri,
    });

    Alert.alert(
      '📊 Auditoría ERI Cerrada',
      `Pasillo: ${pasillo}\nTags Físicos Leídos: ${fisico}\nTeórico Registrado: ${teorico}\nERI: ${porcentajeEri}%`
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerEyebrow}>MÓDULO 4 · AUDITORÍA</Text>
          <Text style={styles.headerTitle}>Conteo Masivo / Auditoría ERI</Text>
        </View>
        <Text style={styles.badge}>{almacen.nombre}</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Selector de Pasillo / Zona */}
        <Text style={styles.sectionHeader}>ZONA FÍSICA SELECCIONADA:</Text>
        <View style={styles.zoneRow}>
          {['Pasillo A', 'Pasillo B', 'Pasillo C', 'Muelle 1'].map((z) => (
            <Pressable
              key={z}
              style={[styles.zoneBtn, pasillo === z && styles.zoneBtnActive]}
              onPress={() => {
                void hapticImpact();
                setPasillo(z);
              }}
            >
              <Text
                style={[styles.zoneBtnText, pasillo === z && { color: '#000000', fontWeight: 'bold' }]}
              >
                {z}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Tablero de Barrido RFID */}
        <View style={styles.sweepCard}>
          <Text style={styles.sweepCardTitle}>BARRIDO RFID UHF EN ZONA</Text>
          <Text style={styles.tagCountText}>{tagsCapturados.length}</Text>
          <Text style={styles.tagCountSub}>Etiquetas Únicas Capturadas</Text>

          <Pressable
            style={styles.captureBtn}
            onPress={handleSimularLecturaMasiva}
          >
            <Text style={styles.captureBtnText}>⚡ Capturar / Leer Tag en Rango</Text>
          </Pressable>
        </View>

        {resultadoEri && (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>RESULTADO EXACTITUD DE INVENTARIO (ERI)</Text>
            <Text style={styles.eriPercent}>{resultadoEri.porcentajeEri}%</Text>
            <Text style={styles.eriSub}>
              Físico: {resultadoEri.fisico} tags vs Teórico: {resultadoEri.teorico} tags
            </Text>
          </View>
        )}

        <Pressable style={styles.finishBtn} onPress={handleCerrarAuditoria}>
          <Text style={styles.finishBtnText}>CERRAR AUDITORÍA Y CALCULAR ERI ➔</Text>
        </Pressable>

        <Pressable
          style={styles.backButton}
          onPress={() => {
            void hapticImpact();
            onBackToMenu();
          }}
        >
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
    color: '#a855f7',
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
  badge: {
    color: '#00b4d8',
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
  zoneRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 18,
  },
  zoneBtn: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  zoneBtnActive: {
    backgroundColor: '#a855f7',
    borderColor: '#a855f7',
  },
  zoneBtnText: {
    color: '#cbd5e1',
    fontSize: 12,
  },
  sweepCard: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#a855f7',
    padding: 22,
    alignItems: 'center',
    marginBottom: 18,
  },
  sweepCardTitle: {
    color: '#a855f7',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  tagCountText: {
    color: '#ffffff',
    fontSize: 54,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  tagCountSub: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
    marginBottom: 16,
  },
  captureBtn: {
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    borderWidth: 1,
    borderColor: '#a855f7',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  captureBtnText: {
    color: '#a855f7',
    fontWeight: 'bold',
    fontSize: 13,
  },
  resultCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#4ade80',
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  resultTitle: {
    color: '#4ade80',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  eriPercent: {
    color: '#ffffff',
    fontSize: 42,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  eriSub: {
    color: '#cbd5e1',
    fontSize: 12,
  },
  finishBtn: {
    backgroundColor: '#a855f7',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  finishBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
    letterSpacing: 0.5,
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
