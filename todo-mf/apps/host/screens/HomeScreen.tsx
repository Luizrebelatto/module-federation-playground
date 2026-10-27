import { useEffect } from 'react';
import { Button, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { FederatedTodoWidget } from '../federation/FederatedTodoWidget';
import { preloadTodoScreen } from '../federation/preloadTodoScreen';
import type { RootStackParamList } from '../navigation/AppNavigation';

export function HomeScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Home'>) {
  useEffect(() => {
    void preloadTodoScreen();
  }, []);

  return (
    <View style={styles.container}>
      <FederatedTodoWidget />
      <Button title="Todo (remote, com fallback)" onPress={() => navigation.navigate('Todo')} />
      <Button title="Todo local" onPress={() => navigation.navigate('LocalTodo')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});