import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import {
  Almacen,
  ConsultaManualProductoResultado,
  FichaTagRFID,
  PaletaBodegaItem,
  ReglaEmpaque,
} from '../types';
import {
  hapticImpact,
  hapticSuccess,
  hapticWarning,
  hapticError,
} from '../lib/haptics';
import {
  isNfcSupported,
  isNfcEnabled,
  openNfcSettings,
  startNfcSession,
  stopNfcSession,
} from '../lib/nfc';
import {
  consultarTagRfidEnSupabase,
  fetchCatalogoProductosStock,
  fetchAlmacenesStock,
  consultarStockManualProducto,
  fetchPaletasEnBodega,
  FiltroFechaStock,
} from '../services/stock';

interface Props {
  almacen: Almacen;
  onBackToMenu: () => void;
  onNavigateToRecepcion?: () => void;
}

type TabConsulta = 'ESCANEAR_RFID' | 'CATALOGO_MANUAL' | 'PALETAS_BODEGA';

export function ConsultaStockScreen({
  almacen,
  onBackToMenu,
  onNavigateToRecepcion,
}: Props) {
  // Pestaña activa (Fase 1 vs Fase 2)
  const [tabActivo, setTabActivo] = useState<TabConsulta>('ESCANEAR_RFID');

  // ---------------------------------------------------------------------------
  // ESTADO - MODO 1: ESCANEO RFID (FASE 1)
  // ---------------------------------------------------------------------------
  const [tagUidInput, setTagUidInput] = useState('');
  const [consultandoRfid, setConsultandoRfid] = useState(false);
  const [fichaResultado, setFichaResultado] = useState<FichaTagRFID | null>(null);
  const [errorRfidMsg, setErrorRfidMsg] = useState<string | null>(null);

  // Hardware NFC
  const [nfcDisponible, setNfcDisponible] = useState(false);
  const [nfcEncendido, setNfcEncendido] = useState(false);
  const ejecutarConsultaRef = useRef<(uid: string) => void>(() => {});

  // ---------------------------------------------------------------------------
  // ESTADO - MODO 2: CATÁLOGO Y FILTROS MANUALES (FASE 2)
  // ---------------------------------------------------------------------------
  const [loadingCatalogo, setLoadingCatalogo] = useState(false);
  const [productosCatalogo, setProductosCatalogo] = useState<
    {
      id_producto: number;
      sku: string;
      nombre: string;
      descripcion: string;
      categoria: string;
      unidad_medida: string;
      clasificacion_abc: string;
      regla_empaque: ReglaEmpaque;
    }[]
  >([]);
  const [almacenesDisponibles, setAlmacenesDisponibles] = useState<
    { id_almacen: number; nombre: string; tipo?: string }[]
  >([]);

  const [busquedaProducto, setBusquedaProducto] = useState('');
  const [productoSeleccionado, setProductoSeleccionado] = useState<any | null>(null);

  // Filtros interactivos
  const [filtroAlmacenId, setFiltroAlmacenId] = useState<number>(0); // 0 = Todos
  const [filtroFecha, setFiltroFecha] = useState<FiltroFechaStock>('TODO');

  const [consultandoManual, setConsultandoManual] = useState(false);
  const [resultadoManual, setResultadoManual] =
    useState<ConsultaManualProductoResultado | null>(null);

  // ---------------------------------------------------------------------------
  // ESTADO - MODO 3: PALETAS EN BODEGA
  // ---------------------------------------------------------------------------
  const [loadingPaletas, setLoadingPaletas] = useState(false);
  const [paletasBodega, setPaletasBodega] = useState<PaletaBodegaItem[]>([]);
  const [filtroTipoPaleta, setFiltroTipoPaleta] = useState<'TODAS' | 'COMPLETO' | 'PUCHO'>('TODAS');
  const [busquedaPaleta, setBusquedaPaleta] = useState('');
  const [refreshingPaletas, setRefreshingPaletas] = useState(false);

  const cargarPaletas = async () => {
    try {
      const data = await fetchPaletasEnBodega({
        id_almacen: almacen.id_almacen,
        tipo_paleta: filtroTipoPaleta,
        busqueda: busquedaPaleta,
      });
      setPaletasBodega(data);
    } finally {
      setLoadingPaletas(false);
      setRefreshingPaletas(false);
    }
  };

  useEffect(() => {
    if (tabActivo === 'PALETAS_BODEGA') {
      setLoadingPaletas(true);
      void cargarPaletas();
    }
  }, [tabActivo, almacen.id_almacen, filtroTipoPaleta, busquedaPaleta]);

  // ---------------------------------------------------------------------------
  // CARGA DE CATÁLOGO Y ALMACENES (FASE 2)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    async function cargarMaestros() {
      setLoadingCatalogo(true);
      try {
        const [prods, alms] = await Promise.all([
          fetchCatalogoProductosStock(),
          fetchAlmacenesStock(),
        ]);
        setProductosCatalogo(prods);
        setAlmacenesDisponibles(alms);

        // Seleccionar por defecto el primer producto si no hay ninguno seleccionado
        if (prods.length > 0 && !productoSeleccionado) {
          setProductoSeleccionado(prods[0]);
        }
      } catch (err) {
        console.warn('Error cargando maestros para consulta manual:', err);
      } finally {
        setLoadingCatalogo(false);
      }
    }

    void cargarMaestros();
  }, []);

  // ---------------------------------------------------------------------------
  // EJECUTAR CONSULTA MANUAL CUANDO CAMBIAN PRODUCTO, ALMACÉN O FECHA
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!productoSeleccionado) return;

    let isMounted = true;
    async function ejecutarConsultaManual() {
      setConsultandoManual(true);
      try {
        const res = await consultarStockManualProducto({
          producto: productoSeleccionado,
          idAlmacenFiltro: filtroAlmacenId,
          filtroFecha: filtroFecha,
        });
        if (isMounted) {
          setResultadoManual(res);
        }
      } catch (err) {
        console.warn('Error ejecutando consulta manual de stock:', err);
      } finally {
        if (isMounted) setConsultandoManual(false);
      }
    }

    void ejecutarConsultaManual();

    return () => {
      isMounted = false;
    };
  }, [productoSeleccionado, filtroAlmacenId, filtroFecha]);

  // ---------------------------------------------------------------------------
  // EJECUCIÓN DE CONSULTA DEL TAG RFID (MODO 1)
  // ---------------------------------------------------------------------------
  const ejecutarConsultaRfid = async (uid: string) => {
    const cleanUid = uid.trim().toUpperCase();
    if (!cleanUid) {
      void hapticWarning();
      setErrorRfidMsg('Ingrese o escanee un UID de etiqueta válido.');
      return;
    }

    setConsultandoRfid(true);
    setErrorRfidMsg(null);
    setTagUidInput(cleanUid);

    try {
      const res = await consultarTagRfidEnSupabase(cleanUid);

      if (res.encontrado) {
        void hapticSuccess();
        setFichaResultado(res);
        setErrorRfidMsg(null);
      } else {
        void hapticWarning();
        setFichaResultado(res);
        setErrorRfidMsg(
          res.mensaje_error ??
            `La etiqueta RFID ${cleanUid} no se encuentra registrada en Supabase.`
        );
      }
    } catch (err: any) {
      void hapticError();
      setErrorRfidMsg(err?.message ?? 'Error consultando información del tag.');
    } finally {
      setConsultandoRfid(false);
    }
  };

  ejecutarConsultaRef.current = ejecutarConsultaRfid;

  // ---------------------------------------------------------------------------
  // LISTENER CONTINUO NFC (SOLO ACTIVO EN TAB RFID)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelNfc: (() => void) | null = null;
    let isMounted = true;

    async function setupNfc() {
      try {
        const supported = await isNfcSupported();
        if (!isMounted) return;
        setNfcDisponible(supported);

        if (supported) {
          const enabled = await isNfcEnabled();
          if (!isMounted) return;
          setNfcEncendido(enabled);

          if (enabled && tabActivo === 'ESCANEAR_RFID') {
            cancelNfc = await startNfcSession((detectedUid) => {
              void hapticImpact();
              ejecutarConsultaRef.current(detectedUid);
            });
          }
        }
      } catch (err) {
        console.warn('[NFC] Error al activar sesión de escucha en ConsultaStock:', err);
      }
    }

    void setupNfc();

    return () => {
      isMounted = false;
      if (cancelNfc) {
        cancelNfc();
      } else {
        void stopNfcSession();
      }
    };
  }, [tabActivo]);

  // Limpiar consulta RFID
  const handleLimpiarConsultaRfid = () => {
    void hapticImpact();
    setTagUidInput('');
    setFichaResultado(null);
    setErrorRfidMsg(null);
  };

  // Filtrado de productos por búsqueda
  const productosFiltrados = productosCatalogo.filter((p) => {
    const q = busquedaProducto.toLowerCase().trim();
    if (!q) return true;
    return (
      p.sku.toLowerCase().includes(q) ||
      p.nombre.toLowerCase().includes(q) ||
      p.categoria.toLowerCase().includes(q)
    );
  });

  return (
    <View style={styles.container}>
      {/* CABECERA PRINCIPAL */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerEyebrow}>MÓDULO 1 · CONSULTA DE STOCK</Text>
          <Text style={styles.headerTitle}>Existencias e Identificación</Text>
        </View>
        <View style={styles.warehouseChip}>
          <Text style={styles.warehouseChipText}>{almacen.nombre}</Text>
        </View>
      </View>

      {/* TABS SUPERIORES: ESCANEO RFID vs CATÁLOGO vs PALETAS EN BODEGA */}
      <View style={styles.tabsContainer}>
        <Pressable
          style={[styles.tabButton, tabActivo === 'ESCANEAR_RFID' && styles.tabButtonActive]}
          onPress={() => {
            void hapticImpact();
            setTabActivo('ESCANEAR_RFID');
          }}
        >
          <Text
            style={[styles.tabButtonText, tabActivo === 'ESCANEAR_RFID' && styles.tabButtonTextActive]}
          >
            📡 Escanear
          </Text>
        </Pressable>

        <Pressable
          style={[styles.tabButton, tabActivo === 'CATALOGO_MANUAL' && styles.tabButtonActive]}
          onPress={() => {
            void hapticImpact();
            setTabActivo('CATALOGO_MANUAL');
          }}
        >
          <Text
            style={[styles.tabButtonText, tabActivo === 'CATALOGO_MANUAL' && styles.tabButtonTextActive]}
          >
            📦 Catálogo
          </Text>
        </Pressable>

        <Pressable
          style={[styles.tabButton, tabActivo === 'PALETAS_BODEGA' && styles.tabButtonActive]}
          onPress={() => {
            void hapticImpact();
            setTabActivo('PALETAS_BODEGA');
          }}
        >
          <Text
            style={[styles.tabButtonText, tabActivo === 'PALETAS_BODEGA' && styles.tabButtonTextActive]}
          >
            📋 Paletas ({paletasBodega.length})
          </Text>
        </Pressable>
      </View>

      {/* ===================================================================== */}
      {/* MODO 1: ESCANEO RFID (FASE 1)                                        */}
      {/* ===================================================================== */}
      {tabActivo === 'ESCANEAR_RFID' && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {/* BANNER SI NFC ESTÁ APAGADO */}
          {nfcDisponible && !nfcEncendido && (
            <View style={styles.nfcAlertBanner}>
              <Text style={styles.nfcAlertTitle}>⚠️ ANTENA NFC DESACTIVADA EN EL TELÉFONO</Text>
              <Text style={styles.nfcAlertDesc}>
                Active el chip NFC en los ajustes del sistema para escanear etiquetas RFID aproximándolas al teléfono.
              </Text>
              <Pressable
                style={styles.openNfcBtn}
                onPress={async () => {
                  await openNfcSettings();
                  const enabled = await isNfcEnabled();
                  setNfcEncendido(enabled);
                }}
              >
                <Text style={styles.openNfcBtnText}>⚙️ Abrir Ajustes de NFC en el Celular</Text>
              </Pressable>
            </View>
          )}

          {/* ÁREA SENSORIAL NFC */}
          <View style={styles.sensorCard}>
            <Text style={styles.sensorIcon}>📡</Text>
            <Text style={styles.sensorTitle}>ESCANEAR ETIQUETA RFID POR NFC</Text>
            <Text style={styles.sensorDesc}>
              Aproxime la etiqueta RFID de la paleta al reverso del celular. El sistema leerá el UID de fábrica y consultará sus existencias en tiempo real.
            </Text>

            {/* INPUT MANUAL O CON ESCÁNER DE PISTOLA */}
            <View style={styles.inputRow}>
              <TextInput
                style={styles.textInput}
                placeholder="O ingrese UID de tag (ej. TAG-001)..."
                placeholderTextColor="#64748b"
                value={tagUidInput}
                onChangeText={setTagUidInput}
                autoCapitalize="characters"
                onSubmitEditing={() => ejecutarConsultaRfid(tagUidInput)}
              />
              <Pressable
                style={[styles.consultarBtn, consultandoRfid && { opacity: 0.6 }]}
                onPress={() => ejecutarConsultaRfid(tagUidInput)}
                disabled={consultandoRfid}
              >
                {consultandoRfid ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.consultarBtnText}>Consultar</Text>
                )}
              </Pressable>
            </View>

            <View style={styles.demoButtonsRow}>
              <Pressable
                style={styles.simButton}
                onPress={() => {
                  const demoUid = 'TAG-DEMO-001';
                  setTagUidInput(demoUid);
                  ejecutarConsultaRfid(demoUid);
                }}
              >
                <Text style={styles.simButtonText}>⚡ Simular Tag RFID</Text>
              </Pressable>

              {fichaResultado && (
                <Pressable style={styles.clearButton} onPress={handleLimpiarConsultaRfid}>
                  <Text style={styles.clearButtonText}>✕ Limpiar</Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* SPINNER DE CONSULTA A SUPABASE */}
          {consultandoRfid && (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color="#00b4d8" />
              <Text style={styles.loadingTitle}>CONSULTANDO BASE DE DATOS SUPABASE...</Text>
              <Text style={styles.loadingDesc}>
                Buscando enrolamiento de la etiqueta {tagUidInput} y existencias de almacén.
              </Text>
            </View>
          )}

          {/* ALERTA DE ERROR O TAG NO REGISTRADO */}
          {errorRfidMsg && !consultandoRfid && (
            <View style={styles.errorCard}>
              <Text style={styles.errorIcon}>⚠️</Text>
              <Text style={styles.errorTitle}>ETIQUETA NO ENCONTRADA</Text>
              <Text style={styles.errorText}>{errorRfidMsg}</Text>
              {onNavigateToRecepcion && (
                <Pressable
                  style={styles.goToRecepcionBtn}
                  onPress={() => {
                    void hapticImpact();
                    onNavigateToRecepcion();
                  }}
                >
                  <Text style={styles.goToRecepcionBtnText}>
                    ➔ Ir a Módulo 3 para Enrolar este Tag
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {/* FICHA TÁCTICA DEL PRODUCTO Y DE LA PALETA (RESULTADO) */}
          {fichaResultado && fichaResultado.encontrado && fichaResultado.producto && (
            <View style={styles.resultCard}>
              <View style={styles.resultHeader}>
                <View>
                  <Text style={styles.productSku}>{fichaResultado.producto.sku}</Text>
                  <Text style={styles.productCategory}>
                    {fichaResultado.producto.categoria?.toUpperCase() ?? 'SUMINISTROS'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusTagBadge,
                    fichaResultado.estado_tag === 'ACTIVA'
                      ? styles.statusBadgeActive
                      : styles.statusBadgeInactive,
                  ]}
                >
                  <Text style={styles.statusTagText}>
                    ● {fichaResultado.estado_tag ?? 'ACTIVA'}
                  </Text>
                </View>
              </View>

              <Text style={styles.productName}>{fichaResultado.producto.nombre}</Text>
              {fichaResultado.producto.descripcion ? (
                <Text style={styles.productDescription}>
                  {fichaResultado.producto.descripcion}
                </Text>
              ) : null}

              <View style={styles.divider} />

              <Text style={styles.sectionTitle}>
                📦 CONTENIDO ESPECÍFICO DE ESTE TAG RFID:
              </Text>

              <View style={styles.tagHighlightCard}>
                <View style={styles.tagTypeRow}>
                  <View
                    style={[
                      styles.tagTypeBadge,
                      fichaResultado.tipo_paleta === 'COMPLETO'
                        ? styles.badgeCompleto
                        : styles.badgePucho,
                    ]}
                  >
                    <Text style={styles.tagTypeBadgeText}>
                      {fichaResultado.tipo_paleta === 'COMPLETO'
                        ? '🟢 PALETA COMPLETA'
                        : '🟡 PUCHO (CAJAS SUELTAS)'}
                    </Text>
                  </View>
                  <Text style={styles.tagUidLabel}>UID: {fichaResultado.uid_tag}</Text>
                </View>

                <View style={styles.metricGrid}>
                  <View style={styles.metricItem}>
                    <Text style={styles.metricNumber}>
                      {fichaResultado.cantidad_paquetes}
                    </Text>
                    <Text style={styles.metricLabel}>Cajas en esta Paleta</Text>
                  </View>

                  <View style={styles.metricDivider} />

                  <View style={styles.metricItem}>
                    <Text style={[styles.metricNumber, { color: '#4ade80' }]}>
                      {fichaResultado.cantidad_actual}
                    </Text>
                    <Text style={styles.metricLabel}>
                      Unidades ({fichaResultado.producto.unidad_medida})
                    </Text>
                  </View>
                </View>

                {fichaResultado.orden_asociada && (
                  <View style={styles.orderAttachedRow}>
                    <Text style={styles.orderAttachedLabel}>Orden de Ingreso:</Text>
                    <Text style={styles.orderAttachedValue}>
                      {fichaResultado.orden_asociada}
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.divider} />

              <Text style={styles.sectionTitle}>
                🏢 ALMACÉN Y EXISTENCIAS CONSOLIDADAS:
              </Text>

              <View style={styles.stockSummaryCard}>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Almacén Asignado:</Text>
                  <Text style={styles.infoValHighlight}>
                    {fichaResultado.almacen_nombre}
                  </Text>
                </View>

                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Stock Total Almacén:</Text>
                  <Text
                    style={[
                      styles.infoValHighlight,
                      {
                        color:
                          fichaResultado.inventario_almacen?.estado_semaforo === 'ROJO'
                            ? '#ef4444'
                            : fichaResultado.inventario_almacen?.estado_semaforo ===
                              'AMARILLO'
                            ? '#facc15'
                            : '#4ade80',
                      },
                    ]}
                  >
                    {fichaResultado.inventario_almacen?.stock_real ?? 0} unidades
                  </Text>
                </View>

                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Semáforo de Inventario:</Text>
                  <View
                    style={[
                      styles.semaforoBadge,
                      fichaResultado.inventario_almacen?.estado_semaforo === 'ROJO'
                        ? styles.semaforoRojo
                        : fichaResultado.inventario_almacen?.estado_semaforo ===
                          'AMARILLO'
                        ? styles.semaforoAmarillo
                        : styles.semaforoVerde,
                    ]}
                  >
                    <Text style={styles.semaforoBadgeText}>
                      {fichaResultado.inventario_almacen?.estado_semaforo ?? 'VERDE'}
                    </Text>
                  </View>
                </View>

                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Regla de Estiba:</Text>
                  <Text style={styles.infoVal}>
                    {fichaResultado.producto.regla_empaque.cajas_por_paleta} cjs/paleta (
                    {fichaResultado.producto.regla_empaque.unidades_por_caja} u/caja)
                  </Text>
                </View>
              </View>

              <Pressable
                style={styles.scanNextBtn}
                onPress={() => {
                  void hapticImpact();
                  handleLimpiarConsultaRfid();
                }}
              >
                <Text style={styles.scanNextBtnText}>
                  📡 Escanear Otra Etiqueta RFID
                </Text>
              </Pressable>
            </View>
          )}

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
      )}

      {/* =================================================================== */}
      {/* MODO 2: CATÁLOGO Y FILTROS MANUALES (FASE 2)                        */}
      {/* =================================================================== */}
      {tabActivo === 'CATALOGO_MANUAL' && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {/* BUSCADOR DE PRODUCTO */}
          <View style={styles.filterSectionCard}>
            <Text style={styles.filterCardTitle}>SELECCIÓN DE PRODUCTO</Text>
            <TextInput
              style={styles.searchProductInput}
              placeholder="Buscar por SKU o Nombre (ej. ROLLO, CINTA)..."
              placeholderTextColor="#64748b"
              value={busquedaProducto}
              onChangeText={setBusquedaProducto}
              autoCapitalize="characters"
            />

            {loadingCatalogo ? (
              <ActivityIndicator color="#00b4d8" style={{ marginVertical: 12 }} />
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.productsHorizontalScroll}
              >
                {productosFiltrados.map((p) => {
                  const isSelected =
                    productoSeleccionado?.id_producto === p.id_producto;
                  return (
                    <Pressable
                      key={p.id_producto}
                      style={[
                        styles.productChipCard,
                        isSelected && styles.productChipCardSelected,
                      ]}
                      onPress={() => {
                        void hapticImpact();
                        setProductoSeleccionado(p);
                      }}
                    >
                      <View style={styles.productChipHeader}>
                        <Text
                          style={[
                            styles.productChipSku,
                            isSelected && { color: '#ffffff' },
                          ]}
                        >
                          {p.sku}
                        </Text>
                        {isSelected && <Text style={styles.checkIcon}>✓</Text>}
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.productChipName,
                          isSelected && { color: '#e2e8f0' },
                        ]}
                      >
                        {p.nombre}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>

          {/* FILTRO 2: SELECCIÓN DE ALMACÉN */}
          <View style={styles.filterSectionCard}>
            <Text style={styles.filterCardTitle}>ALMACÉN</Text>
            <View style={styles.chipsRow}>
              {/* Chip Todos */}
              <Pressable
                style={[
                  styles.filterChip,
                  filtroAlmacenId === 0 && styles.filterChipSelected,
                ]}
                onPress={() => {
                  void hapticImpact();
                  setFiltroAlmacenId(0);
                }}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    filtroAlmacenId === 0 && styles.filterChipTextSelected,
                  ]}
                >
                  🌐 Todos los Almacenes
                </Text>
              </Pressable>

              {/* Almacenes individuales */}
              {almacenesDisponibles.map((alm) => {
                const isSelected = filtroAlmacenId === alm.id_almacen;
                return (
                  <Pressable
                    key={alm.id_almacen}
                    style={[
                      styles.filterChip,
                      isSelected && styles.filterChipSelected,
                    ]}
                    onPress={() => {
                      void hapticImpact();
                      setFiltroAlmacenId(alm.id_almacen);
                    }}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        isSelected && styles.filterChipTextSelected,
                      ]}
                    >
                      {alm.nombre}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* FILTRO 3: RANGO DE FECHAS PARA MOVIMIENTOS */}
          <View style={styles.filterSectionCard}>
            <Text style={styles.filterCardTitle}>PERÍODO DE MOVIMIENTOS (KARDEX)</Text>
            <View style={styles.chipsRow}>
              {(
                [
                  { id: 'HOY', label: 'Hoy' },
                  { id: '7_DIAS', label: 'Últimos 7 días' },
                  { id: '30_DIAS', label: 'Últimos 30 días' },
                  { id: 'TODO', label: 'Todo el Historial' },
                ] as { id: FiltroFechaStock; label: string }[]
              ).map((f) => {
                const isSelected = filtroFecha === f.id;
                return (
                  <Pressable
                    key={f.id}
                    style={[
                      styles.filterChip,
                      isSelected && styles.filterChipSelected,
                    ]}
                    onPress={() => {
                      void hapticImpact();
                      setFiltroFecha(f.id);
                    }}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        isSelected && styles.filterChipTextSelected,
                      ]}
                    >
                      {f.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* ================================================================= */}
          {/* RESULTADO DEL STOCK Y KARDEX (MODO MANUAL)                        */}
          {/* ================================================================= */}
          {consultandoManual ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color="#00b4d8" />
              <Text style={styles.loadingTitle}>CONSULTANDO EXISTENCIAS Y KARDEX...</Text>
            </View>
          ) : resultadoManual ? (
            <View style={styles.resultCard}>
              {/* FICHA RESUMEN DEL PRODUCTO */}
              <View style={styles.resultHeader}>
                <View>
                  <Text style={styles.productSku}>
                    {resultadoManual.producto.sku}
                  </Text>
                  <Text style={styles.productCategory}>
                    {resultadoManual.producto.categoria?.toUpperCase() ?? 'SUMINISTROS'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.semaforoBadge,
                    resultadoManual.estado_semaforo_global === 'ROJO'
                      ? styles.semaforoRojo
                      : resultadoManual.estado_semaforo_global === 'AMARILLO'
                      ? styles.semaforoAmarillo
                      : styles.semaforoVerde,
                  ]}
                >
                  <Text style={styles.semaforoBadgeText}>
                    SEMÁFORO: {resultadoManual.estado_semaforo_global}
                  </Text>
                </View>
              </View>

              <Text style={styles.productName}>
                {resultadoManual.producto.nombre}
              </Text>

              {/* MÉTRICAS CONSOLIDADAS */}
              <View style={styles.manualStockBanner}>
                <View style={styles.manualStockCol}>
                  <Text style={styles.manualStockLabel}>
                    {filtroAlmacenId === 0
                      ? 'Stock Global Consolidado:'
                      : 'Stock en Almacén Filtrado:'}
                  </Text>
                  <Text style={styles.manualStockValue}>
                    {resultadoManual.stock_total}{' '}
                    <Text style={{ fontSize: 14, color: '#94a3b8' }}>
                      {resultadoManual.producto.unidad_medida}s
                    </Text>
                  </Text>
                </View>

                {/* Cálculo de paletas equivalentes */}
                {resultadoManual.producto.regla_empaque.unidades_por_caja > 0 && (
                  <View style={styles.manualEquivCol}>
                    <Text style={styles.manualEquivText}>
                      ~{Math.floor(
                        resultadoManual.stock_total /
                          (resultadoManual.producto.regla_empaque.cajas_por_paleta *
                            resultadoManual.producto.regla_empaque.unidades_por_caja)
                      )}{' '}
                      Paletas Estándar
                    </Text>
                    <Text style={styles.manualEquivSub}>
                      ({Math.floor(
                        resultadoManual.stock_total /
                          resultadoManual.producto.regla_empaque.unidades_por_caja
                      )}{' '}
                      cajas)
                    </Text>
                  </View>
                )}
              </View>

              {/* DESGLOSE POR ALMACÉN */}
              <Text style={[styles.sectionTitle, { marginTop: 14 }]}>
                🏢 EXISTENCIAS POR ALMACÉN:
              </Text>
              <View style={styles.warehouseListCard}>
                {resultadoManual.desglose_almacenes.map((d) => (
                  <View key={d.id_almacen} style={styles.warehouseRow}>
                    <View>
                      <Text style={styles.warehouseRowName}>{d.nombre_almacen}</Text>
                      <Text style={styles.warehouseRowMin}>
                        Mínimo req: {d.stock_minimo} u
                      </Text>
                    </View>
                    <View style={styles.warehouseRowRight}>
                      <Text style={styles.warehouseRowUnits}>
                        {d.stock_real} u
                      </Text>
                      <View
                        style={[
                          styles.miniSemaforo,
                          d.estado_semaforo === 'ROJO'
                            ? { backgroundColor: '#ef4444' }
                            : d.estado_semaforo === 'AMARILLO'
                            ? { backgroundColor: '#facc15' }
                            : { backgroundColor: '#22c55e' },
                        ]}
                      />
                    </View>
                  </View>
                ))}
              </View>

              {/* HISTORIAL DE MOVIMIENTOS EN EL PERÍODO */}
              <View style={styles.divider} />
              <View style={styles.kardexHeaderRow}>
                <Text style={styles.sectionTitle}>
                  📋 MOVIMIENTOS / KARDEX ({resultadoManual.movimientos.length}):
                </Text>
                <Text style={styles.kardexFilterTag}>Filtro: {filtroFecha}</Text>
              </View>

              {resultadoManual.movimientos.length === 0 ? (
                <View style={styles.emptyKardexCard}>
                  <Text style={styles.emptyKardexText}>
                    No se registran movimientos para este producto en el período y almacén seleccionados.
                  </Text>
                </View>
              ) : (
                resultadoManual.movimientos.map((m) => (
                  <View key={m.id_movimiento} style={styles.movementItemCard}>
                    <View style={styles.movementItemHeader}>
                      <View style={styles.movementTypeBadge}>
                        <Text style={styles.movementTypeText}>{m.tipo}</Text>
                      </View>
                      <Text style={styles.movementQtyText}>
                        +{m.cantidad_afectada} u
                      </Text>
                    </View>

                    <Text style={styles.movementReasonText}>
                      {m.motivo || 'Ingreso por recepción RFID'}
                    </Text>

                    <View style={styles.movementFooterRow}>
                      <Text style={styles.movementDestText}>
                        Destino: {m.almacen_destino}
                      </Text>
                      <Text style={styles.movementDateText}>
                        {new Date(m.fecha_hora).toLocaleDateString()} ·{' '}
                        {new Date(m.fecha_hora).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          ) : null}

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
      )}

      {/* =================================================================== */}
      {/* MODO 3: PALETAS EN BODEGA                                           */}
      {/* =================================================================== */}
      {tabActivo === 'PALETAS_BODEGA' && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshingPaletas}
              onRefresh={() => {
                setRefreshingPaletas(true);
                void cargarPaletas();
              }}
              tintColor="#00b4d8"
            />
          }
        >
          {/* BUSCADOR POR UID / SKU */}
          <View style={styles.filterSectionCard}>
            <Text style={styles.filterCardTitle}>BUSCADOR DE PALETAS</Text>
            <TextInput
              style={styles.searchProductInput}
              placeholder="Buscar por UID, SKU o nombre de producto..."
              placeholderTextColor="#64748b"
              value={busquedaPaleta}
              onChangeText={setBusquedaPaleta}
              autoCapitalize="characters"
            />

            {/* FILTROS: TODAS, COMPLETAS, PUCHOS */}
            <Text style={[styles.filterCardTitle, { marginTop: 12, marginBottom: 6 }]}>
              FILTRAR POR TIPO DE CARGA:
            </Text>
            <View style={styles.typePaletaRow}>
              {[
                { id: 'TODAS', label: `Todas (${paletasBodega.length})` },
                {
                  id: 'COMPLETO',
                  label: `Completas (${paletasBodega.filter((p) => p.tipo_paleta === 'COMPLETO').length})`,
                },
                {
                  id: 'PUCHO',
                  label: `Puchos (${paletasBodega.filter((p) => p.tipo_paleta === 'PUCHO').length})`,
                },
              ].map((f) => (
                <Pressable
                  key={f.id}
                  style={[
                    styles.typePaletaChip,
                    filtroTipoPaleta === f.id && styles.typePaletaChipActive,
                  ]}
                  onPress={() => {
                    void hapticImpact();
                    setFiltroTipoPaleta(f.id as any);
                  }}
                >
                  <Text
                    style={[
                      styles.typePaletaChipText,
                      filtroTipoPaleta === f.id && styles.typePaletaChipTextActive,
                    ]}
                  >
                    {f.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* LISTA DE PALETAS */}
          {loadingPaletas ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color="#00b4d8" />
              <Text style={styles.loadingTitle}>CARGANDO PALETAS EN BODEGA...</Text>
            </View>
          ) : paletasBodega.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyIcon}>📦</Text>
              <Text style={styles.emptyTitle}>No hay paletas encontradas</Text>
              <Text style={styles.emptySubtitle}>
                No se encontraron etiquetas RFID activas con los filtros seleccionados en este almacén.
              </Text>
            </View>
          ) : (
            paletasBodega.map((p) => {
              const esPucho = p.tipo_paleta === 'PUCHO';
              return (
                <View key={p.id_etiqueta} style={styles.paletaCard}>
                  <View style={styles.paletaCardHeader}>
                    <Text style={styles.paletaUidTag}>TAG: {p.uid_tag}</Text>
                    <View
                      style={[
                        styles.paletaTipoBadge,
                        esPucho ? styles.paletaBadgePucho : styles.paletaBadgeCompleto,
                      ]}
                    >
                      <Text
                        style={[
                          styles.paletaTipoBadgeText,
                          esPucho ? { color: '#f59e0b' } : { color: '#10b981' },
                        ]}
                      >
                        {esPucho ? '⚠️ PUCHO' : '✓ COMPLETA'}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.paletaSku}>{p.sku}</Text>
                  <Text style={styles.paletaNombre}>{p.nombre_producto}</Text>

                  <View style={styles.paletaStockRow}>
                    <View style={styles.paletaStockBox}>
                      <Text style={styles.paletaStockNum}>{p.cantidad_paquetes}</Text>
                      <Text style={styles.paletaStockLabel}>Cajas</Text>
                    </View>
                    <View style={styles.paletaStockBox}>
                      <Text style={styles.paletaStockNum}>{p.cantidad_actual}</Text>
                      <Text style={styles.paletaStockLabel}>
                        {p.unidad_medida}s ({p.unidades_por_caja} u/caja)
                      </Text>
                    </View>
                  </View>

                  <View style={styles.paletaFooter}>
                    <Text style={styles.paletaAlmacenText}>📍 {p.nombre_almacen}</Text>
                    <Pressable
                      style={styles.verDetalleBtn}
                      onPress={() => {
                        void hapticImpact();
                        setTabActivo('ESCANEAR_RFID');
                        setTagUidInput(p.uid_tag);
                        ejecutarConsultaRfid(p.uid_tag);
                      }}
                    >
                      <Text style={styles.verDetalleBtnText}>🔍 Inspeccionar ➔</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}

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
      )}
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
    paddingBottom: 14,
    backgroundColor: '#0d1322',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  warehouseChip: {
    backgroundColor: '#1e293b',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  warehouseChipText: {
    color: '#00b4d8',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#0b1120',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 10,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#131d33',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  tabButtonActive: {
    backgroundColor: '#00b4d8',
    borderColor: '#00b4d8',
  },
  tabButtonText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 'bold',
  },
  tabButtonTextActive: {
    color: '#ffffff',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  nfcAlertBanner: {
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    borderWidth: 1,
    borderColor: '#eab308',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  nfcAlertTitle: {
    color: '#facc15',
    fontWeight: 'bold',
    fontSize: 12,
    marginBottom: 4,
  },
  nfcAlertDesc: {
    color: '#cbd5e1',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 10,
  },
  openNfcBtn: {
    backgroundColor: '#eab308',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  openNfcBtnText: {
    color: '#0f172a',
    fontWeight: 'bold',
    fontSize: 12,
  },
  sensorCard: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#00b4d8',
    padding: 18,
    alignItems: 'center',
    marginBottom: 16,
  },
  sensorIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  sensorTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 6,
  },
  sensorDesc: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
    marginBottom: 16,
  },
  inputRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 8,
    marginBottom: 12,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  consultarBtn: {
    backgroundColor: '#00b4d8',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  consultarBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  demoButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    justifyContent: 'center',
  },
  simButton: {
    backgroundColor: '#1e293b',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  simButtonText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: 'bold',
  },
  clearButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  clearButtonText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: 'bold',
  },
  loadingCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  loadingTitle: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
    marginTop: 12,
    marginBottom: 4,
  },
  loadingDesc: {
    color: '#94a3b8',
    fontSize: 11,
    textAlign: 'center',
  },
  errorCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ef4444',
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  errorIcon: {
    fontSize: 28,
    marginBottom: 6,
  },
  errorTitle: {
    color: '#ef4444',
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 4,
  },
  errorText: {
    color: '#cbd5e1',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 12,
  },
  goToRecepcionBtn: {
    backgroundColor: '#ef4444',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  goToRecepcionBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  resultCard: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 18,
    marginBottom: 16,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  productSku: {
    color: '#00b4d8',
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  productCategory: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  statusTagBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  statusBadgeActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  statusBadgeInactive: {
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    borderWidth: 1,
    borderColor: '#64748b',
  },
  statusTagText: {
    color: '#4ade80',
    fontSize: 11,
    fontWeight: 'bold',
  },
  productName: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  productDescription: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 17,
  },
  divider: {
    height: 1,
    backgroundColor: '#1e293b',
    marginVertical: 14,
  },
  sectionTitle: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  tagHighlightCard: {
    backgroundColor: '#131d33',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#203354',
  },
  tagTypeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  tagTypeBadge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  badgeCompleto: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  badgePucho: {
    backgroundColor: 'rgba(234, 179, 8, 0.2)',
    borderWidth: 1,
    borderColor: '#eab308',
  },
  tagTypeBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  tagUidLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  metricGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 8,
  },
  metricItem: {
    alignItems: 'center',
  },
  metricNumber: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  metricLabel: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  metricDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#334155',
  },
  orderAttachedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#203354',
    paddingTop: 8,
    marginTop: 6,
  },
  orderAttachedLabel: {
    color: '#64748b',
    fontSize: 11,
  },
  orderAttachedValue: {
    color: '#00b4d8',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  stockSummaryCard: {
    backgroundColor: '#0a101f',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    color: '#94a3b8',
    fontSize: 12,
  },
  infoVal: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '500',
  },
  infoValHighlight: {
    color: '#00b4d8',
    fontSize: 13,
    fontWeight: 'bold',
  },
  semaforoBadge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  semaforoVerde: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  semaforoAmarillo: {
    backgroundColor: 'rgba(234, 179, 8, 0.2)',
    borderWidth: 1,
    borderColor: '#eab308',
  },
  semaforoRojo: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  semaforoBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  scanNextBtn: {
    backgroundColor: '#00b4d8',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  scanNextBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  backButton: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  backButtonText: {
    color: '#94a3b8',
    fontWeight: 'bold',
    fontSize: 13,
  },

  // ---------------------------------------------------------------------------
  // ESTILOS - FASE 2: CATÁLOGO Y FILTROS MANUALES
  // ---------------------------------------------------------------------------
  filterSectionCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 14,
  },
  filterCardTitle: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  searchProductInput: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#ffffff',
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  productsHorizontalScroll: {
    flexDirection: 'row',
  },
  productChipCard: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 10,
    marginRight: 10,
    width: 170,
  },
  productChipCardSelected: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  productChipHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  productChipSku: {
    color: '#00b4d8',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  checkIcon: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  productChipName: {
    color: '#94a3b8',
    fontSize: 11,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    backgroundColor: '#1e293b',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  filterChipSelected: {
    backgroundColor: 'rgba(0, 180, 216, 0.2)',
    borderColor: '#00b4d8',
  },
  filterChipText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  filterChipTextSelected: {
    color: '#00b4d8',
    fontWeight: 'bold',
  },
  manualStockBanner: {
    backgroundColor: '#131d33',
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#203354',
  },
  manualStockCol: {
    flex: 1,
  },
  manualStockLabel: {
    color: '#94a3b8',
    fontSize: 11,
    marginBottom: 4,
  },
  manualStockValue: {
    color: '#4ade80',
    fontSize: 24,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  manualEquivCol: {
    alignItems: 'flex-end',
  },
  manualEquivText: {
    color: '#00b4d8',
    fontSize: 12,
    fontWeight: 'bold',
  },
  manualEquivSub: {
    color: '#64748b',
    fontSize: 11,
  },
  warehouseListCard: {
    backgroundColor: '#0a101f',
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  warehouseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    paddingBottom: 6,
  },
  warehouseRowName: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  warehouseRowMin: {
    color: '#64748b',
    fontSize: 10,
  },
  warehouseRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  warehouseRowUnits: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  miniSemaforo: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  kardexHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  kardexFilterTag: {
    color: '#00b4d8',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  emptyKardexCard: {
    backgroundColor: '#0a101f',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  emptyKardexText: {
    color: '#64748b',
    fontSize: 11,
    textAlign: 'center',
  },
  movementItemCard: {
    backgroundColor: '#131d33',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  movementItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  movementTypeBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  movementTypeText: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: 'bold',
  },
  movementQtyText: {
    color: '#4ade80',
    fontSize: 13,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  movementReasonText: {
    color: '#e2e8f0',
    fontSize: 11,
    marginBottom: 6,
  },
  movementFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingTop: 4,
  },
  movementDestText: {
    color: '#94a3b8',
    fontSize: 10,
  },
  movementDateText: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'monospace',
  },

  // ---------------------------------------------------------------------------
  // ESTILOS - MODO 3: PALETAS EN BODEGA
  // ---------------------------------------------------------------------------
  typePaletaRow: {
    flexDirection: 'row',
    gap: 8,
  },
  typePaletaChip: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  typePaletaChipActive: {
    backgroundColor: '#00b4d8',
    borderColor: '#00b4d8',
  },
  typePaletaChipText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: 'bold',
  },
  typePaletaChipTextActive: {
    color: '#ffffff',
  },
  emptyCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 24,
    alignItems: 'center',
    marginTop: 10,
  },
  emptyIcon: {
    fontSize: 32,
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
  paletaCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 14,
    marginBottom: 12,
  },
  paletaCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  paletaUidTag: {
    color: '#00b4d8',
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  paletaTipoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  paletaBadgeCompleto: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10b981',
  },
  paletaBadgePucho: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: '#f59e0b',
  },
  paletaTipoBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  paletaSku: {
    color: '#f59e0b',
    fontSize: 13,
    fontWeight: 'bold',
    marginTop: 2,
  },
  paletaNombre: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  paletaStockRow: {
    flexDirection: 'row',
    backgroundColor: '#090d16',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    gap: 12,
  },
  paletaStockBox: {
    flex: 1,
    alignItems: 'center',
  },
  paletaStockNum: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  paletaStockLabel: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  paletaFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  paletaAlmacenText: {
    color: '#64748b',
    fontSize: 11,
  },
  verDetalleBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  verDetalleBtnText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: 'bold',
  },
});
