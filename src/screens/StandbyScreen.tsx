import React from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { Almacen, SesionPausada } from '../types';
import { hapticImpact } from '../lib/haptics';

interface Props {
  almacen: Almacen;
  sesionPausada: SesionPausada | null;
  colaCount: number;
  onEnterMenu: () => void;
  onOpenRecepcionPausada?: () => void;
}

export function StandbyScreen({
  almacen,
  sesionPausada,
  colaCount,
  onEnterMenu,
  onOpenRecepcionPausada,
}: Props) {
  const handlePressEnter = () => {
    void hapticImpact();
    onEnterMenu();
  };

  return (
    <View style={styles.container}>
      {/* Barra superior de telemetría de reposo */}
      <View style={styles.topBar}>
        <View style={styles.chip}>
          <Text style={styles.chipText}>🔋 94% BATERÍA</Text>
        </View>
        <View style={[styles.chip, { backgroundColor: 'rgba(34, 197, 94, 0.15)' }]}>
          <Text style={[styles.chipText, { color: '#4ade80' }]}>📶 WI-FI · EN LÍNEA</Text>
        </View>
      </View>

      {/* Badge central */}
      <View style={styles.badgeContainer}>
        <Text style={styles.badgeText}>TERMINAL INDUSTRIAL RFID</Text>
      </View>

      <Text style={styles.brandTitle}>IMPORTACIONES SHALOM</Text>
      <Text style={styles.subtitle}>Modo Standby · Terminal Táctica Muelle</Text>

      {/* Tarjeta de Almacén Activo */}
      <View style={styles.warehouseCard}>
        <Text style={styles.warehouseLabel}>ALMACÉN ASIGNADO ACTIVO</Text>
        <Text style={styles.warehouseName}>{almacen.nombre}</Text>
        <Text style={styles.warehouseType}>TIPO: {almacen.tipo ?? 'PRINCIPAL'} · ID: #{almacen.id_almacen}</Text>
      </View>

      {/* Alerta de Sesión Pausada en Módulo 3 */}
      {sesionPausada && (
        <Pressable
          style={styles.pausedAlertCard}
          onPress={() => {
            void hapticImpact();
            if (onOpenRecepcionPausada) onOpenRecepcionPausada();
          }}
        >
          <View style={styles.pausedHeader}>
            <Text style={styles.pausedIcon}>⚠️</Text>
            <Text style={styles.pausedTitle}>RECEPCIÓN PAUSADA EN PROGRESO</Text>
          </View>
          <Text style={styles.pausedDesc}>
            Orden: {sesionPausada.orden.numero_orden} ({sesionPausada.orden.sku})
          </Text>
          <Text style={styles.pausedSub}>
            {sesionPausada.total_paletas_completas} Paletas · {sesionPausada.total_paquetes_puchos} Puchos en memoria
          </Text>
          <Text style={styles.pausedAction}>Toca para Reanudar Inmediatamente ➔</Text>
        </Pressable>
      )}

      {/* Indicador de Cola Offline */}
      {colaCount > 0 && (
        <View style={styles.queueNotice}>
          <Text style={styles.queueNoticeText}>
            💾 {colaCount} transacción(es) pendiente(s) en Cola Offline
          </Text>
        </View>
      )}

      {/* Botón táctico de acceso */}
      <Pressable style={styles.actionButton} onPress={handlePressEnter}>
        <Text style={styles.actionButtonText}>OPERAR TERMINAL · MENÚ PRINCIPAL</Text>
        <Text style={styles.actionButtonSubtext}>Presione para seleccionar módulo</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#070a12',
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    position: 'absolute',
    top: 50,
    paddingHorizontal: 20,
  },
  chip: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  chipText: {
    color: '#94a3b8',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  badgeContainer: {
    backgroundColor: 'rgba(229, 37, 33, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(229, 37, 33, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    marginBottom: 12,
  },
  badgeText: {
    color: '#e52521',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
    marginBottom: 28,
    textAlign: 'center',
  },
  warehouseCard: {
    width: '100%',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 18,
    alignItems: 'center',
    marginBottom: 20,
  },
  warehouseLabel: {
    color: '#00b4d8',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 4,
  },
  warehouseName: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  warehouseType: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 4,
    fontFamily: 'monospace',
  },
  pausedAlertCard: {
    width: '100%',
    backgroundColor: 'rgba(234, 179, 8, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.4)',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  pausedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  pausedIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  pausedTitle: {
    color: '#facc15',
    fontWeight: 'bold',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  pausedDesc: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  pausedSub: {
    color: '#cbd5e1',
    fontSize: 12,
    marginTop: 2,
  },
  pausedAction: {
    color: '#facc15',
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 6,
    textAlign: 'right',
  },
  queueNotice: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderColor: 'rgba(59, 130, 246, 0.3)',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 20,
  },
  queueNoticeText: {
    color: '#60a5fa',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  actionButton: {
    backgroundColor: '#e52521',
    width: '100%',
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#e52521',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },
  actionButtonSubtext: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 12,
    marginTop: 3,
  },
});
