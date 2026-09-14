import React from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const ProfileCard = React.lazy(
  () => import('profile/ProfileComponent'),
);

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.hostTitle}>
        Host Application
      </Text>

      <Text>
        This text belongs to the Host.
      </Text>

      <React.Suspense
        fallback={
          <View style={styles.loading}>
            <ActivityIndicator />

            <Text>
              Loading Profile Remote...
            </Text>
          </View>
        }>
        <ProfileCard />
      </React.Suspense>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
  },

  hostTitle: {
    marginHorizontal: 24,
    fontSize: 28,
    fontWeight: '700',
  },

  loading: {
    margin: 24,
    gap: 12,
  },
});