import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Almacen, HistorialKardexItem } from '../types';
import { hapticImpact } from '../lib/haptics';
import { fetchHistorialKardex } from '../services/movimientos';

interface Props {
  almacen: Almacen;
  onBackToMenu: () => void;
}

type FiltroTipo = 'TODOS' | 'INGRESOS' | 'DESPACHOS' | 'PUCHOS';
type FiltroRango = 'HOY' | '7_DIAS' | '30_DIAS' | 'TODO';

export function HistorialScreen({ almacen, onBackToMenu }: Props) {
  const [items, setItems] = useState<HistorialKardexItem[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filtros activos
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('TODOS');
  const [filtroRango, setFiltroRango] = useState<FiltroRango>('7_DIAS');

  const cargarHistorial = async () => {
    try {
      let rangoDias = 7;
      if (filtroRango === 'HOY') rangoDias = 1;
      else if (filtroRango === '30_DIAS') rangoDias = 30;
      else if (filtroRango === 'TODO') rangoDias = 0;

      const data = await fetchHistorialKardex({
        id_almacen: almacen.id_almacen,
        tipo: filtroTipo,
        rangoDias: rangoDias > 0 ? rangoDias : undefined,
        limite: 100,
      });

      setItems(data);
    } finally {
      setCargando(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setCargando(true);
    void cargarHistorial();
  }, [almacen.id_almacen, filtroTipo, filtroRango]);

  const onRefresh = () => {
    setRefreshing(true);
    void cargarHistorial();
  };

  // Formateador de fecha legible
  const formatearFecha = (iso: string) => {
    try {
      const d = new Date(iso);
      const dia = String(d.getDate()).padStart(2, '0');
      const mes = String(d.getMonth() + 1).padStart(2, '0');
      const anio = d.getFullYear();
      const hora = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `${dia}/${mes}/${anio} ${hora}:${min}`;
    } catch {
      return iso;
    }
  };

  // Renderizado del badge por tipo de movimiento
  const renderBadgeTipo = (tipo: string) => {
    const esIngreso = tipo.startsWith('INGRESO');
    const esDespachoCompleto = tipo === 'DESPACHO_COMPLETO';
    const esRetiroParcial = tipo === 'RETIRO_PARCIAL' || tipo.includes('PUCHO');

    let badgeColor = '#10b981';
    let badgeText = 'INGRESO';

    if (esDespachoCompleto) {
      badgeColor = '#ef4444';
      badgeText = 'DESPACHO COMPLETO';
    } else if (esRetiroParcial) {
      badgeColor = '#f59e0b';
      badgeText = 'RETIRO PARCIAL / PUCHO';
    } else if (esIngreso) {
      badgeColor = '#10b981';
      badgeText = 'INGRESO RFID';
    }

    return (
      <View
        style={[
          styles.tipoBadge,
          { borderColor: badgeColor, backgroundColor: `${badgeColor}15` },
        ]}
      >
        <Text style={[styles.tipoBadgeText, { color: badgeColor }]}>
          {badgeText}
        </Text>
      </View>
    );
  };

  const renderItem = ({ item }: { item: HistorialKardexItem }) => {
    const esPositivo = item.cantidad_afectada > 0;

    return (
      <View style={styles.cardItem}>
        <View style={styles.cardItemHeader}>
          {renderBadgeTipo(item.tipo)}
          <Text style={styles.fechaText}>{formatearFecha(item.fecha)}</Text>
        </View>

        <View style={styles.cardBody}>
          <View style={styles.productInfo}>
            <Text style={styles.skuText}>{item.producto_sku}</Text>
            <Text style={styles.nombreText} numberOfLines={2}>
              {item.producto_nombre}
            </Text>
          </View>

          <View style={styles.qtyBox}>
            <Text
              style={[
                styles.qtyVal,
                esPositivo ? styles.qtyPositiva : styles.qtyNegativa,
              ]}
            >
              {esPositivo ? `+${item.cantidad_afectada}` : `${item.cantidad_afectada}`} u
            </Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.motivoText} numberOfLines={2}>
            {item.motivo}
          </Text>
          <View style={styles.userRow}>
            <Text style={styles.userIcon}>👤</Text>
            <Text style={styles.userText}>{item.usuario_nombre}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerEyebrow}>MÓDULO 8 · AUDITORÍA</Text>
          <Text style={styles.headerTitle}>Historial y Kardex</Text>
        </View>
        <Text style={styles.badge}>{almacen.nombre}</Text>
      </View>

      {/* FILTROS POR TIPO DE OPERACIÓN */}
      <View style={styles.filtersWrapper}>
        <Text style={styles.filtersLabel}>TIPO DE MOVIMIENTO:</Text>
        <View style={styles.chipsRow}>
          {[
            { id: 'TODOS', label: 'Todos' },
            { id: 'INGRESOS', label: 'Ingresos' },
            { id: 'DESPACHOS', label: 'Despachos' },
            { id: 'PUCHOS', label: 'Puchos' },
          ].map((chip) => (
            <Pressable
              key={chip.id}
              style={[
                styles.chip,
                filtroTipo === chip.id && styles.chipActive,
              ]}
              onPress={() => {
                void hapticImpact();
                setFiltroTipo(chip.id as FiltroTipo);
              }}
            >
              <Text
                style={[
                  styles.chipText,
                  filtroTipo === chip.id && styles.chipTextActive,
                ]}
              >
                {chip.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* FILTROS POR FECHA */}
        <Text style={[styles.filtersLabel, { marginTop: 8 }]}>RANGO TEMPORAL:</Text>
        <View style={styles.chipsRow}>
          {[
            { id: 'HOY', label: 'Hoy' },
            { id: '7_DIAS', label: '7 Días' },
            { id: '30_DIAS', label: '30 Días' },
            { id: 'TODO', label: 'Todo' },
          ].map((chip) => (
            <Pressable
              key={chip.id}
              style={[
                styles.chip,
                filtroRango === chip.id && styles.chipActive,
              ]}
              onPress={() => {
                void hapticImpact();
                setFiltroRango(chip.id as FiltroRango);
              }}
            >
              <Text
                style={[
                  styles.chipText,
                  filtroRango === chip.id && styles.chipTextActive,
                ]}
              >
                {chip.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* LISTADO DE KARDEX */}
      {cargando ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#e52521" />
          <Text style={styles.loadingText}>Cargando historial de movimientos...</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id_movimiento)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#e52521"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={styles.emptyTitle}>Sin movimientos registrados</Text>
              <Text style={styles.emptySubtitle}>
                No se encontraron registros para los filtros seleccionados en este almacén.
              </Text>
            </View>
          }
        />
      )}

      {/* BOTÓN VOLVER */}
      <View style={styles.footer}>
        <Pressable
          style={styles.backButton}
          onPress={() => {
            void hapticImpact();
            onBackToMenu();
          }}
        >
          <Text style={styles.backButtonText}>⬅ Volver al Menú Principal</Text>
        </Pressable>
      </View>
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
    color: '#e52521',
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
  filtersWrapper: {
    backgroundColor: '#0b1120',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  filtersLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 6,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flex: 1,
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 6,
    paddingVertical: 6,
    alignItems: 'center',
  },
  chipActive: {
    backgroundColor: '#1e293b',
    borderColor: '#e52521',
  },
  chipText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  listContent: {
    padding: 16,
    paddingBottom: 24,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 12,
  },
  emptyContainer: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 24,
    alignItems: 'center',
    marginTop: 20,
  },
  emptyIcon: {
    fontSize: 34,
    marginBottom: 8,
  },
  emptyTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  emptySubtitle: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
  cardItem: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 14,
    marginBottom: 12,
  },
  cardItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  tipoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  tipoBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  fechaText: {
    color: '#64748b',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  cardBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  productInfo: {
    flex: 1,
    marginRight: 10,
  },
  skuText: {
    color: '#f59e0b',
    fontSize: 13,
    fontWeight: 'bold',
  },
  nombreText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  qtyBox: {
    alignItems: 'flex-end',
  },
  qtyVal: {
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  qtyPositiva: {
    color: '#10b981',
  },
  qtyNegativa: {
    color: '#ef4444',
  },
  cardFooter: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  motivoText: {
    color: '#94a3b8',
    fontSize: 11,
    flex: 1,
    marginRight: 8,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  userIcon: {
    fontSize: 10,
  },
  userText: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  footer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    backgroundColor: '#0d1322',
  },
  backButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#64748b',
    fontSize: 13,
  },
});
