import { Platform } from 'react-native';

/**
 * Dashboard de cenários (repo ~/Desktop/test-module-federation, porta 4000).
 * Só em desenvolvimento: em build de release vale `null` e o host usa só o manifesto embarcado.
 * Se o dashboard não estiver rodando, o fetch falha rápido e o host também cai no embarcado.
 */
export const DEV_DASHBOARD_URL: string | null = __DEV__
  ? Platform.OS === 'android'
    ? 'http://10.0.2.2:4000'
    : 'http://localhost:4000'
  : null;
