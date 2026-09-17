import React from 'react';

import {
  View,
  Text,
  StyleSheet,
} from 'react-native';

console.log('[REMOTE] ProductCard module evaluated');

export default function ProductCard() {
  console.log('[REMOTE] ProductCard rendered');

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        MacBook Pro
      </Text>

      <Text>Price: $1,999</Text>

      <Text>
        Loaded from Products Remote
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: 24,
    padding: 24,
    borderRadius: 16,
    borderWidth: 2,
    gap: 12,
  },

  title: {
    fontSize: 24,
    fontWeight: '700',
  },
});