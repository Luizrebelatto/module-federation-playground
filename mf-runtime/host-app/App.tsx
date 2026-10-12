import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

const ProductCard = React.lazy(() => import('products/ProductCard'));

export default function App() {
  return (
    <View style={styles.container}>
      <Text>Host app</Text>
      <React.Suspense fallback={<Text>Loading product...</Text>}>
        <ProductCard />
      </React.Suspense>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
