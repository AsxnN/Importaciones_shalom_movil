import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Almacen, ItemDespachoMovimiento, ResultadoDespachoMovimiento } from '../types';
import { hapticImpact, hapticSuccess, hapticWarning } from '../lib/haptics';
import { isNfcSupported, startNfcSession, stopNfcSession } from '../lib/nfc';
import { consultarTagParaMovimiento, ejecutarDespachoMovimientos } from '../services/movimientos';
import { fetchAlmacenes } from '../services/recepcion';

interface Props {
  almacen: Almacen;
  onBackToMenu: () => void;
}

export function MovimientosScreen({ almacen, onBackToMenu }: Props) {
  // Lista de paletas escaneadas para despacho
  const [items, setItems] = useState<ItemDespachoMovimiento[]>([]);
  const [buscandoTag, setBuscandoTag] = useState(false);
  const [inputManual, setInputManual] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultadoExitoso, setResultadoExitoso] = useState<ResultadoDespachoMovimiento | null>(null);

  // Destino del movimiento / despacho
  const [almacenesDestino, setAlmacenesDestino] = useState<Almacen[]>([]);
  const [almacenDestinoSeleccionado, setAlmacenDestinoSeleccionado] = useState<Almacen | null>(null);
  const [modalDestinoVisible, setModalDestinoVisible] = useState(false);
  const [modalConfirmacionVisible, setModalConfirmacionVisible] = useState(false);

  // Modal de advertencia de regla de pucho
  const [modalPuchoVisible, setModalPuchoVisible] = useState(false);
  const [puchoAlertInfo, setPuchoAlertInfo] = useState<{ sku: string; uidOtro: string } | null>(null);

  // Referencia para evitar colisiones en escaneo NFC continuo
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const procesandoRef = useRef(false);

  // Cargar almacenes de destino disponibles en el sistema
  useEffect(() => {
    async function cargarAlmacenes() {
      try {
        const list = await fetchAlmacenes();
        setAlmacenesDestino(list);
        // Preseleccionar por defecto un almacén destino distinto al actual (ej. Tienda Central)
        const otro = list.find((a) => a.id_almacen !== almacen.id_almacen);
        if (otro) {
          setAlmacenDestinoSeleccionado(otro);
        } else if (list.length > 0) {
          setAlmacenDestinoSeleccionado(list[0]);
        }
      } catch (err) {
        console.warn('Error cargando almacenes de destino:', err);
      }
    }
    void cargarAlmacenes();
  }, [almacen.id_almacen]);

  // Iniciar sensor NFC continuo
  useEffect(() => {
    let activo = true;

    async function initNfc() {
      const soporta = await isNfcSupported();
      if (!soporta || !activo) return;

      await startNfcSession((uid) => {
        if (!uid || procesandoRef.current) return;
        void procesarUidDetectado(uid);
      });
    }

    void initNfc();

    return () => {
      activo = false;
      void stopNfcSession();
    };
  }, [almacen.id_almacen]);

  // Procesar UID escaneado o ingresado
  const procesarUidDetectado = async (rawUid: string) => {
    const cleanUid = rawUid.trim().toUpperCase();
    if (!cleanUid) return;

    // Evitar procesar si ya está en la lista actual
    if (itemsRef.current.some((i) => i.uid_tag === cleanUid)) {
      void hapticWarning();
      Alert.alert('Tag ya agregado', `La paleta con UID "${cleanUid}" ya se encuentra en la lista de despacho actual.`);
      return;
    }

    try {
      procesandoRef.current = true;
      setBuscandoTag(true);

      const resp = await consultarTagParaMovimiento(cleanUid, almacen.id_almacen);

      if (!resp.success || !resp.data) {
        void hapticWarning();
        Alert.alert('Tag No Apto', resp.error || 'No se pudo cargar la paleta.');
        return;
      }

      const nuevoItem = resp.data;

      // Vibración de éxito sensorial
      void hapticSuccess();

      setItems((prev) => [...prev, nuevoItem]);
      setInputManual('');
    } finally {
      setBuscandoTag(false);
      procesandoRef.current = false;
    }
  };

  // Alternar entre Despacho Completo y Retiro Parcial
  const handleCambiarTipoMovimiento = (
    index: number,
    tipo: 'DESPACHO_COMPLETO' | 'RETIRO_PARCIAL'
  ) => {
    void hapticImpact();
    setItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[index] };

      if (tipo === 'RETIRO_PARCIAL') {
        // REGLA DE ORO DE ALMACÉN:
        // Si la paleta actual es COMPLETA y ya existe otro pucho activo para este SKU en el almacén, BLOQUEAR
        if (item.tipo_paleta_actual === 'COMPLETO' && item.yaExisteOtroPucho) {
          void hapticWarning();
          setPuchoAlertInfo({
            sku: item.sku,
            uidOtro: item.uidOtroPucho || 'DESCONOCIDO',
          });
          setModalPuchoVisible(true);
          return prev; // No cambia a retiro parcial
        }

        item.tipo_movimiento = 'RETIRO_PARCIAL';
        item.paquetes_a_retirar = Math.max(1, Math.min(1, item.cantidad_paquetes_actual));
        item.unidades_a_retirar = item.paquetes_a_retirar * item.unidades_por_caja;
        item.paquetes_restantes = item.cantidad_paquetes_actual - item.paquetes_a_retirar;
        item.unidades_restantes = item.cantidad_unidades_actual - item.unidades_a_retirar;
        item.nuevo_tipo_paleta = item.paquetes_restantes > 0 ? 'PUCHO' : item.tipo_paleta_actual;
      } else {
        item.tipo_movimiento = 'DESPACHO_COMPLETO';
        item.paquetes_a_retirar = item.cantidad_paquetes_actual;
        item.unidades_a_retirar = item.cantidad_unidades_actual;
        item.paquetes_restantes = 0;
        item.unidades_restantes = 0;
        item.nuevo_tipo_paleta = item.tipo_paleta_actual;
      }

      updated[index] = item;
      return updated;
    });
  };

  // Ajustar cantidad de paquetes a retirar en retiro parcial
  const handleAjustarPaquetes = (index: number, delta: number) => {
    void hapticImpact();
    setItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[index] };

      const nuevoVal = Math.max(1, Math.min(item.cantidad_paquetes_actual, item.paquetes_a_retirar + delta));
      item.paquetes_a_retirar = nuevoVal;
      item.unidades_a_retirar = nuevoVal * item.unidades_por_caja;
      item.paquetes_restantes = item.cantidad_paquetes_actual - nuevoVal;
      item.unidades_restantes = item.cantidad_unidades_actual - item.unidades_a_retirar;
      item.nuevo_tipo_paleta = item.paquetes_restantes > 0 ? 'PUCHO' : item.tipo_paleta_actual;

      updated[index] = item;
      return updated;
    });
  };

  // Cambiar motivo
  const handleCambiarMotivo = (index: number, motivo: string) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], motivo };
      return updated;
    });
  };

  // Eliminar tag de la lista
  const handleEliminarItem = (index: number) => {
    void hapticImpact();
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Abrir modal de confirmación con detalle de destino
  const handlePresionarDespacho = () => {
    if (items.length === 0) {
      void hapticWarning();
      Alert.alert('Lista vacía', 'Escanea al menos un tag RFID para despachar.');
      return;
    }

    if (!almacenDestinoSeleccionado) {
      void hapticWarning();
      Alert.alert('Destino Requerido', 'Por favor selecciona el almacén o tienda de destino.');
      setModalDestinoVisible(true);
      return;
    }

    void hapticImpact();
    setModalConfirmacionVisible(true);
  };

  // Enviar despacho a Supabase
  const handleConfirmarDespacho = async () => {
    try {
      setEnviando(true);
      setModalConfirmacionVisible(false);

      const itemsConDestino = items.map((it) => ({
        ...it,
        id_almacen_destino: almacenDestinoSeleccionado?.id_almacen,
        nombre_almacen_destino: almacenDestinoSeleccionado?.nombre,
        motivo: (it.motivo || `Despacho a ${almacenDestinoSeleccionado?.nombre || 'Destino'}`).slice(0, 80),
      }));

      const res = await ejecutarDespachoMovimientos(
        almacen.id_almacen,
        itemsConDestino,
        almacenDestinoSeleccionado?.id_almacen
      );

      if (res.ok) {
        void hapticSuccess();
        setResultadoExitoso(res);
        setItems([]);
      } else {
        void hapticWarning();
        Alert.alert('Error en Despacho', res.mensaje);
      }
    } finally {
      setEnviando(false);
    }
  };

  // Totales
  const totalUnidadesRetiradas = items.reduce((acc, i) => acc + i.unidades_a_retirar, 0);
  const totalCajasRetiradas = items.reduce((acc, i) => acc + i.paquetes_a_retirar, 0);

  return (
    <View style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerEyebrow}>MÓDULO 2 · MOVIMIENTOS</Text>
          <Text style={styles.headerTitle}>Despachos y Retiros RFID</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.badge}>{almacen.nombre}</Text>
          <View style={styles.nfcIndicator}>
            <View style={styles.nfcDot} />
            <Text style={styles.nfcText}>NFC ACTIVO</Text>
          </View>
        </View>
      </View>

      {/* PANTALLA DE ÉXITO */}
      {resultadoExitoso ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.successCard}>
            <Text style={styles.successIcon}>✅</Text>
            <Text style={styles.successTitle}>Despacho Ejecutado</Text>
            <Text style={styles.successSubtitle}>
              {resultadoExitoso.mensaje}
            </Text>

            <View style={styles.kpiContainer}>
              <View style={styles.kpiBox}>
                <Text style={styles.kpiVal}>{resultadoExitoso.items_procesados}</Text>
                <Text style={styles.kpiLabel}>Paletas Afectadas</Text>
              </View>
              <View style={styles.kpiBox}>
                <Text style={styles.kpiVal}>{resultadoExitoso.unidades_totales_retiradas}</Text>
                <Text style={styles.kpiLabel}>Unidades Descontadas</Text>
              </View>
            </View>

            {resultadoExitoso.detalles && resultadoExitoso.detalles.length > 0 && (
              <View style={styles.detailsBox}>
                <Text style={styles.detailsTitle}>Detalle de Afectación:</Text>
                {resultadoExitoso.detalles.map((d, idx) => (
                  <Text key={idx} style={styles.detailItem}>
                    • {d}
                  </Text>
                ))}
              </View>
            )}

            <Pressable
              style={styles.newActionBtn}
              onPress={() => {
                void hapticImpact();
                setResultadoExitoso(null);
              }}
            >
              <Text style={styles.newActionBtnText}>+ NUEVO DESPACHO</Text>
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
          </View>
        </ScrollView>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {/* BANNER DE ESCANEO NFC */}
          <View style={styles.scanBanner}>
            <Text style={styles.scanBannerIcon}>📡</Text>
            <View style={styles.scanBannerBody}>
              <Text style={styles.scanBannerTitle}>Acerca el Tag RFID al Celular</Text>
              <Text style={styles.scanBannerSubtitle}>
                El chip NFC capturará la paleta y validará su existencia y estado en almacén.
              </Text>
            </View>
          </View>

          {/* ENTRADA MANUAL O DEMO */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>ENTRADA POR TECLADO / PRUEBA:</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.textInput}
                placeholder="UID Tag (ej. TAG-001 o NFC)"
                placeholderTextColor="#64748b"
                value={inputManual}
                onChangeText={setInputManual}
                autoCapitalize="characters"
                onSubmitEditing={() => void procesarUidDetectado(inputManual)}
              />
              <Pressable
                style={styles.searchBtn}
                onPress={() => void procesarUidDetectado(inputManual)}
                disabled={buscandoTag}
              >
                {buscandoTag ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.searchBtnText}>BUSCAR</Text>
                )}
              </Pressable>
            </View>
          </View>

          {/* SELECTOR TÁCTICO DE DESTINO */}
          <View style={styles.destinationCard}>
            <View style={styles.destinationHeaderRow}>
              <Text style={styles.destinationEyebrow}>RUTA DE DESPACHO / MOVIMIENTO</Text>
              <Pressable
                style={styles.changeDestinationBtn}
                onPress={() => {
                  void hapticImpact();
                  setModalDestinoVisible(true);
                }}
              >
                <Text style={styles.changeDestinationBtnText}>Cambiar Destino ▾</Text>
              </Pressable>
            </View>

            <View style={styles.routeRow}>
              <View style={styles.routePoint}>
                <Text style={styles.routePointLabel}>ORIGEN</Text>
                <Text style={styles.routePointName}>🏛️ {almacen.nombre}</Text>
              </View>
              <Text style={styles.routeArrow}>➔</Text>
              <Pressable
                style={styles.routePointDestino}
                onPress={() => {
                  void hapticImpact();
                  setModalDestinoVisible(true);
                }}
              >
                <Text style={styles.routePointLabel}>DESTINO (PULSAR PARA ELEGIR)</Text>
                <Text style={styles.routePointDestinoName}>
                  {almacenDestinoSeleccionado
                    ? `🏬 ${almacenDestinoSeleccionado.nombre}`
                    : '⚠️ Elegir destino...'}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* LISTA DE PALETAS A DESPACHAR */}
          <View style={styles.listHeaderRow}>
            <Text style={styles.sectionTitle}>
              PALETAS A DESPACHAR ({items.length})
            </Text>
            {items.length > 0 && (
              <Pressable
                onPress={() => {
                  void hapticImpact();
                  setItems([]);
                }}
              >
                <Text style={styles.clearBtnText}>Limpiar Todo</Text>
              </Pressable>
            )}
          </View>

          {items.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyIcon}>📦</Text>
              <Text style={styles.emptyTitle}>Ninguna paleta escaneada</Text>
              <Text style={styles.emptySubtitle}>
                Pasa la terminal sobre las etiquetas RFID de las paletas que saldrán de bodega.
              </Text>
            </View>
          ) : (
            items.map((item, idx) => (
              <View key={item.uid_tag} style={styles.itemCard}>
                {/* Encabezado del Item */}
                <View style={styles.itemCardHeader}>
                  <View style={styles.itemTagInfo}>
                    <Text style={styles.itemUid}>TAG: {item.uid_tag}</Text>
                    <Text style={styles.itemSku}>{item.sku}</Text>
                    <Text style={styles.itemNombre}>{item.nombre_producto}</Text>
                  </View>
                  <View style={styles.itemHeaderRight}>
                    <View
                      style={[
                        styles.tagTypeBadge,
                        item.tipo_paleta_actual === 'PUCHO'
                          ? styles.tagTypePucho
                          : styles.tagTypeCompleto,
                      ]}
                    >
                      <Text style={styles.tagTypeBadgeText}>
                        {item.tipo_paleta_actual === 'PUCHO' ? 'PUCHO ACTUAL' : 'PALETA COMPLETA'}
                      </Text>
                    </View>
                    <Pressable
                      style={styles.deleteBtn}
                      onPress={() => handleEliminarItem(idx)}
                    >
                      <Text style={styles.deleteBtnText}>🗑️</Text>
                    </Pressable>
                  </View>
                </View>

                {/* Stock actual del Tag */}
                <View style={styles.stockInfoRow}>
                  <Text style={styles.stockInfoLabel}>Contenido actual del tag:</Text>
                  <Text style={styles.stockInfoVal}>
                    {item.cantidad_paquetes_actual} cajas ({item.cantidad_unidades_actual} u)
                  </Text>
                </View>

                {/* SELECTOR: COMPLETO vs RETIRO PARCIAL */}
                <Text style={styles.operationTitle}>TIPO DE RETIRO:</Text>
                <View style={styles.typeSelectorRow}>
                  <Pressable
                    style={[
                      styles.typeBtn,
                      item.tipo_movimiento === 'DESPACHO_COMPLETO' && styles.typeBtnSelected,
                    ]}
                    onPress={() => handleCambiarTipoMovimiento(idx, 'DESPACHO_COMPLETO')}
                  >
                    <Text
                      style={[
                        styles.typeBtnText,
                        item.tipo_movimiento === 'DESPACHO_COMPLETO' && styles.typeBtnTextSelected,
                      ]}
                    >
                      Retiro Completo
                    </Text>
                    <Text style={styles.typeBtnSub}>Despacha todo el tag</Text>
                  </Pressable>

                  <Pressable
                    style={[
                      styles.typeBtn,
                      item.tipo_movimiento === 'RETIRO_PARCIAL' && styles.typeBtnSelected,
                      item.tipo_paleta_actual === 'COMPLETO' && item.yaExisteOtroPucho && styles.typeBtnDisabled,
                    ]}
                    onPress={() => handleCambiarTipoMovimiento(idx, 'RETIRO_PARCIAL')}
                  >
                    <Text
                      style={[
                        styles.typeBtnText,
                        item.tipo_movimiento === 'RETIRO_PARCIAL' && styles.typeBtnTextSelected,
                      ]}
                    >
                      Retiro Parcial
                    </Text>
                    <Text style={styles.typeBtnSub}>
                      {item.tipo_paleta_actual === 'COMPLETO' && item.yaExisteOtroPucho
                        ? 'Bloqueado (Ya hay pucho)'
                        : 'Descontar cajas'}
                    </Text>
                  </Pressable>
                </View>

                {/* DETALLE DE RETIRO PARCIAL */}
                {item.tipo_movimiento === 'RETIRO_PARCIAL' && (
                  <View style={styles.partialCard}>
                    <Text style={styles.partialTitle}>CAJAS A RETIRAR:</Text>
                    <View style={styles.stepperRow}>
                      <Pressable
                        style={styles.stepperBtn}
                        onPress={() => handleAjustarPaquetes(idx, -1)}
                      >
                        <Text style={styles.stepperBtnText}>-</Text>
                      </Pressable>
                      <View style={styles.stepperValBox}>
                        <Text style={styles.stepperValText}>{item.paquetes_a_retirar}</Text>
                        <Text style={styles.stepperUnitText}>cajas</Text>
                      </View>
                      <Pressable
                        style={styles.stepperBtn}
                        onPress={() => handleAjustarPaquetes(idx, 1)}
                      >
                        <Text style={styles.stepperBtnText}>+</Text>
                      </Pressable>
                    </View>

                    {/* Resumen del impacto en el tag */}
                    <View style={styles.impactBox}>
                      <Text style={styles.impactText}>
                        📉 Retirando: <Text style={styles.impactBold}>{item.unidades_a_retirar} u</Text> ({item.paquetes_a_retirar} cajas × {item.unidades_por_caja} u)
                      </Text>
                      <Text style={styles.impactText}>
                        📦 Quedará en Tag: <Text style={styles.impactBold}>{item.paquetes_restantes} cajas ({item.unidades_restantes} u)</Text>
                      </Text>
                      {item.paquetes_restantes > 0 && (
                        <Text style={styles.impactPuchoNotice}>
                          ⚠️ Esta paleta pasará a estado [PUCHO] en el sistema.
                        </Text>
                      )}
                    </View>
                  </View>
                )}

                {/* MOTIVO */}
                <View style={styles.motivoContainer}>
                  <Text style={styles.motivoLabel}>Motivo del movimiento:</Text>
                  <TextInput
                    style={styles.motivoInput}
                    value={item.motivo}
                    onChangeText={(val) => handleCambiarMotivo(idx, val)}
                    placeholder="Ej. Despacho a tienda, merma, muestra"
                    placeholderTextColor="#64748b"
                  />
                </View>
              </View>
            ))
          )}

          {/* FOOTER TOTALES Y CONFIRMACIÓN */}
          {items.length > 0 && (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>RESUMEN TOTAL DE SALIDA</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Paletas procesadas:</Text>
                <Text style={styles.summaryVal}>{items.length}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Total cajas a retirar:</Text>
                <Text style={styles.summaryVal}>{totalCajasRetiradas} cajas</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Total unidades descontadas:</Text>
                <Text style={styles.summaryValHighlight}>-{totalUnidadesRetiradas} u</Text>
              </View>

              <Pressable
                style={[styles.confirmBtn, enviando && styles.confirmBtnDisabled]}
                onPress={handlePresionarDespacho}
                disabled={enviando}
              >
                {enviando ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.confirmBtnText}>
                    CONFIRMAR Y EJECUTAR DESPACHO ➔
                  </Text>
                )}
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

      {/* MODAL DE REGLA DE ORO DE ALMACÉN: MÁXIMO 1 PUCHO */}
      <Modal
        visible={modalPuchoVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalPuchoVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalAlertIcon}>🚫</Text>
            <Text style={styles.modalTitle}>RESTRICCIÓN DE ORDEN</Text>
            <Text style={styles.modalSubtitle}>Máximo 1 Pucho por Producto</Text>

            <View style={styles.modalBodyCard}>
              <Text style={styles.modalBodyText}>
                El producto <Text style={styles.modalBold}>[{puchoAlertInfo?.sku}]</Text> ya cuenta con una paleta activa en estado <Text style={styles.modalPuchoHighlight}>[PUCHO]</Text> en este almacén:
              </Text>
              <Text style={styles.modalUidTag}>Tag Activo: {puchoAlertInfo?.uidOtro}</Text>
              <Text style={styles.modalBodyText}>
                Para mantener el orden del almacén y evitar la acumulación de cajas sueltas, <Text style={styles.modalBold}>debes despachar o agotar primero el pucho existente</Text> antes de abrir o fraccionar una nueva paleta completa.
              </Text>
            </View>

            <Pressable
              style={styles.modalCloseBtn}
              onPress={() => {
                void hapticImpact();
                setModalPuchoVisible(false);
              }}
            >
              <Text style={styles.modalCloseBtnText}>ENTENDIDO</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* MODAL DE SELECCIÓN DE ALMACÉN DESTINO */}
      <Modal
        visible={modalDestinoVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalDestinoVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentDestino}>
            <View style={styles.modalDestinoHeader}>
              <Text style={styles.modalDestinoTitle}>SELECCIONAR DESTINO</Text>
              <Text style={styles.modalDestinoSub}>
                Elige la tienda o almacén receptor del despacho:
              </Text>
            </View>

            <ScrollView style={styles.almacenesListScroll}>
              {almacenesDestino.map((alm) => {
                const esOrigen = alm.id_almacen === almacen.id_almacen;
                const esSeleccionado = almacenDestinoSeleccionado?.id_almacen === alm.id_almacen;

                return (
                  <Pressable
                    key={alm.id_almacen}
                    style={[
                      styles.almacenOptionCard,
                      esSeleccionado && styles.almacenOptionCardSelected,
                    ]}
                    onPress={() => {
                      void hapticSuccess();
                      setAlmacenDestinoSeleccionado(alm);
                      setModalDestinoVisible(false);
                    }}
                  >
                    <Text style={styles.almacenOptionIcon}>
                      {alm.tipo === 'PRINCIPAL' ? '🏛️' : alm.tipo === 'MERMA' ? '⚠️' : '🏬'}
                    </Text>
                    <View style={styles.almacenOptionInfo}>
                      <View style={styles.almacenOptionNameRow}>
                        <Text
                          style={[
                            styles.almacenOptionName,
                            esSeleccionado && styles.almacenOptionNameSelected,
                          ]}
                        >
                          {alm.nombre}
                        </Text>
                        {esOrigen && (
                          <View style={styles.almacenActualBadge}>
                            <Text style={styles.almacenActualBadgeText}>ORIGEN ACTUAL</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.almacenOptionTipo}>
                        Tipo: {alm.tipo} · Capacidad: {alm.capacidad_m3} m³
                      </Text>
                    </View>
                    <Text style={styles.almacenOptionCheck}>
                      {esSeleccionado ? '✓' : '➔'}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable
              style={styles.modalDestinoCancelBtn}
              onPress={() => {
                void hapticImpact();
                setModalDestinoVisible(false);
              }}
            >
              <Text style={styles.modalDestinoCancelText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* MODAL DE CONFIRMACIÓN DE DESPACHO */}
      <Modal
        visible={modalConfirmacionVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalConfirmacionVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentConfirmacion}>
            <Text style={styles.modalConfirmIcon}>🚀</Text>
            <Text style={styles.modalConfirmTitle}>CONFIRMAR MOVIMIENTO Y DESPACHO</Text>
            <Text style={styles.modalConfirmSubtitle}>
              Verifica los datos de la transferencia antes de transmitir a Supabase:
            </Text>

            <View style={styles.confirmRouteBox}>
              <View style={styles.confirmRouteItem}>
                <Text style={styles.confirmRouteLabel}>DESDE ORIGEN:</Text>
                <Text style={styles.confirmRouteVal}>🏛️ {almacen.nombre}</Text>
              </View>
              <Text style={styles.confirmRouteArrow}>➔</Text>
              <View style={styles.confirmRouteItem}>
                <Text style={styles.confirmRouteLabel}>HACIA DESTINO:</Text>
                <Text style={styles.confirmRouteValHighlight}>
                  🏬 {almacenDestinoSeleccionado?.nombre}
                </Text>
              </View>
            </View>

            <View style={styles.confirmSummaryBox}>
              <View style={styles.confirmSummaryRow}>
                <Text style={styles.confirmSummaryLabel}>Total Paletas:</Text>
                <Text style={styles.confirmSummaryVal}>{items.length} etiquetas</Text>
              </View>
              <View style={styles.confirmSummaryRow}>
                <Text style={styles.confirmSummaryLabel}>Cajas a retirar:</Text>
                <Text style={styles.confirmSummaryVal}>{totalCajasRetiradas} cajas</Text>
              </View>
              <View style={styles.confirmSummaryRow}>
                <Text style={styles.confirmSummaryLabel}>Unidades a descontar:</Text>
                <Text style={styles.confirmSummaryValRed}>-{totalUnidadesRetiradas} u</Text>
              </View>
            </View>

            {/* Listado rápido de tags a despachar */}
            <ScrollView style={styles.confirmItemsScroll}>
              {items.map((it) => (
                <View key={it.uid_tag} style={styles.confirmItemMiniCard}>
                  <View style={styles.confirmMiniHeader}>
                    <Text style={styles.confirmMiniTag}>{it.uid_tag}</Text>
                    <Text style={styles.confirmMiniTipo}>
                      {it.tipo_movimiento === 'RETIRO_PARCIAL' ? 'RETIRO PARCIAL' : 'COMPLETO'}
                    </Text>
                  </View>
                  <Text style={styles.confirmMiniSku}>{it.sku} · {it.nombre_producto}</Text>
                  <Text style={styles.confirmMiniQty}>
                    Retirando: {it.paquetes_a_retirar} cj ({it.unidades_a_retirar} u)
                    {it.tipo_movimiento === 'RETIRO_PARCIAL' && it.paquetes_restantes > 0
                      ? ` → Queda PUCHO con ${it.paquetes_restantes} cj`
                      : ' → Paleta se agota'}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <View style={styles.confirmActionRow}>
              <Pressable
                style={styles.confirmCancelBtn}
                onPress={() => {
                  void hapticImpact();
                  setModalConfirmacionVisible(false);
                }}
                disabled={enviando}
              >
                <Text style={styles.confirmCancelBtnText}>Cancelar</Text>
              </Pressable>

              <Pressable
                style={[styles.confirmExecuteBtn, enviando && styles.confirmBtnDisabled]}
                onPress={handleConfirmarDespacho}
                disabled={enviando}
              >
                {enviando ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.confirmExecuteBtnText}>
                    ✅ CONFIRMAR Y DESPACHAR
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  headerRight: {
    alignItems: 'flex-end',
  },
  badge: {
    color: '#00b4d8',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  nfcIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#10b981',
  },
  nfcDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
    marginRight: 6,
  },
  nfcText: {
    color: '#10b981',
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  scanBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#38bdf8',
    padding: 14,
    marginBottom: 16,
  },
  scanBannerIcon: {
    fontSize: 26,
    marginRight: 12,
  },
  scanBannerBody: {
    flex: 1,
  },
  scanBannerTitle: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: 'bold',
  },
  scanBannerSubtitle: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 14,
    marginBottom: 16,
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#090d16',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    fontFamily: 'monospace',
  },
  searchBtn: {
    backgroundColor: '#e52521',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  listHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  clearBtnText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyCard: {
    backgroundColor: '#090d16',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    borderStyle: 'dashed',
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
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
  itemCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 14,
    marginBottom: 14,
  },
  itemCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  itemTagInfo: {
    flex: 1,
  },
  itemUid: {
    color: '#38bdf8',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  itemSku: {
    color: '#f59e0b',
    fontSize: 13,
    fontWeight: 'bold',
    marginTop: 2,
  },
  itemNombre: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  itemHeaderRight: {
    alignItems: 'flex-end',
    gap: 8,
  },
  tagTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tagTypeCompleto: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10b981',
  },
  tagTypePucho: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  tagTypeBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    color: '#ffffff',
  },
  deleteBtn: {
    padding: 4,
  },
  deleteBtnText: {
    fontSize: 16,
  },
  stockInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#090d16',
    padding: 8,
    borderRadius: 6,
    marginTop: 10,
  },
  stockInfoLabel: {
    color: '#94a3b8',
    fontSize: 12,
  },
  stockInfoVal: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  operationTitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    marginTop: 12,
    marginBottom: 6,
  },
  typeSelectorRow: {
    flexDirection: 'row',
    gap: 8,
  },
  typeBtn: {
    flex: 1,
    backgroundColor: '#090d16',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 10,
  },
  typeBtnSelected: {
    backgroundColor: '#1e293b',
    borderColor: '#e52521',
  },
  typeBtnDisabled: {
    opacity: 0.45,
  },
  typeBtnText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  typeBtnTextSelected: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  typeBtnSub: {
    color: '#64748b',
    fontSize: 10,
    marginTop: 2,
  },
  partialCard: {
    backgroundColor: '#090d16',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 12,
    marginTop: 10,
  },
  partialTitle: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepperBtn: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    width: 38,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#475569',
  },
  stepperBtnText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  stepperValBox: {
    alignItems: 'center',
    minWidth: 60,
  },
  stepperValText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  stepperUnitText: {
    color: '#94a3b8',
    fontSize: 10,
  },
  impactBox: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  impactText: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  impactBold: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  impactPuchoNotice: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 4,
  },
  motivoContainer: {
    marginTop: 10,
  },
  motivoLabel: {
    color: '#94a3b8',
    fontSize: 11,
    marginBottom: 4,
  },
  motivoInput: {
    backgroundColor: '#090d16',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#ffffff',
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  summaryCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 16,
    marginTop: 10,
  },
  summaryTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    paddingBottom: 6,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  summaryLabel: {
    color: '#94a3b8',
    fontSize: 13,
  },
  summaryVal: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  summaryValHighlight: {
    color: '#ef4444',
    fontSize: 15,
    fontWeight: 'bold',
  },
  confirmBtn: {
    backgroundColor: '#e52521',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  confirmBtnDisabled: {
    opacity: 0.6,
  },
  confirmBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  backButton: {
    marginTop: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#64748b',
    fontSize: 13,
  },
  successCard: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#10b981',
    padding: 24,
    alignItems: 'center',
  },
  successIcon: {
    fontSize: 48,
    marginBottom: 10,
  },
  successTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  successSubtitle: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  kpiContainer: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginBottom: 16,
  },
  kpiBox: {
    flex: 1,
    backgroundColor: '#090d16',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 12,
    alignItems: 'center',
  },
  kpiVal: {
    color: '#10b981',
    fontSize: 22,
    fontWeight: 'bold',
  },
  kpiLabel: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center',
  },
  detailsBox: {
    width: '100%',
    backgroundColor: '#090d16',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  detailsTitle: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  detailItem: {
    color: '#94a3b8',
    fontSize: 11,
    marginBottom: 3,
  },
  newActionBtn: {
    backgroundColor: '#10b981',
    width: '100%',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  newActionBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ef4444',
    padding: 22,
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
  },
  modalAlertIcon: {
    fontSize: 42,
    marginBottom: 6,
  },
  modalTitle: {
    color: '#ef4444',
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  modalSubtitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
    marginBottom: 14,
  },
  modalBodyCard: {
    backgroundColor: '#090d16',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 14,
    width: '100%',
    marginBottom: 16,
  },
  modalBodyText: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 6,
  },
  modalBold: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  modalPuchoHighlight: {
    color: '#f59e0b',
    fontWeight: 'bold',
  },
  modalUidTag: {
    color: '#38bdf8',
    fontSize: 13,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    backgroundColor: '#0f172a',
    padding: 6,
    borderRadius: 6,
    textAlign: 'center',
    marginVertical: 6,
  },
  modalCloseBtn: {
    backgroundColor: '#e52521',
    width: '100%',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCloseBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },

  // Selector de destino
  destinationCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#38bdf8',
    padding: 14,
    marginBottom: 16,
  },
  destinationHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  destinationEyebrow: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  changeDestinationBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  changeDestinationBtnText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: 'bold',
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#090d16',
    borderRadius: 8,
    padding: 10,
  },
  routePoint: {
    flex: 1,
  },
  routePointLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 2,
  },
  routePointName: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  routeArrow: {
    color: '#38bdf8',
    fontSize: 18,
    fontWeight: 'bold',
    paddingHorizontal: 8,
  },
  routePointDestino: {
    flex: 1,
    alignItems: 'flex-end',
  },
  routePointDestinoName: {
    color: '#10b981',
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'right',
  },

  // Modal selector de destino
  modalContentDestino: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#38bdf8',
    padding: 20,
    width: '100%',
    maxWidth: 440,
    maxHeight: '80%',
  },
  modalDestinoHeader: {
    marginBottom: 14,
  },
  modalDestinoTitle: {
    color: '#38bdf8',
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  modalDestinoSub: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  almacenesListScroll: {
    maxHeight: 300,
    marginBottom: 14,
  },
  almacenOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#090d16',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 12,
    marginBottom: 8,
  },
  almacenOptionCardSelected: {
    borderColor: '#10b981',
    backgroundColor: '#064e3b22',
  },
  almacenOptionIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  almacenOptionInfo: {
    flex: 1,
  },
  almacenOptionNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  almacenOptionName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  almacenOptionNameSelected: {
    color: '#10b981',
  },
  almacenActualBadge: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  almacenActualBadgeText: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: 'bold',
  },
  almacenOptionTipo: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2,
  },
  almacenOptionCheck: {
    color: '#10b981',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  modalDestinoCancelBtn: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalDestinoCancelText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: 'bold',
  },

  // Modal de confirmación de despacho
  modalContentConfirmacion: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#10b981',
    padding: 20,
    width: '100%',
    maxWidth: 440,
    maxHeight: '85%',
  },
  modalConfirmIcon: {
    fontSize: 36,
    textAlign: 'center',
    marginBottom: 6,
  },
  modalConfirmTitle: {
    color: '#10b981',
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    letterSpacing: 1,
    textAlign: 'center',
  },
  modalConfirmSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 14,
  },
  confirmRouteBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#090d16',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 12,
    marginBottom: 12,
  },
  confirmRouteItem: {
    flex: 1,
  },
  confirmRouteLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  confirmRouteVal: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  confirmRouteArrow: {
    color: '#10b981',
    fontSize: 18,
    fontWeight: 'bold',
    paddingHorizontal: 8,
  },
  confirmRouteValHighlight: {
    color: '#10b981',
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  confirmSummaryBox: {
    backgroundColor: '#090d16',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 12,
    marginBottom: 12,
  },
  confirmSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  confirmSummaryLabel: {
    color: '#94a3b8',
    fontSize: 12,
  },
  confirmSummaryVal: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  confirmSummaryValRed: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: 'bold',
  },
  confirmItemsScroll: {
    maxHeight: 180,
    marginBottom: 14,
  },
  confirmItemMiniCard: {
    backgroundColor: '#090d16',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 10,
    marginBottom: 6,
  },
  confirmMiniHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  confirmMiniTag: {
    color: '#38bdf8',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  confirmMiniTipo: {
    color: '#f59e0b',
    fontSize: 10,
    fontWeight: 'bold',
  },
  confirmMiniSku: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  confirmMiniQty: {
    color: '#94a3b8',
    fontSize: 11,
  },
  confirmActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmCancelBtn: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  confirmCancelBtnText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 'bold',
  },
  confirmExecuteBtn: {
    flex: 2,
    backgroundColor: '#10b981',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  confirmExecuteBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
});
