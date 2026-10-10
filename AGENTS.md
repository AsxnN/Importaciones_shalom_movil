# Reglas y Protocolos del Proyecto — Shalom Móvil

## Documento Maestro de Contexto
El archivo `/home/ludam/Importaciones/shalom_movil/CONTEXTO_SISTEMA.md` es la **Fuente de Verdad** técnica y arquitectónica de la aplicación móvil.

## Protocolo Obligatorio para Desarrolladores y Agentes IA
Cada vez que realices modificaciones en este repositorio:
1. **Identifica el módulo o funcionalidad afectada:**
   - Módulo 4 (MOD-04): Recepción Táctica, Conciliación Ciega y Cola Offline
   - Módulo 2 (MOD-02): Consulta de Stock y Movimientos Inmediatos
   - Módulo 5 (MOD-05): Conteo Masivo y Auditoría ERI Móvil
   - Configuración, Diagnóstico y Conexión Supabase
2. **Actualiza `CONTEXTO_SISTEMA.md`:**
   - Si creas, modificas o eliminas pantallas, componentes o utilidades en `src/` o `App.tsx`, actualiza la lista de componentes frontend del documento.
   - Si cambias llamadas a Supabase, esquemas de la cola offline en AsyncStorage, RPCs o variables de entorno, actualiza la sección correspondiente.
   - Si cambia el estado de implementación de alguna función o flujo, actualiza el indicador de estado.
   - Añade una entrada con la fecha y descripción del cambio en la sección **8. Historial de Versiones del Contexto (Changelog)** de `CONTEXTO_SISTEMA.md`.

---

This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
