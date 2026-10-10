import NfcManager, { NfcEvents, NfcAdapter, TagEvent } from 'react-native-nfc-manager';
import { Platform } from 'react-native';

let nfcInitialized = false;
let isNfcSessionActive = false;
let initPromise: Promise<boolean> | null = null;

/**
 * Timeout auxiliar para evitar que llamadas a módulos nativos queden colgadas indefinidamente
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Inicializa el subsistema NFC del dispositivo de forma segura
 */
export async function initNfc(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  if (nfcInitialized) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      await withTimeout(NfcManager.start(), 1500, null);
      nfcInitialized = true;
      const supported = await withTimeout(NfcManager.isSupported(), 1000, false);
      return Boolean(supported);
    } catch (error) {
      console.warn('[NFC] No se pudo inicializar hardware NFC (puede estar en Expo Go o emulador):', error);
      return false;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

/**
 * Verifica si el dispositivo cuenta con chip NFC
 */
export async function isNfcSupported(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const initialized = await initNfc();
    if (!initialized) return false;
    return Boolean(await withTimeout(NfcManager.isSupported(), 1000, false));
  } catch {
    return false;
  }
}

/**
 * Verifica si el NFC está encendido en los ajustes del sistema
 */
export async function isNfcEnabled(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const initialized = await initNfc();
    if (!initialized) return false;
    return Boolean(await withTimeout(NfcManager.isEnabled(), 1000, false));
  } catch {
    return false;
  }
}

/**
 * Abre los ajustes del sistema para que el operario active el NFC
 */
export async function openNfcSettings(): Promise<void> {
  try {
    await NfcManager.goToNfcSetting();
  } catch (err) {
    console.warn('[NFC] Error abriendo ajustes NFC:', err);
  }
}

/**
 * Inicia la sesión de escucha continua de tags RFID / NFC.
 * Utiliza Android ReaderMode / Foreground Dispatch para interceptar los tags directamente
 * en la app, evitando que el sistema operativo Android los abra en visores externos.
 * Retorna una función para cancelar la sesión de escucha.
 */
export async function startNfcSession(
  onTagDiscovered: (uid: string) => void
): Promise<() => void> {
  if (Platform.OS === 'web') {
    return () => {};
  }

  try {
    await initNfc();
    const supported = await NfcManager.isSupported();
    if (!supported) {
      console.log('[NFC] Hardware no soportado en este entorno.');
      return () => {};
    }

    // Detener cualquier sesión previa para asegurar un estado limpio
    await stopNfcSession();

    isNfcSessionActive = true;

    // Registrar callback en el listener de eventos DiscoverTag
    NfcManager.setEventListener(NfcEvents.DiscoverTag, (tag: TagEvent) => {
      if (tag && tag.id) {
        const cleanUid = formatTagUid(tag.id);
        if (cleanUid) {
          onTagDiscovered(cleanUid);
        }
      }
    });

    // En Android activamos ReaderMode para capturar los tags en primer plano sin interferencias del SO
    if (Platform.OS === 'android') {
      try {
        await NfcManager.registerTagEvent({
          invalidateAfterFirstRead: false,
          isReaderModeEnabled: true,
          readerModeFlags:
            NfcAdapter.FLAG_READER_NFC_A |
            NfcAdapter.FLAG_READER_NFC_B |
            NfcAdapter.FLAG_READER_NFC_V |
            NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK,
        });
      } catch (readerErr) {
        console.warn('[NFC] ReaderMode no soportado en este terminal, usando modo estándar:', readerErr);
        await NfcManager.registerTagEvent({
          invalidateAfterFirstRead: false,
        });
      }
    } else {
      await NfcManager.registerTagEvent({
        alertMessage: 'Acerque la etiqueta RFID a la parte posterior del smartphone',
        invalidateAfterFirstRead: false,
      });
    }

    console.log('[NFC] Sesión de escucha continua activa en el terminal.');
  } catch (ex: any) {
    if (ex?.message?.includes('cancelled')) {
      console.log('[NFC] Escaneo cancelado por el usuario.');
    } else {
      console.warn('[NFC] Excepción registrando escucha NFC:', ex);
    }
    isNfcSessionActive = false;
  }

  return () => {
    void stopNfcSession();
  };
}

/**
 * Detiene la sesión activa de lectura NFC y desregistra los listeners
 */
export async function stopNfcSession(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    isNfcSessionActive = false;
    NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
    await NfcManager.unregisterTagEvent();
    console.log('[NFC] Sesión de lectura NFC detenida.');
  } catch {
    // Silencioso si no había solicitud activa
  }
}

/**
 * Normaliza el UID del tag en formato legible en mayúsculas
 */
export function formatTagUid(rawUid: string): string {
  if (!rawUid) return '';
  // Elimina dos puntos o guiones y normaliza
  const sanitized = rawUid.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  // Formatea en pares de bytes si es largo (ej: 04:A2:3B:5C:8D)
  if (sanitized.length >= 8 && sanitized.length % 2 === 0) {
    return sanitized.match(/.{1,2}/g)?.join(':') ?? sanitized;
  }
  return sanitized;
}
