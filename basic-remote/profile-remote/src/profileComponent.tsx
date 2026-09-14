import React, { useState } from 'react';
import {
  Button,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export default function ProfileCard() {
  const [count, setCount] = useState(0);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        Profile Remote 🚀
      </Text>

      <Text>
        This component came from another bundle
      </Text>

      <Text style={styles.counter}>
        Clicks: {count}
      </Text>

      <Button
        title="Increment"
        onPress={() => setCount(value => value + 1)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: 24,
    padding: 24,
    borderWidth: 2,
    borderRadius: 16,
    gap: 16,
  },

  title: {
    fontSize: 24,
    fontWeight: '700',
  },

  counter: {
    fontSize: 18,
  },
});