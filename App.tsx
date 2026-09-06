import './global.css';

import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { PostHogProvider } from 'posthog-react-native';

import AppErrorBoundary from './AppErrorBoundary';
import BLEScanner from './BLEScanner';
import { posthog } from './telemetry';

export default function App() {
  return (
    <PostHogProvider client={posthog}>
      <AppErrorBoundary>
        <View style={styles.container}>
          <BLEScanner />
          <StatusBar style="auto" />
        </View>
      </AppErrorBoundary>
    </PostHogProvider>
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
