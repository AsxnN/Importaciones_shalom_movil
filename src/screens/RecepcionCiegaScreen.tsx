import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import {
  Almacen,
  ConciliacionResultado,
  LecturaRFID,
  OrdenRecepcion,
  SesionPausada,
} from '../types';
import {
  hapticError,
  hapticImpact,
  hapticSuccess,
  hapticWarning,
} from '../lib/haptics';
import {
  DEFAULT_ORDERS,
  conciliarRecepcionEnSupabase,
  fetchProductosDesdeSupabase,
  getSesionOperario,
} from '../services/recepcion';
import {
  clearActiveSession,
  getActiveSession,
  saveActiveSession,
} from '../services/storage';
import {
  startNfcSession,
  stopNfcSession,
  isNfcSupported,
  isNfcEnabled,
  openNfcSettings,
  formatTagUid,
} from '../lib/nfc';
import { supabase } from '../lib/supabase';

interface Props {
  almacen: Almacen;
  onBackToMenu: () => void;
  onRefreshColaCount?: () => void;
}

/**
 * 4 Vistas Obligatorias del Módulo 3:
 * 1. VISTA_1_ORDEN: Selección de producto y orden desde Supabase
 * 2. VISTA_2_LECTURA_RFID: Escaneo tag por tag con NFC del móvil (Paleta Completa vs Pucho)
 * 3. VISTA_3_CONCILIACION: Recuento físico de paletas, puchos, cajas y unidades
 * 4. VISTA_4_SUPABASE: Subida a la nube y confirmación con fecha/hora
 */
type VistaM3 =
  | 'VISTA_1_ORDEN'
  | 'VISTA_2_LECTURA_RFID'
  | 'VISTA_3_CONCILIACION'
  | 'VISTA_4_SUPABASE';

type TipoCarga = 'PALETA_COMPLETA' | 'PUCHO';

export function RecepcionCiegaScreen({
  almacen,
  onBackToMenu,
  onRefreshColaCount,
}: Props) {
  // 1. Navegación entre las 4 vistas
  const [vistaActual, setVistaActual] = useState<VistaM3>('VISTA_1_ORDEN');

  // 2. Catálogo de productos y órdenes obtenidos desde Supabase
  const [productos, setProductos] = useState<OrdenRecepcion[]>(DEFAULT_ORDERS);
  const [productoSeleccionado, setProductoSeleccionado] = useState<OrdenRecepcion>(DEFAULT_ORDERS[0]);
  const [loadingProductos, setLoadingProductos] = useState(false);

  // 3. Sesión pausada en almacenamiento local
  const [sesionPausada, setSesionPausada] = useState<SesionPausada | null>(null);

  // 4. Operario autenticado
  const [operarioEmail, setOperarioEmail] = useState<string | null>(null);

  // 5. Estado de hardware NFC del móvil
  const [nfcDisponible, setNfcDisponible] = useState(false);
  const [nfcEncendido, setNfcEncendido] = useState(true);
  const [escuchandoNfc, setEscuchandoNfc] = useState(false);

  // 6. Buffer de lecturas RFID en memoria
  const [lecturas, setLecturas] = useState<LecturaRFID[]>([]);
  const [paletasCompletas, setPaletasCompletas] = useState(0);
  const [paquetesPuchos, setPaquetesPuchos] = useState(0);

  // 7. Modal de clasificación para el Tag recién detectado
  const [tagPendienteUid, setTagPendienteUid] = useState<string | null>(null);
  const [tipoCargaModal, setTipoCargaModal] = useState<TipoCarga>('PALETA_COMPLETA');
  const [puchoCajasModal, setPuchoCajasModal] = useState(1);

  // 8. Alerta modal para Tag Repetido
  const [tagRepetidoAlerta, setTagRepetidoAlerta] = useState<{
    uid: string;
    detallePrevia: string;
  } | null>(null);

  // 9. Input manual / de respaldo para escáneres de código
  const [manualInput, setManualInput] = useState('');

  // 10. Estados de subida a Supabase (Vista 4)
  const [subiendo, setSubiendo] = useState(false);
  const [resultadoConciliacion, setResultadoConciliacion] = useState<ConciliacionResultado | null>(null);
  const [fechaHoraRegistro, setFechaHoraRegistro] = useState<string | null>(null);
  const [guardadoOffline, setGuardadoOffline] = useState(false);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  // ---------------------------------------------------------------------------
  // CARGA INICIAL (VISTA 1)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    isMountedRef.current = true;

    async function init() {
      try {
        setLoadingProductos(true);
        const [prods, paused, email, hasNfc, isEnabled] = await Promise.all([
          fetchProductosDesdeSupabase().catch((err) => {
            console.warn('[VISTA 1] Fallo consultando productos:', err);
            return DEFAULT_ORDERS;
          }),
          getActiveSession().catch(() => null),
          getSesionOperario().catch(() => null),
          isNfcSupported().catch(() => false),
          isNfcEnabled().catch(() => false),
        ]);

        if (isMountedRef.current) {
          const listaProductos = prods && prods.length > 0 ? prods : DEFAULT_ORDERS;
          setProductos(listaProductos);
          setProductoSeleccionado(listaProductos[0]);

          if (paused) setSesionPausada(paused);
          if (email) setOperarioEmail(email);
          setNfcDisponible(Boolean(hasNfc));
          setNfcEncendido(Boolean(isEnabled));
        }
      } catch (err) {
        console.warn('[VISTA 1] Error en carga inicial:', err);
        if (isMountedRef.current) {
          setProductos(DEFAULT_ORDERS);
          setProductoSeleccionado(DEFAULT_ORDERS[0]);
        }
      } finally {
        if (isMountedRef.current) {
          setLoadingProductos(false);
        }
      }
    }

    void init();

    return () => {
      isMountedRef.current = false;
      void stopNfcSession();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // MANEJO DE SESIÓN PAUSADA
  // ---------------------------------------------------------------------------
  const handleReanudarSesion = () => {
    if (!sesionPausada) return;
    void hapticSuccess();
    setProductoSeleccionado(sesionPausada.orden);
    setPaletasCompletas(sesionPausada.total_paletas_completas);
    setPaquetesPuchos(sesionPausada.total_paquetes_puchos);
    setLecturas(sesionPausada.lecturas);
    setVistaActual('VISTA_2_LECTURA_RFID');
  };

  const handleDescartarSesionPausada = async () => {
    void hapticImpact();
    await clearActiveSession();
    setSesionPausada(null);
  };

  const handleIniciarNuevaSesion = () => {
    void hapticImpact();
    setLecturas([]);
    setPaletasCompletas(0);
    setPaquetesPuchos(0);
    setVistaActual('VISTA_2_LECTURA_RFID');
  };

  // ---------------------------------------------------------------------------
  // CONTROL DE LECTURA NFC (VISTA 2)
  // ---------------------------------------------------------------------------
  const procesarTagDetectado = useCallback(
    async (rawUid: string) => {
      const cleanUid = formatTagUid(rawUid);
      if (!cleanUid) return;

      // Si el operario ya tiene un modal abierto de clasificación o alerta, evitar solapamiento
      if (tagPendienteUid !== null || tagRepetidoAlerta !== null) {
        return;
      }

      // VALIDACIÓN 1: ¿EL TAG YA FUE REGISTRADO PREVIAMENTE EN ESTA MISMA SESIÓN?
      const yaExisteEnSesion = lecturas.find((l) => l.uid === cleanUid);
      if (yaExisteEnSesion) {
        void hapticWarning();
        const detalle =
          yaExisteEnSesion.tipo === 'COMPLETO'
            ? `Paleta Completa (${productoSeleccionado.regla_empaque.cajas_por_paleta} cajas)`
            : `Pucho (${yaExisteEnSesion.cantidad_paquetes} cajas sueltas)`;

        setTagRepetidoAlerta({
          uid: cleanUid,
          detallePrevia: detalle,
        });
        return;
      }

      // VALIDACIÓN 2: ¿EL TAG YA EXISTE Y ESTÁ ACTIVO EN EL SISTEMA (CUALQUIER PRODUCTO/ALMACÉN)?
      // Búsqueda puntual ultrarrápida usando el índice B-Tree (solo consulta 1 registro, < 50ms)
      try {
        const { data: tagActivo } = await supabase
          .from('etiqueta_rfid')
          .select('uid_tag, estado, id_producto, producto:id_producto(sku, nombre), almacen:id_almacen_actual(nombre)')
          .eq('uid_tag', cleanUid)
          .eq('estado', 'ACTIVA')
          .maybeSingle();

        if (tagActivo) {
          void hapticError();
          const prod = tagActivo.producto as any;
          const alm = tagActivo.almacen as any;
          const detalle = `Ya está activo en ${alm?.nombre ?? 'el almacén'} asignado a: ${prod?.sku ?? 'otro producto'} (${prod?.nombre ?? ''}). El RFID es único y no puede reutilizarse.`;

          setTagRepetidoAlerta({
            uid: cleanUid,
            detallePrevia: detalle,
          });
          return;
        }
      } catch (checkErr) {
        // En caso de estar sin conexión a la base de datos, continúa al modal y la unicidad
        // se garantizará atómicamente en la RPC al sincronizar.
        console.warn('[RFID] Verificación previa de unicidad omitida por red:', checkErr);
      }

      // TAG NUEVO: Abrir modal de decisión para asignar Paleta Completa o Pucho
      void hapticSuccess();
      setTagPendienteUid(cleanUid);
      setTipoCargaModal('PALETA_COMPLETA');
      setPuchoCajasModal(1);
    },
    [lecturas, productoSeleccionado.regla_empaque.cajas_por_paleta, tagPendienteUid, tagRepetidoAlerta]
  );

  // Ref dinámico para que el listener persistente de NFC siempre invoque el estado fresco
  // sin necesidad de cancelar y reiniciar la antena hardware en cada lectura
  const procesarTagRef = useRef(procesarTagDetectado);
  useEffect(() => {
    procesarTagRef.current = procesarTagDetectado;
  });

  // Iniciar / detener escucha NFC continua en la Vista 2
  useEffect(() => {
    let cancelScan: (() => void) | null = null;

    if (vistaActual === 'VISTA_2_LECTURA_RFID') {
      setEscuchandoNfc(true);
      void startNfcSession((uid) => {
        if (procesarTagRef.current) {
          procesarTagRef.current(uid);
        }
      }).then((canceller) => {
        cancelScan = canceller;
      });
    } else {
      setEscuchandoNfc(false);
      void stopNfcSession();
    }

    return () => {
      if (cancelScan) cancelScan();
      void stopNfcSession();
    };
  }, [vistaActual]);

  // Confirmar tag desde el modal de elección
  const handleConfirmarClasificacionTag = () => {
    if (!tagPendienteUid) return;

    const timestamp = new Date().toISOString();

    if (tipoCargaModal === 'PALETA_COMPLETA') {
      const nueva: LecturaRFID = {
        uid: tagPendienteUid,
        tipo: 'COMPLETO',
        cantidad_paquetes: 0,
        timestamp,
      };
      setLecturas((prev) => [nueva, ...prev]);
      setPaletasCompletas((prev) => prev + 1);
    } else {
      const nueva: LecturaRFID = {
        uid: tagPendienteUid,
        tipo: 'PUCHO',
        cantidad_paquetes: puchoCajasModal,
        timestamp,
      };
      setLecturas((prev) => [nueva, ...prev]);
      setPaquetesPuchos((prev) => prev + puchoCajasModal);
    }

    void hapticSuccess();
    setTagPendienteUid(null);
    // Nota: El listener continuo de NFC sigue activo en segundo plano, listo para el siguiente tag
  };

  // Descartar lectura errónea individual del buffer
  const handleEliminarTag = (index: number) => {
    void hapticImpact();
    const item = lecturas[index];
    if (!item) return;

    if (item.tipo === 'COMPLETO') {
      setPaletasCompletas((prev) => Math.max(0, prev - 1));
    } else {
      setPaquetesPuchos((prev) => Math.max(0, prev - item.cantidad_paquetes));
    }

    setLecturas((prev) => prev.filter((_, i) => i !== index));
  };

  // Simulación para pruebas de campo sin tag físico
  const handleSimularLecturaTag = () => {
    const correlativo = lecturas.length + 1;
    const uidSimulado = `TAG-04A23B${String(correlativo).padStart(3, '0')}`;
    procesarTagDetectado(uidSimulado);
  };

  // Pausar recepción en almacenamiento local
  const handlePausarRecepcion = async () => {
    void hapticWarning();
    const sesion: SesionPausada = {
      orden: productoSeleccionado,
      id_almacen: almacen.id_almacen,
      lecturas,
      total_paletas_completas: paletasCompletas,
      total_paquetes_puchos: paquetesPuchos,
      pausado_en: new Date().toISOString(),
    };

    await saveActiveSession(sesion);
    Alert.alert(
      '⏸️ Recepción Pausada',
      `Se han guardado ${paletasCompletas} paletas y ${paquetesPuchos} cajas de pucho (${lecturas.length} tags) en la terminal. Podrá reanudar en cualquier momento.`,
      [{ text: 'Aceptar', onPress: () => onBackToMenu() }]
    );
  };

  // ---------------------------------------------------------------------------
  // SUBIDA Y REGISTRO EN SUPABASE (VISTA 4)
  // ---------------------------------------------------------------------------
  const handleConfirmarYSubirASupabase = async () => {
    if (lecturas.length === 0) {
      void hapticError();
      Alert.alert('Sin Lecturas', 'Debe leer al menos una etiqueta RFID para conciliar.');
      return;
    }

    setVistaActual('VISTA_4_SUPABASE');
    setSubiendo(true);
    setErrorSubida(null);
    setResultadoConciliacion(null);
    setGuardadoOffline(false);
    setFechaHoraRegistro(new Date().toLocaleString());

    try {
      const res = await conciliarRecepcionEnSupabase({
        id_orden: productoSeleccionado.id_orden,
        numero_orden: productoSeleccionado.numero_orden,
        id_producto: productoSeleccionado.id_producto,
        sku: productoSeleccionado.sku,
        id_almacen: almacen.id_almacen,
        lecturas,
        paletas_completas: paletasCompletas,
        paquetes_puchos: paquetesPuchos,
      });

      await clearActiveSession();
      if (onRefreshColaCount) onRefreshColaCount();

      if (res.success && res.resultado) {
        void hapticSuccess();
        setResultadoConciliacion(res.resultado);
        setGuardadoOffline(false);
      } else {
        void hapticWarning();
        setGuardadoOffline(true);
        setErrorSubida(res.error ?? 'Sin conexión directa a la base de datos de Supabase.');
      }
    } catch (err: any) {
      void hapticError();
      setErrorSubida(err?.message ?? 'Fallo de transmisión');
      setGuardadoOffline(true);
    } finally {
      setSubiendo(false);
    }
  };

  // ---------------------------------------------------------------------------
  // BARRA DE PASOS VISUAL (STEPPER)
  // ---------------------------------------------------------------------------
  const renderStepper = () => (
    <View style={styles.stepperNav}>
      <View style={[styles.stepItem, vistaActual === 'VISTA_1_ORDEN' && styles.stepItemActive]}>
        <Text style={[styles.stepNumber, vistaActual === 'VISTA_1_ORDEN' && styles.stepNumberActive]}>1</Text>
        <Text style={[styles.stepLabel, vistaActual === 'VISTA_1_ORDEN' && styles.stepLabelActive]}>Orden</Text>
      </View>
      <Text style={styles.stepArrow}>➔</Text>

      <View style={[styles.stepItem, vistaActual === 'VISTA_2_LECTURA_RFID' && styles.stepItemActive]}>
        <Text style={[styles.stepNumber, vistaActual === 'VISTA_2_LECTURA_RFID' && styles.stepNumberActive]}>2</Text>
        <Text style={[styles.stepLabel, vistaActual === 'VISTA_2_LECTURA_RFID' && styles.stepLabelActive]}>Lectura RFID</Text>
      </View>
      <Text style={styles.stepArrow}>➔</Text>

      <View style={[styles.stepItem, vistaActual === 'VISTA_3_CONCILIACION' && styles.stepItemActive]}>
        <Text style={[styles.stepNumber, vistaActual === 'VISTA_3_CONCILIACION' && styles.stepNumberActive]}>3</Text>
        <Text style={[styles.stepLabel, vistaActual === 'VISTA_3_CONCILIACION' && styles.stepLabelActive]}>Conciliación</Text>
      </View>
      <Text style={styles.stepArrow}>➔</Text>

      <View style={[styles.stepItem, vistaActual === 'VISTA_4_SUPABASE' && styles.stepItemActive]}>
        <Text style={[styles.stepNumber, vistaActual === 'VISTA_4_SUPABASE' && styles.stepNumberActive]}>4</Text>
        <Text style={[styles.stepLabel, vistaActual === 'VISTA_4_SUPABASE' && styles.stepLabelActive]}>Supabase</Text>
      </View>
    </View>
  );

  // ===========================================================================
  // VISTA 1: ORDEN Y SELECCIÓN DE PRODUCTO (DESDE SUPABASE)
  // ===========================================================================
  if (vistaActual === 'VISTA_1_ORDEN') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerEyebrow}>MÓDULO 3 · VISTA 1 DE 4</Text>
            <Text style={styles.headerTitle}>Selección de Producto y Orden</Text>
          </View>
          <View style={styles.warehouseChip}>
            <Text style={styles.warehouseChipText}>{almacen.nombre}</Text>
          </View>
        </View>

        {renderStepper()}

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {/* Alerta de Sesión Pausada Previa */}
          {sesionPausada && (
            <View style={styles.pausedBanner}>
              <Text style={styles.pausedBannerTitle}>⚠️ SESIÓN PAUSADA ENCONTRADA</Text>
              <Text style={styles.pausedBannerText}>
                Orden: {sesionPausada.orden.numero_orden} · {sesionPausada.orden.sku}
              </Text>
              <Text style={styles.pausedBannerDetail}>
                Progreso guardado: {sesionPausada.total_paletas_completas} Paletas · {sesionPausada.total_paquetes_puchos} Puchos ({sesionPausada.lecturas.length} tags)
              </Text>
              <View style={styles.pausedButtonsRow}>
                <Pressable style={styles.resumeButton} onPress={handleReanudarSesion}>
                  <Text style={styles.resumeButtonText}>Reanudar Sesión ➔</Text>
                </Pressable>
                <Pressable style={styles.discardButton} onPress={handleDescartarSesionPausada}>
                  <Text style={styles.discardButtonText}>Descartar</Text>
                </Pressable>
              </View>
            </View>
          )}

          <Text style={styles.sectionHeader}>PRODUCTOS DISPONIBLES EN SUPABASE:</Text>
          {loadingProductos ? (
            <ActivityIndicator color="#00b4d8" style={{ marginVertical: 20 }} />
          ) : (
            productos.map((prod) => {
              const isSelected = prod.id_producto === productoSeleccionado.id_producto;
              return (
                <Pressable
                  key={`${prod.id_orden}_${prod.id_producto}`}
                  style={[styles.productCard, isSelected && styles.productCardSelected]}
                  onPress={() => {
                    void hapticImpact();
                    setProductoSeleccionado(prod);
                  }}
                >
                  <View style={styles.productCardHeader}>
                    <Text style={[styles.orderNumber, isSelected && { color: '#ffffff' }]}>
                      {prod.numero_orden}
                    </Text>
                    <View style={styles.skuBadge}>
                      <Text style={styles.skuBadgeText}>{prod.sku}</Text>
                    </View>
                  </View>
                  <Text style={styles.productName}>{prod.nombre_producto}</Text>
                  <Text style={styles.productDetail}>
                    Estiba: {prod.regla_empaque.cajas_por_paleta} cajas/paleta ({prod.regla_empaque.unidades_por_caja} unid/caja)
                  </Text>
                </Pressable>
              );
            })
          )}

          {/* Ficha de Estiba del Producto Seleccionado */}
          <View style={styles.specCard}>
            <Text style={styles.specTitle}>REGLA DE ESTIBADO (DATOS DE SUPABASE)</Text>
            <View style={styles.specRow}>
              <Text style={styles.specLabel}>Cajas por Paleta Completa:</Text>
              <Text style={styles.specValue}>{productoSeleccionado.regla_empaque.cajas_por_paleta} cajas</Text>
            </View>
            <View style={styles.specRow}>
              <Text style={styles.specLabel}>Unidades por Caja:</Text>
              <Text style={styles.specValue}>{productoSeleccionado.regla_empaque.unidades_por_caja} unid/caja</Text>
            </View>
            <View style={styles.specRow}>
              <Text style={styles.specLabel}>Total Unidades por Paleta:</Text>
              <Text style={[styles.specValue, { color: '#00b4d8' }]}>
                {productoSeleccionado.regla_empaque.cajas_por_paleta * productoSeleccionado.regla_empaque.unidades_por_caja} unidades
              </Text>
            </View>
          </View>

          <Pressable style={styles.primaryActionButton} onPress={handleIniciarNuevaSesion}>
            <Text style={styles.primaryActionButtonText}>
              AVANZAR A LECTURA RFID (PASO 2) ➔
            </Text>
          </Pressable>

          <Pressable style={styles.secondaryButton} onPress={onBackToMenu}>
            <Text style={styles.secondaryButtonText}>Volver al Menú Principal</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ===========================================================================
  // VISTA 2: LECTURA RFID (UNO POR UNO CON NFC DEL MÓVIL)
  // ===========================================================================
  if (vistaActual === 'VISTA_2_LECTURA_RFID') {
    const totalCajasEst =
      paletasCompletas * productoSeleccionado.regla_empaque.cajas_por_paleta + paquetesPuchos;

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerEyebrow}>VISTA 2 · LECTURA RFID</Text>
            <Text style={styles.headerTitle}>{productoSeleccionado.sku}</Text>
          </View>
          <View style={styles.nfcRadarBadge}>
            <View
              style={[
                styles.pulsingDot,
                nfcDisponible
                  ? escuchandoNfc && { backgroundColor: '#4ade80' }
                  : { backgroundColor: '#f59e0b' },
              ]}
            />
            <Text
              style={[
                styles.nfcRadarText,
                nfcDisponible
                  ? escuchandoNfc && { color: '#4ade80' }
                  : { color: '#f59e0b' },
              ]}
            >
              {nfcDisponible
                ? escuchandoNfc
                  ? 'NFC ACTIVO'
                  : 'NFC EN ESPERA'
                : 'MODO SIMULACIÓN'}
            </Text>
          </View>
        </View>

        {renderStepper()}

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {/* CONTADORES EN TIEMPO REAL */}
          <View style={styles.counterDashboard}>
            <View style={styles.counterBox}>
              <Text style={styles.counterLabel}>PALETAS COMPLETAS</Text>
              <Text style={styles.counterNumber}>{paletasCompletas}</Text>
              <Text style={styles.counterSub}>
                ~{paletasCompletas * productoSeleccionado.regla_empaque.cajas_por_paleta} Cajas
              </Text>
            </View>

            <View style={[styles.counterBox, { borderColor: '#facc15' }]}>
              <Text style={[styles.counterLabel, { color: '#facc15' }]}>CAJAS DE PUCHOS</Text>
              <Text style={[styles.counterNumber, { color: '#facc15' }]}>{paquetesPuchos}</Text>
              <Text style={styles.counterSub}>Cajas Sueltas</Text>
            </View>
          </View>

          {/* AVISO SI EL NFC ESTÁ APAGADO EN EL SISTEMA */}
          {!nfcEncendido && nfcDisponible && (
            <View style={styles.nfcDisabledBanner}>
              <Text style={styles.nfcDisabledTitle}>⚠️ SENSOR NFC APAGADO EN EL TELÉFONO</Text>
              <Text style={styles.nfcDisabledDesc}>
                El chip NFC está desactivado en los ajustes de su sistema. Debe encenderlo para detectar las etiquetas RFID con su smartphone.
              </Text>
              <Pressable
                style={styles.openNfcBtn}
                onPress={async () => {
                  void hapticImpact();
                  await openNfcSettings();
                  const enabled = await isNfcEnabled();
                  setNfcEncendido(enabled);
                }}
              >
                <Text style={styles.openNfcBtnText}>⚙️ Abrir Ajustes de NFC en el Móvil</Text>
              </Pressable>
            </View>
          )}

          {/* ÁREA SENSORIAL NFC */}
          <View style={styles.nfcSensorialCard}>
            <Text style={styles.nfcSensorialIcon}>📡</Text>
            <Text style={styles.nfcSensorialTitle}>ESPERANDO APROXIMACIÓN DE ETIQUETA RFID</Text>
            <Text style={styles.nfcSensorialDesc}>
              Acerque el tag al reverso del móvil para leer su UID automáticamente mediante el chip NFC del teléfono.
            </Text>

            <View style={styles.simButtonsRow}>
              <Pressable style={styles.simBtn} onPress={handleSimularLecturaTag}>
                <Text style={styles.simBtnText}>⚡ Simular Tag RFID</Text>
              </Pressable>
            </View>
          </View>

          {/* ENTRADA MANUAL O DE ESCÁNER WEDGE DE RESPALDO */}
          <View style={styles.manualScanRow}>
            <TextInput
              style={styles.manualInput}
              placeholder="O ingrese UID de tag manualmente..."
              placeholderTextColor="#64748b"
              value={manualInput}
              onChangeText={setManualInput}
              autoCapitalize="characters"
              onSubmitEditing={(e) => {
                if (e.nativeEvent.text.trim()) {
                  procesarTagDetectado(e.nativeEvent.text.trim());
                  setManualInput('');
                }
              }}
            />
            <Pressable
              style={styles.manualBtn}
              onPress={() => {
                if (manualInput.trim()) {
                  procesarTagDetectado(manualInput.trim());
                  setManualInput('');
                }
              }}
            >
              <Text style={styles.manualBtnText}>Leer</Text>
            </Pressable>
          </View>

          {/* LISTA ACTUAL DE TODOS LOS TAGS RFID AGREGADOS */}
          <View style={styles.bufferHeaderRow}>
            <Text style={styles.sectionHeader}>
              HISTORIAL DE TAGS LEÍDOS ({lecturas.length} tags):
            </Text>
            <Text style={styles.totalCajasTag}>~{totalCajasEst} cajas acumuladas</Text>
          </View>

          {lecturas.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No se han registrado etiquetas todavía. Aproxime un tag RFID a la parte posterior del smartphone para comenzar.
              </Text>
            </View>
          ) : (
            <View style={styles.tagsContainer}>
              {lecturas.map((item, idx) => {
                const esCompleto = item.tipo === 'COMPLETO';
                const cajasItem = esCompleto
                  ? productoSeleccionado.regla_empaque.cajas_por_paleta
                  : item.cantidad_paquetes;
                const unidadesItem = cajasItem * productoSeleccionado.regla_empaque.unidades_por_caja;

                return (
                  <View key={`${item.uid}_${idx}`} style={styles.tagItemRow}>
                    <View style={styles.tagItemLeft}>
                      <Text style={styles.tagItemIndex}>#{lecturas.length - idx}</Text>
                      <View>
                        <Text style={styles.tagItemUid}>{item.uid}</Text>
                        <Text style={styles.tagItemTime}>
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.tagItemRight}>
                      <View
                        style={[
                          styles.tagItemBadge,
                          {
                            backgroundColor: esCompleto
                              ? 'rgba(34, 197, 94, 0.15)'
                              : 'rgba(234, 179, 8, 0.15)',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.tagItemBadgeText,
                            { color: esCompleto ? '#4ade80' : '#facc15' },
                          ]}
                        >
                          {esCompleto
                            ? `PALETA COMPLETA (${cajasItem} cjs)`
                            : `PUCHO (${cajasItem} cjs)`}
                        </Text>
                        <Text style={styles.tagItemUnits}>
                          {unidadesItem} unid
                        </Text>
                      </View>

                      <Pressable
                        style={styles.deleteBtn}
                        onPress={() => handleEliminarTag(idx)}
                      >
                        <Text style={styles.deleteBtnText}>✕</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* BOTONES DE AVANCE Y PAUSA */}
          <Pressable
            style={[
              styles.primaryActionButton,
              lecturas.length === 0 && { opacity: 0.5 },
            ]}
            onPress={() => {
              if (lecturas.length === 0) {
                void hapticWarning();
                Alert.alert('Sin Lecturas', 'Debe leer al menos una etiqueta RFID antes de conciliar.');
                return;
              }
              void hapticImpact();
              setVistaActual('VISTA_3_CONCILIACION');
            }}
          >
            <Text style={styles.primaryActionButtonText}>
              CONTINUAR A CONCILIACIÓN (PASO 3) ➔
            </Text>
          </Pressable>

          <Pressable style={styles.pauseButton} onPress={handlePausarRecepcion}>
            <Text style={styles.pauseButtonText}>⏸️ Pausar Sesión en Terminal</Text>
          </Pressable>

          <Pressable
            style={styles.secondaryButton}
            onPress={() => {
              void hapticImpact();
              setVistaActual('VISTA_1_ORDEN');
            }}
          >
            <Text style={styles.secondaryButtonText}>⬅ Volver a Selección de Producto</Text>
          </Pressable>
        </ScrollView>

        {/* ------------------------------------------------------------------- */}
        {/* MODAL 1: ELECCIÓN DE TIPO AL DETECTAR UN TAG NUEVO                */}
        {/* ------------------------------------------------------------------- */}
        <Modal
          visible={tagPendienteUid !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setTagPendienteUid(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>📡 ETIQUETA RFID DETECTADA</Text>
                <Text style={styles.modalUid}>{tagPendienteUid}</Text>
              </View>

              <Text style={styles.modalQuestion}>¿Qué tipo de carga es este tag?</Text>

              {/* Botón Paleta Completa */}
              <Pressable
                style={[
                  styles.choiceBtn,
                  tipoCargaModal === 'PALETA_COMPLETA' && styles.choiceBtnActivePaleta,
                ]}
                onPress={() => {
                  void hapticImpact();
                  setTipoCargaModal('PALETA_COMPLETA');
                }}
              >
                <Text
                  style={[
                    styles.choiceBtnTitle,
                    tipoCargaModal === 'PALETA_COMPLETA' && { color: '#4ade80' },
                  ]}
                >
                  🟢 1. PALETA COMPLETA
                </Text>
                <Text style={styles.choiceBtnDesc}>
                  Estándar del producto: {productoSeleccionado.regla_empaque.cajas_por_paleta} cajas ({productoSeleccionado.regla_empaque.cajas_por_paleta * productoSeleccionado.regla_empaque.unidades_por_caja} unidades)
                </Text>
              </Pressable>

              {/* Botón Pucho / Cajas Sueltas */}
              <Pressable
                style={[
                  styles.choiceBtn,
                  tipoCargaModal === 'PUCHO' && styles.choiceBtnActivePucho,
                ]}
                onPress={() => {
                  void hapticImpact();
                  setTipoCargaModal('PUCHO');
                }}
              >
                <Text
                  style={[
                    styles.choiceBtnTitle,
                    tipoCargaModal === 'PUCHO' && { color: '#facc15' },
                  ]}
                >
                  🟡 2. PUCHO (CAJAS SUELTAS)
                </Text>
                <Text style={styles.choiceBtnDesc}>
                  Paleta incompleta o bultos individuales
                </Text>
              </Pressable>

              {/* Si es Pucho, mostrar stepper para ingresar la cantidad exacta */}
              {tipoCargaModal === 'PUCHO' && (
                <View style={styles.modalStepperContainer}>
                  <Text style={styles.modalStepperTitle}>
                    CANTIDAD EXACTA DE CAJAS / PAQUETES:
                  </Text>
                  <View style={styles.stepperRow}>
                    <Pressable
                      style={styles.modalStepBtn}
                      onPress={() => {
                        void hapticImpact();
                        setPuchoCajasModal((prev) => Math.max(1, prev - 1));
                      }}
                    >
                      <Text style={styles.modalStepBtnText}>-</Text>
                    </Pressable>

                    <View style={styles.modalStepDisplay}>
                      <Text style={styles.modalStepNumber}>{puchoCajasModal}</Text>
                      <Text style={styles.modalStepUnit}>cajas / paquetes</Text>
                    </View>

                    <Pressable
                      style={styles.modalStepBtn}
                      onPress={() => {
                        void hapticImpact();
                        setPuchoCajasModal((prev) => prev + 1);
                      }}
                    >
                      <Text style={styles.modalStepBtnText}>+</Text>
                    </Pressable>
                  </View>

                  <View style={styles.modalQuickAddRow}>
                    {[1, 5, 10, 20].map((add) => (
                      <Pressable
                        key={add}
                        style={styles.modalQuickBtn}
                        onPress={() => {
                          void hapticImpact();
                          setPuchoCajasModal((prev) => prev + add);
                        }}
                      >
                        <Text style={styles.modalQuickBtnText}>+{add}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              <View style={styles.modalActionsRow}>
                <Pressable
                  style={styles.modalConfirmBtn}
                  onPress={handleConfirmarClasificacionTag}
                >
                  <Text style={styles.modalConfirmBtnText}>
                    ✓ CONFIRMAR Y REGISTRAR TAG
                  </Text>
                </Pressable>

                <Pressable
                  style={styles.modalCancelBtn}
                  onPress={() => setTagPendienteUid(null)}
                >
                  <Text style={styles.modalCancelBtnText}>Descartar</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* ------------------------------------------------------------------- */}
        {/* MODAL 2: ALERTA DE TAG REPETIDO / DUPLICADO                       */}
        {/* ------------------------------------------------------------------- */}
        <Modal
          visible={tagRepetidoAlerta !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setTagRepetidoAlerta(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { borderColor: '#ef4444' }]}>
              <Text style={styles.duplicateIcon}>⚠️</Text>
              <Text style={styles.duplicateTitle}>TAG RFID YA REGISTRADO</Text>
              <Text style={styles.duplicateUid}>{tagRepetidoAlerta?.uid}</Text>

              <Text style={styles.duplicateDesc}>
                {tagRepetidoAlerta?.detallePrevia.includes('activo en')
                  ? 'Esta etiqueta RFID ya está asignada a una paleta en el sistema:'
                  : 'Esta etiqueta RFID ya fue leída previamente en esta sesión como:'}
              </Text>
              <Text style={styles.duplicateDetail}>
                {tagRepetidoAlerta?.detallePrevia}
              </Text>

              <Text style={styles.duplicateNote}>
                La etiqueta física no puede reutilizarse mientras esté activa.
              </Text>

              <Pressable
                style={styles.duplicateCloseBtn}
                onPress={() => setTagRepetidoAlerta(null)}
              >
                <Text style={styles.duplicateCloseBtnText}>
                  Entendido / Continuar Escaneando
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ===========================================================================
  // VISTA 3: CONCILIACIÓN CIEGA (RECUENTO TOTAL Y VERIFICACIÓN)
  // ===========================================================================
  if (vistaActual === 'VISTA_3_CONCILIACION') {
    const totalCajasFisicas =
      paletasCompletas * productoSeleccionado.regla_empaque.cajas_por_paleta + paquetesPuchos;
    const totalUnidadesFisicas =
      totalCajasFisicas * productoSeleccionado.regla_empaque.unidades_por_caja;

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerEyebrow}>MÓDULO 3 · VISTA 3 DE 4</Text>
            <Text style={styles.headerTitle}>Conciliación de Mercancía</Text>
          </View>
          <View style={styles.warehouseChip}>
            <Text style={styles.warehouseChipText}>{almacen.nombre}</Text>
          </View>
        </View>

        {renderStepper()}

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {/* Tarjeta de Recuento Físico Ciego */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>RECUENTO DE LECTURA RFID EN MUELLE</Text>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Orden de Importación:</Text>
              <Text style={styles.summaryValue}>{productoSeleccionado.numero_orden}</Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Producto / SKU:</Text>
              <Text style={styles.summaryValue}>{productoSeleccionado.sku}</Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Paletas Completas Leídas:</Text>
              <Text style={[styles.summaryValue, { color: '#4ade80' }]}>
                {paletasCompletas} paletas
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Cajas de Puchos Acumuladas:</Text>
              <Text style={[styles.summaryValue, { color: '#facc15' }]}>
                {paquetesPuchos} cajas sueltas
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Total Cajas / Paquetes:</Text>
              <Text style={[styles.summaryValue, { color: '#00b4d8' }]}>
                {totalCajasFisicas} cajas
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Total Unidades Calculadas:</Text>
              <Text style={[styles.summaryValue, { color: '#ffffff', fontSize: 16 }]}>
                {totalUnidadesFisicas} unidades
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Total Etiquetas RFID únicas:</Text>
              <Text style={styles.summaryValue}>{lecturas.length} tags</Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Almacén de Ingreso:</Text>
              <Text style={styles.summaryValue}>{almacen.nombre}</Text>
            </View>

          </View>

          {/* Tarjeta de Operario Autenticado */}
          <View style={styles.authOperatorCard}>
            <Text style={styles.authOperatorIcon}>👤</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.authOperatorEmail}>
                Operario: {operarioEmail ?? 'Usuario Autenticado'}
              </Text>
              <Text style={styles.authOperatorSub}>
                Sesión activa
              </Text>
            </View>
          </View>

          <Pressable style={styles.primaryActionButton} onPress={handleConfirmarYSubirASupabase}>
            <Text style={styles.primaryActionButtonText}>
              ☁️ CONFIRMAR Y SUBIR A SUPABASE (PASO 4) ➔
            </Text>
          </Pressable>

          <Pressable
            style={styles.secondaryButton}
            onPress={() => {
              void hapticImpact();
              setVistaActual('VISTA_2_LECTURA_RFID');
            }}
          >
            <Text style={styles.secondaryButtonText}>
              ⬅ Volver a Lectura RFID (Corregir o Agregar Tags)
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ===========================================================================
  // VISTA 4: SUBIDA Y REGISTRO EN SUPABASE (EN LA NUBE)
  // ===========================================================================
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerEyebrow}>MÓDULO 3 · VISTA 4 DE 4</Text>
          <Text style={styles.headerTitle}>
            {subiendo
              ? 'Subiendo a la Nube...'
              : resultadoConciliacion
              ? 'Registro en Supabase Exitoso'
              : 'Resguardo en Cola Offline'}
          </Text>
        </View>
      </View>

      {renderStepper()}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {subiendo ? (
          /* SPINNER DURANTE LA TRANSMISIÓN A LA NUBE */
          <View style={styles.loadingCloudCard}>
            <ActivityIndicator size="large" color="#00b4d8" />
            <Text style={styles.loadingCloudTitle}>
              TRANSMITIENDO RECEPCIÓN A SUPABASE CLOUD...
            </Text>
            <Text style={styles.loadingCloudDesc}>
              Enrolando {lecturas.length} etiquetas RFID, calculando conciliación ciega y actualizando el inventario del almacén {almacen.nombre}.
            </Text>
          </View>
        ) : resultadoConciliacion ? (
          /* CONFIRMACIÓN EXITOSA DIRECTAMENTE EN SUPABASE */
          <View style={styles.resultSuccessCard}>
            <Text style={styles.resultIcon}>✅</Text>
            <Text style={styles.resultSuccessTitle}>
              REGISTRADO EN SUPABASE CON ÉXITO
            </Text>
            <Text style={styles.resultSuccessSub}>
              Sesión #{resultadoConciliacion.id_sesion ?? 'S/N'} creada en la base de datos
            </Text>

            <View style={styles.resultDivider} />

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Fecha y Hora Exacta:</Text>
              <Text style={styles.resultValue}>{fechaHoraRegistro ?? '-'}</Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Estado de Conciliación:</Text>
              <Text
                style={[
                  styles.resultValue,
                  {
                    color:
                      resultadoConciliacion.estado_conciliacion === 'COMPLETA'
                        ? '#4ade80'
                        : resultadoConciliacion.estado_conciliacion === 'SOBRANTES'
                        ? '#38bdf8'
                        : '#e52521',
                  },
                ]}
              >
                {resultadoConciliacion.estado_conciliacion}
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Cantidad Esperada (Orden):</Text>
              <Text style={styles.resultValue}>
                {resultadoConciliacion.cantidad_esperada ?? '-'} unidades
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Cantidad Recibida (Física):</Text>
              <Text style={[styles.resultValue, { color: '#4ade80' }]}>
                {resultadoConciliacion.cantidad_recibida ?? '-'} unidades
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Diferencia:</Text>
              <Text
                style={[
                  styles.resultValue,
                  {
                    color:
                      (resultadoConciliacion.diferencia_unidades ?? 0) === 0
                        ? '#4ade80'
                        : (resultadoConciliacion.diferencia_unidades ?? 0) > 0
                        ? '#38bdf8'
                        : '#e52521',
                  },
                ]}
              >
                {(resultadoConciliacion.diferencia_unidades ?? 0) > 0 ? '+' : ''}
                {resultadoConciliacion.diferencia_unidades ?? 0} unidades
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Etiquetas RFID Enroladas:</Text>
              <Text style={[styles.resultValue, { color: '#00b4d8' }]}>
                {resultadoConciliacion.tags_procesados} etiquetas activas
              </Text>
            </View>

            <View style={styles.successBox}>
              <Text style={styles.successBoxText}>
                ✓ Stock de almacén actualizado en tiempo real en Supabase.{'\n'}
                ✓ Trazabilidad inmutable registrada en la tabla movimientos.
              </Text>
            </View>
          </View>
        ) : (
          /* RESGUARDO OFFLINE EN ASYNCSTORAGE */
          <View style={[styles.resultSuccessCard, { borderColor: '#38bdf8' }]}>
            <Text style={styles.resultIcon}>💾</Text>
            <Text style={[styles.resultSuccessTitle, { color: '#38bdf8' }]}>
              GUARDADO EN COLA OFFLINE
            </Text>
            <Text style={styles.resultSuccessSub}>
              Transacción protegida con ID de idempotencia local en la terminal
            </Text>

            {errorSubida && (
              <View style={styles.errorNotice}>
                <Text style={styles.errorNoticeText}>Motivo: {errorSubida}</Text>
              </View>
            )}

            <View style={styles.resultDivider} />

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Fecha y Hora Local:</Text>
              <Text style={styles.resultValue}>{fechaHoraRegistro ?? '-'}</Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Tags en Buffer:</Text>
              <Text style={[styles.resultValue, { color: '#38bdf8' }]}>
                {lecturas.length} etiquetas listas para sincronizar
              </Text>
            </View>

            <Text style={styles.offlineNote}>
              La recepción se encuentra completamente protegida en el teléfono. Podrá sincronizarla contra Supabase cuando recupere señal desde la Opción 5 (Cola Pendientes Offline).
            </Text>
          </View>
        )}

        <Pressable
          style={styles.primaryActionButton}
          onPress={() => {
            void hapticSuccess();
            onBackToMenu();
          }}
        >
          <Text style={styles.primaryActionButtonText}>
            🏠 FINALIZAR Y VOLVER AL MENÚ
          </Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => {
            void hapticImpact();
            handleIniciarNuevaSesion();
            setVistaActual('VISTA_1_ORDEN');
          }}
        >
          <Text style={styles.secondaryButtonText}>
            🔄 Iniciar Otra Recepción RFID
          </Text>
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
    paddingBottom: 14,
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
    fontSize: 17,
    fontWeight: 'bold',
  },
  warehouseChip: {
    backgroundColor: 'rgba(0, 180, 216, 0.15)',
    borderWidth: 1,
    borderColor: '#00b4d8',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  warehouseChipText: {
    color: '#00b4d8',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  stepperNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#090e1a',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    opacity: 0.4,
  },
  stepItemActive: {
    opacity: 1,
  },
  stepNumber: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1e293b',
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: 'monospace',
  },
  stepNumberActive: {
    backgroundColor: '#e52521',
    color: '#ffffff',
  },
  stepLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  stepLabelActive: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  stepArrow: {
    color: '#334155',
    fontSize: 10,
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
  pausedBanner: {
    backgroundColor: 'rgba(234, 179, 8, 0.12)',
    borderWidth: 1,
    borderColor: '#facc15',
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
  },
  pausedBannerTitle: {
    color: '#facc15',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  pausedBannerText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  pausedBannerDetail: {
    color: '#cbd5e1',
    fontSize: 12,
    marginTop: 2,
    marginBottom: 10,
  },
  pausedButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  resumeButton: {
    backgroundColor: '#facc15',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    flex: 1,
    alignItems: 'center',
  },
  resumeButtonText: {
    color: '#000000',
    fontWeight: 'bold',
    fontSize: 13,
  },
  discardButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: '#475569',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    alignItems: 'center',
  },
  discardButtonText: {
    color: '#94a3b8',
    fontSize: 13,
  },
  productCard: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 14,
    marginBottom: 10,
  },
  productCardSelected: {
    borderColor: '#00b4d8',
    borderWidth: 1.5,
    backgroundColor: '#0c1a2e',
  },
  productCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  orderNumber: {
    color: '#cbd5e1',
    fontSize: 15,
    fontWeight: 'bold',
  },
  skuBadge: {
    backgroundColor: 'rgba(0, 180, 216, 0.15)',
    borderWidth: 1,
    borderColor: '#00b4d8',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  skuBadgeText: {
    color: '#00b4d8',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  productName: {
    color: '#94a3b8',
    fontSize: 13,
    marginBottom: 4,
  },
  productDetail: {
    color: '#64748b',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  specCard: {
    backgroundColor: '#111827',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 14,
    marginVertical: 14,
  },
  specTitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  specRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  specLabel: {
    color: '#cbd5e1',
    fontSize: 13,
  },
  specValue: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  blindNote: {
    color: '#64748b',
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 8,
    lineHeight: 16,
  },
  nfcRadarBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(74, 222, 128, 0.12)',
    borderWidth: 1,
    borderColor: '#4ade80',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 6,
  },
  pulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#64748b',
  },
  nfcRadarText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  counterDashboard: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  counterBox: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#38bdf8',
    padding: 14,
    alignItems: 'center',
  },
  counterLabel: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    marginBottom: 4,
    textAlign: 'center',
  },
  counterNumber: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  counterSub: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  nfcDisabledBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1.5,
    borderColor: '#ef4444',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  nfcDisabledTitle: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    marginBottom: 6,
    textAlign: 'center',
  },
  nfcDisabledDesc: {
    color: '#cbd5e1',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 12,
  },
  openNfcBtn: {
    backgroundColor: '#ef4444',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  openNfcBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  expoGoNoticeBanner: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1.5,
    borderColor: '#f59e0b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  expoGoNoticeTitle: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    marginBottom: 4,
    textAlign: 'center',
  },
  expoGoNoticeDesc: {
    color: '#cbd5e1',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  nfcSensorialCard: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#00b4d8',
    padding: 20,
    alignItems: 'center',
    marginBottom: 14,
  },
  nfcSensorialIcon: {
    fontSize: 42,
    marginBottom: 8,
  },
  nfcSensorialTitle: {
    color: '#00b4d8',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    letterSpacing: 1,
    textAlign: 'center',
  },
  nfcSensorialDesc: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 14,
  },
  simButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  simBtn: {
    flex: 1,
    backgroundColor: 'rgba(0, 180, 216, 0.15)',
    borderWidth: 1,
    borderColor: '#00b4d8',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  simBtnText: {
    color: '#00b4d8',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  manualScanRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  manualInput: {
    flex: 1,
    backgroundColor: '#090d16',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    fontFamily: 'monospace',
  },
  manualBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  manualBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  bufferHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  totalCajasTag: {
    color: '#facc15',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  emptyCard: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyText: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  tagsContainer: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 18,
    maxHeight: 240,
    padding: 8,
  },
  tagItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  tagItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tagItemIndex: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  tagItemUid: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  tagItemTime: {
    color: '#64748b',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  tagItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tagItemBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    alignItems: 'flex-end',
  },
  tagItemBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  tagItemUnits: {
    color: '#94a3b8',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  deleteBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBtnText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: 'bold',
  },
  pauseButton: {
    backgroundColor: '#081726',
    borderWidth: 1,
    borderColor: '#38bdf8',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  pauseButtonText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  primaryActionButton: {
    backgroundColor: '#e52521',
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryActionButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
    letterSpacing: 0.5,
    fontFamily: 'monospace',
  },
  secondaryButton: {
    backgroundColor: '#0b1120',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 13,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  secondaryButtonText: {
    color: '#94a3b8',
    fontWeight: '600',
    fontSize: 12,
  },
  // ESTILOS MODAL DE CLASIFICACIÓN
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#00b4d8',
    padding: 20,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    color: '#00b4d8',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  modalUid: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
    fontFamily: 'monospace',
    marginTop: 4,
  },
  modalQuestion: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 14,
  },
  choiceBtn: {
    backgroundColor: '#070a12',
    borderWidth: 1.5,
    borderColor: '#1e293b',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  choiceBtnActivePaleta: {
    borderColor: '#4ade80',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
  },
  choiceBtnActivePucho: {
    borderColor: '#facc15',
    backgroundColor: 'rgba(250, 204, 21, 0.1)',
  },
  choiceBtnTitle: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  choiceBtnDesc: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 4,
  },
  modalStepperContainer: {
    backgroundColor: '#070a12',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#facc15',
    padding: 12,
    marginBottom: 14,
  },
  modalStepperTitle: {
    color: '#facc15',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    textAlign: 'center',
    marginBottom: 8,
  },
  stepperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalStepBtn: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalStepBtnText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  modalStepDisplay: {
    alignItems: 'center',
  },
  modalStepNumber: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  modalStepUnit: {
    color: '#94a3b8',
    fontSize: 10,
  },
  modalQuickAddRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  modalQuickBtn: {
    flex: 1,
    backgroundColor: 'rgba(250, 204, 21, 0.12)',
    borderWidth: 1,
    borderColor: '#facc15',
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
  },
  modalQuickBtnText: {
    color: '#facc15',
    fontWeight: 'bold',
    fontSize: 12,
  },
  modalActionsRow: {
    marginTop: 6,
  },
  modalConfirmBtn: {
    backgroundColor: '#4ade80',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  modalConfirmBtnText: {
    color: '#000000',
    fontWeight: 'bold',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  modalCancelBtn: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  modalCancelBtnText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  // ESTILOS MODAL DUPLICADO
  duplicateIcon: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 8,
  },
  duplicateTitle: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
    fontFamily: 'monospace',
  },
  duplicateUid: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    fontFamily: 'monospace',
    marginTop: 4,
    marginBottom: 10,
  },
  duplicateDesc: {
    color: '#cbd5e1',
    fontSize: 12,
    textAlign: 'center',
  },
  duplicateDetail: {
    color: '#facc15',
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  duplicateNote: {
    color: '#94a3b8',
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 16,
    backgroundColor: 'rgba(0,0,0,0.3)',
    padding: 10,
    borderRadius: 6,
    marginBottom: 16,
  },
  duplicateCloseBtn: {
    backgroundColor: '#ef4444',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  duplicateCloseBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  // VISTA 3 ESTILOS
  summaryCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    marginBottom: 16,
  },
  summaryTitle: {
    color: '#00b4d8',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    marginBottom: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  summaryLabel: {
    color: '#cbd5e1',
    fontSize: 12,
  },
  summaryValue: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  blindSecurityNotice: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 12,
    fontStyle: 'italic',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    padding: 10,
    borderRadius: 6,
  },
  authOperatorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 14,
    marginBottom: 16,
  },
  authOperatorIcon: {
    fontSize: 24,
  },
  authOperatorEmail: {
    color: '#4ade80',
    fontSize: 13,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  authOperatorSub: {
    color: '#94a3b8',
    fontSize: 10,
    marginTop: 2,
  },
  // VISTA 4 ESTILOS
  loadingCloudCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#00b4d8',
    padding: 30,
    alignItems: 'center',
    marginVertical: 20,
  },
  loadingCloudTitle: {
    color: '#00b4d8',
    fontSize: 13,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  loadingCloudDesc: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  resultSuccessCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#4ade80',
    padding: 18,
    alignItems: 'center',
    marginBottom: 18,
  },
  resultIcon: {
    fontSize: 44,
    marginBottom: 6,
  },
  resultSuccessTitle: {
    color: '#4ade80',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
    fontFamily: 'monospace',
  },
  resultSuccessSub: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  resultDivider: {
    height: 1,
    backgroundColor: '#1e293b',
    width: '100%',
    marginVertical: 12,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 6,
  },
  resultLabel: {
    color: '#94a3b8',
    fontSize: 12,
  },
  resultValue: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  successBox: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.3)',
    borderRadius: 6,
    padding: 10,
    marginTop: 12,
    width: '100%',
  },
  successBoxText: {
    color: '#4ade80',
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'monospace',
  },
  errorNotice: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 6,
    padding: 8,
    marginVertical: 8,
    width: '100%',
  },
  errorNoticeText: {
    color: '#f87171',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  offlineNote: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
    textAlign: 'center',
  },
});
