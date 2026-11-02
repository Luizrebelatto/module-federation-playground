import { Platform } from 'react-native';

export const DEV_DASHBOARD_URL: string | null = __DEV__
  ? Platform.OS === 'android'
    ? 'http://10.0.2.2:4000'
    : 'http://localhost:4000'
  : null;
