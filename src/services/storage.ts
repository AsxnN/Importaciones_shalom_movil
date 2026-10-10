import AsyncStorage from '@react-native-async-storage/async-storage';
import { Almacen, SesionPausada, TransaccionOffline } from '../types';

const STORAGE_KEYS = {
  ACTIVE_WAREHOUSE: '@shalom_active_warehouse',
  OFFLINE_QUEUE: '@shalom_offline_queue',
  ACTIVE_SESSION: '@shalom_active_session',
  HAPTIC_ENABLED: '@shalom_haptic_enabled',
} as const;

export const DEFAULT_WAREHOUSE: Almacen = {
  id_almacen: 1,
  nombre: 'Almacén Principal',
  tipo: 'PRINCIPAL',
  capacidad_m3: 500,
  activo: true,
};

// 1. Almacén Activo
export async function getActiveWarehouse(): Promise<Almacen> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.ACTIVE_WAREHOUSE);
    if (!raw) return DEFAULT_WAREHOUSE;
    return JSON.parse(raw) as Almacen;
  } catch {
    return DEFAULT_WAREHOUSE;
  }
}

export async function setActiveWarehouse(almacen: Almacen): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.ACTIVE_WAREHOUSE, JSON.stringify(almacen));
  } catch (error) {
    console.error('Error guardando almacén activo:', error);
  }
}

// 2. Cola Offline
export async function getOfflineQueue(): Promise<TransaccionOffline[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.OFFLINE_QUEUE);
    if (!raw) return [];
    return JSON.parse(raw) as TransaccionOffline[];
  } catch {
    return [];
  }
}

export async function enqueueOfflineTransaction(
  tx: Omit<TransaccionOffline, 'id' | 'creado_en' | 'intentos_sincronizacion'>
): Promise<TransaccionOffline> {
  const fullTx: TransaccionOffline = {
    ...tx,
    id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    creado_en: new Date().toISOString(),
    intentos_sincronizacion: 0,
  };

  try {
    const currentQueue = await getOfflineQueue();
    currentQueue.push(fullTx);
    await AsyncStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(currentQueue));
  } catch (error) {
    console.error('Error encolando transacción offline:', error);
  }

  return fullTx;
}

export async function removeOfflineTransaction(txId: string): Promise<void> {
  try {
    const currentQueue = await getOfflineQueue();
    const filtered = currentQueue.filter((item) => item.id !== txId);
    await AsyncStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error eliminando transacción de la cola offline:', error);
  }
}

export async function clearOfflineQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEYS.OFFLINE_QUEUE);
  } catch (error) {
    console.error('Error limpiando cola offline:', error);
  }
}

// 3. Sesión Activa de Recepción Pausada
export async function getActiveSession(): Promise<SesionPausada | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION);
    if (!raw) return null;
    return JSON.parse(raw) as SesionPausada;
  } catch {
    return null;
  }
}

export async function saveActiveSession(session: SesionPausada): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.ACTIVE_SESSION, JSON.stringify(session));
  } catch (error) {
    console.error('Error guardando sesión activa de recepción:', error);
  }
}

export async function clearActiveSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEYS.ACTIVE_SESSION);
  } catch (error) {
    console.error('Error limpiando sesión activa de recepción:', error);
  }
}

// 4. Configuración Háptica
export async function getHapticEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.HAPTIC_ENABLED);
    if (raw === null) return true;
    return raw === 'true';
  } catch {
    return true;
  }
}

export async function saveHapticEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.HAPTIC_ENABLED, enabled ? 'true' : 'false');
  } catch (error) {
    console.error('Error guardando preferencia háptica:', error);
  }
}
