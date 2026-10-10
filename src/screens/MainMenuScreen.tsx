import React from 'react';
import { StyleSheet, Text, View, Pressable, ScrollView } from 'react-native';
import { Almacen, ScreenId } from '../types';
import { hapticImpact } from '../lib/haptics';

interface Props {
  almacen: Almacen;
  colaCount: number;
  tieneSesionPausada: boolean;
  onNavigate: (screen: ScreenId) => void;
  onBackToStandby: () => void;
}

interface MenuItem {
  id: ScreenId;
  numero: string;
  titulo: string;
  descripcion: string;
  badge?: string;
  badgeColor?: string;
  destacado?: boolean;
}

export function MainMenuScreen({
  almacen,
  colaCount,
  tieneSesionPausada,
  onNavigate,
  onBackToStandby,
}: Props) {
  const menuItems: MenuItem[] = [
    {
      id: 'MOD_1_STOCK',
      numero: '1.0',
      titulo: '1. Consulta de Stock',
      descripcion: 'Inspección de paletas por Tag RFID o búsqueda en catálogo.',
    },
    {
      id: 'MOD_2_MOVIMIENTOS',
      numero: '2.0',
      titulo: '2. Escanear Tag / Movimientos',
      descripcion: 'Despacho completo o retiros parciales de muestras o mermas.',
    },
    {
      id: 'MOD_3_RECEPCION',
      numero: '3.0',
      titulo: '3. Recepción / Conciliación Ciega',
      descripcion: 'Conteo ciego de importación: paletas completas y puchos.',
      badge: tieneSesionPausada ? 'SESIÓN PAUSADA' : undefined,
      badgeColor: tieneSesionPausada ? '#facc15' : undefined,
      destacado: tieneSesionPausada,
    },
    {
      id: 'MOD_4_AUDITORIA',
      numero: '4.0',
      titulo: '4. Conteo Masivo / Auditoría ERI',
      descripcion: 'Barrido RFID por pasillo para cálculo porcentual ERI.',
    },
    {
      id: 'MOD_5_COLA_OFFLINE',
      numero: '5.0',
      titulo: '5. Cola Pendientes Offline',
      descripcion: 'Gestión y sincronización de transacciones guardadas localmente.',
      badge: colaCount > 0 ? `${colaCount} PENDIENTES` : undefined,
      badgeColor: colaCount > 0 ? '#38bdf8' : undefined,
    },
    {
      id: 'MOD_6_INFO',
      numero: '6.0',
      titulo: '6. Info / Diagnóstico',
      descripcion: 'Telemetría, latencia a Supabase, hardware y versión.',
    },
    {
      id: 'MOD_7_CONFIG',
      numero: '7.0',
      titulo: '7. Configuración',
      descripcion: 'Cambiar almacén activo, háptica y autenticación.',
    },
    {
      id: 'MOD_8_HISTORIAL',
      numero: '8.0',
      titulo: '8. Historial de Operaciones',
      descripcion: 'Kardex inmutable, auditoría de ingresos, despachos y puchos.',
    },
  ];

  const handleSelect = (screenId: ScreenId) => {
    void hapticImpact();
    onNavigate(screenId);
  };

  return (
    <View style={styles.container}>
      {/* Header fijo */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerEyebrow}>TERMINAL TÁCTICA SHALOM</Text>
          <Text style={styles.headerTitle}>1.0 MENÚ PRINCIPAL</Text>
        </View>
        <View style={styles.warehouseTag}>
          <Text style={styles.warehouseTagText}>{almacen.nombre}</Text>
        </View>
      </View>

      {/* Lista de Módulos */}
      <ScrollView
        style={styles.scrollList}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>SELECCIONE UNA OPERACIÓN:</Text>

        {menuItems.map((item) => (
          <Pressable
            key={item.id}
            style={[styles.menuCard, item.destacado && styles.menuCardDestacado]}
            onPress={() => handleSelect(item.id)}
          >
            <View style={styles.menuCardHeader}>
              <Text
                style={[
                  styles.menuItemTitle,
                  item.destacado && { color: '#ffffff', fontWeight: 'bold' },
                ]}
              >
                {item.titulo}
              </Text>
              {item.badge && (
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: item.badgeColor
                        ? `${item.badgeColor}22`
                        : 'rgba(255, 255, 255, 0.1)',
                      borderColor: item.badgeColor ?? '#64748b',
                    },
                  ]}
                >
                  <Text style={[styles.badgeText, { color: item.badgeColor ?? '#94a3b8' }]}>
                    {item.badge}
                  </Text>
                </View>
              )}
            </View>

            <Text style={styles.menuItemDesc}>{item.descripcion}</Text>

            <View style={styles.menuFooter}>
              <Text style={styles.codeText}>{item.numero}</Text>
              <Text style={[styles.arrowText, item.destacado && { color: '#e52521' }]}>
                ACCEDER ➔
              </Text>
            </View>
          </Pressable>
        ))}

        <Pressable
          style={styles.backButton}
          onPress={() => {
            void hapticImpact();
            onBackToStandby();
          }}
        >
          <Text style={styles.backButtonText}>⬅ Regresar a Pantalla de Reposo (Standby)</Text>
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
    paddingTop: 54,
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
    color: '#e52521',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  warehouseTag: {
    backgroundColor: 'rgba(0, 180, 216, 0.15)',
    borderWidth: 1,
    borderColor: '#00b4d8',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    maxWidth: 140,
  },
  warehouseTagText: {
    color: '#00b4d8',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  scrollList: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 12,
  },
  menuCard: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    marginBottom: 12,
  },
  menuCardDestacado: {
    backgroundColor: '#141d33',
    borderColor: '#e52521',
    borderWidth: 1.5,
    shadowColor: '#e52521',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  menuCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  menuItemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#e2e8f0',
    flex: 1,
    marginRight: 8,
  },
  badge: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  menuItemDesc: {
    fontSize: 13,
    color: '#94a3b8',
    lineHeight: 18,
    marginBottom: 10,
  },
  menuFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    paddingTop: 8,
  },
  codeText: {
    color: '#64748b',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  arrowText: {
    color: '#00b4d8',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  backButton: {
    marginTop: 10,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0b1120',
    alignItems: 'center',
  },
  backButtonText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
});
