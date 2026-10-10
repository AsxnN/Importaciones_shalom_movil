import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, ActivityIndicator } from 'react-native';

import { Almacen, ScreenId, SesionPausada } from './src/types';
import {
  DEFAULT_WAREHOUSE,
  getActiveSession,
  getActiveWarehouse,
  getHapticEnabled,
  getOfflineQueue,
} from './src/services/storage';
import { setHapticsActive } from './src/lib/haptics';
import { supabase } from './src/lib/supabase';

// Pantallas del Sistema Táctico
import { LoginScreen } from './src/screens/LoginScreen';
import { SelectAlmacenScreen } from './src/screens/SelectAlmacenScreen';
import { StandbyScreen } from './src/screens/StandbyScreen';
import { MainMenuScreen } from './src/screens/MainMenuScreen';
import { RecepcionCiegaScreen } from './src/screens/RecepcionCiegaScreen';
import { ConsultaStockScreen } from './src/screens/ConsultaStockScreen';
import { MovimientosScreen } from './src/screens/MovimientosScreen';
import { ConteoMasivoScreen } from './src/screens/ConteoMasivoScreen';
import { ColaOfflineScreen } from './src/screens/ColaOfflineScreen';
import { InfoSistemaScreen } from './src/screens/InfoSistemaScreen';
import { ConfiguracionScreen } from './src/screens/ConfiguracionScreen';
import { HistorialScreen } from './src/screens/HistorialScreen';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenId>('LOGIN');
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [operarioEmail, setOperarioEmail] = useState<string | null>(null);

  const [almacen, setAlmacen] = useState<Almacen>(DEFAULT_WAREHOUSE);
  const [sesionPausada, setSesionPausada] = useState<SesionPausada | null>(null);
  const [colaCount, setColaCount] = useState(0);

  // Carga de preferencias, almacén activo y estado del dispositivo
  const refreshGlobalState = async () => {
    try {
      const [alm, paused, queue, haptic] = await Promise.all([
        getActiveWarehouse(),
        getActiveSession(),
        getOfflineQueue(),
        getHapticEnabled(),
      ]);
      setAlmacen(alm);
      setSesionPausada(paused);
      setColaCount(queue.length);
      setHapticsActive(haptic);
    } catch (error) {
      console.error('Error cargando estado global:', error);
    }
  };

  // Verificación de sesión previa al iniciar la app (Gatekeeper)
  useEffect(() => {
    async function initAuth() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.user?.email) {
          setOperarioEmail(session.user.email);
          await refreshGlobalState();
          setCurrentScreen('STANDBY');
        } else {
          setCurrentScreen('LOGIN');
        }
      } catch (err) {
        console.error('Error verificando sesión inicial:', err);
        setCurrentScreen('LOGIN');
      } finally {
        setCheckingAuth(false);
      }
    }

    void initAuth();

    // Escuchar eventos de inicio o cierre de sesión
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user?.email) {
          setOperarioEmail(session.user.email);
        } else {
          setOperarioEmail(null);
          setCurrentScreen('LOGIN');
        }
      }
    );

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  // Navegación rápida entre pantallas
  const navigateTo = (screen: ScreenId) => {
    setCurrentScreen(screen);
    void refreshGlobalState();
  };

  // Callback de inicio de sesión exitoso
  const handleLoginSuccess = async (email: string) => {
    setOperarioEmail(email);
    await refreshGlobalState();
    // Siempre pedir confirmar/asignar el almacén tras autenticarse
    setCurrentScreen('SELECT_ALMACEN');
  };

  // Callback tras seleccionar y confirmar el almacén de trabajo
  const handleAlmacenConfirmado = (nuevo: Almacen) => {
    setAlmacen(nuevo);
    setCurrentScreen('STANDBY');
  };

  if (checkingAuth) {
    return (
      <View style={[styles.root, styles.center]}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color="#e52521" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* 0. GATEKEEPER DE AUTENTICACIÓN INICIAL */}
      {currentScreen === 'LOGIN' && (
        <LoginScreen onLoginSuccess={handleLoginSuccess} />
      )}

      {/* 0.1 ASIGNACIÓN / SELECCIÓN DE ALMACÉN DE TRABAJO */}
      {currentScreen === 'SELECT_ALMACEN' && (
        <SelectAlmacenScreen
          almacenActual={almacen}
          operarioEmail={operarioEmail ?? 'Operario'}
          onAlmacenConfirmado={handleAlmacenConfirmado}
        />
      )}

      {/* 1. STANDBY / PANTALLA DE REPOSO */}
      {currentScreen === 'STANDBY' && (
        <StandbyScreen
          almacen={almacen}
          sesionPausada={sesionPausada}
          colaCount={colaCount}
          onEnterMenu={() => navigateTo('MAIN_MENU')}
          onOpenRecepcionPausada={() => navigateTo('MOD_3_RECEPCION')}
        />
      )}

      {/* 2. MENÚ PRINCIPAL (1.0) */}
      {currentScreen === 'MAIN_MENU' && (
        <MainMenuScreen
          almacen={almacen}
          colaCount={colaCount}
          tieneSesionPausada={sesionPausada !== null}
          onNavigate={(screenId) => navigateTo(screenId)}
          onBackToStandby={() => navigateTo('STANDBY')}
        />
      )}

      {/* 3. MÓDULO 3: RECEPCIÓN Y CONCILIACIÓN CIEGA RFID (RF-26) */}
      {currentScreen === 'MOD_3_RECEPCION' && (
        <RecepcionCiegaScreen
          almacen={almacen}
          onBackToMenu={() => navigateTo('MAIN_MENU')}
          onRefreshColaCount={() => void refreshGlobalState()}
        />
      )}

      {/* 4. MÓDULO 1: CONSULTA DE STOCK */}
      {currentScreen === 'MOD_1_STOCK' && (
        <ConsultaStockScreen
          almacen={almacen}
          onBackToMenu={() => navigateTo('MAIN_MENU')}
          onNavigateToRecepcion={() => navigateTo('MOD_3_RECEPCION')}
        />
      )}

      {/* 5. MÓDULO 2: ESCANEAR TAG / MOVIMIENTOS */}
      {currentScreen === 'MOD_2_MOVIMIENTOS' && (
        <MovimientosScreen
          almacen={almacen}
          onBackToMenu={() => navigateTo('MAIN_MENU')}
        />
      )}

      {/* 6. MÓDULO 4: CONTEO MASIVO / AUDITORÍA ERI */}
      {currentScreen === 'MOD_4_AUDITORIA' && (
        <ConteoMasivoScreen
          almacen={almacen}
          onBackToMenu={() => navigateTo('MAIN_MENU')}
        />
      )}

      {/* 7. MÓDULO 5: COLA PENDIENTES OFFLINE */}
      {currentScreen === 'MOD_5_COLA_OFFLINE' && (
        <ColaOfflineScreen
          onBackToMenu={() => navigateTo('MAIN_MENU')}
          onRefreshColaCount={() => void refreshGlobalState()}
        />
      )}

      {/* 8. MÓDULO 6: INFO / DIAGNÓSTICO */}
      {currentScreen === 'MOD_6_INFO' && (
        <InfoSistemaScreen
          almacen={almacen}
          onBackToMenu={() => navigateTo('MAIN_MENU')}
        />
      )}

      {/* 9. MÓDULO 7: CONFIGURACIÓN */}
      {currentScreen === 'MOD_7_CONFIG' && (
        <ConfiguracionScreen
          almacenActual={almacen}
          onAlmacenCambiado={(nuevo) => setAlmacen(nuevo)}
          onBackToMenu={() => navigateTo('MAIN_MENU')}
        />
      )}

      {/* 10. MÓDULO 8: HISTORIAL Y AUDITORÍA */}
      {currentScreen === 'MOD_8_HISTORIAL' && (
        <HistorialScreen
          almacen={almacen}
          onBackToMenu={() => navigateTo('MAIN_MENU')}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#070a12',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});