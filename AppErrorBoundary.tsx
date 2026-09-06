import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PostHogErrorBoundary } from 'posthog-react-native';

import { captureAppException } from './telemetry';

type GlobalErrorUtils = {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

function GlobalErrorHandler() {
  useEffect(() => {
    const errorUtils = (globalThis as typeof globalThis & { ErrorUtils?: GlobalErrorUtils })
      .ErrorUtils;
    if (errorUtils === undefined) {
      return;
    }

    const previousHandler = errorUtils.getGlobalHandler?.();
    const globalHandler = (error: unknown, isFatal?: boolean) => {
      captureAppException(error, {
        error_source: 'global_error_handler',
        fatal: isFatal ?? false,
      });
      previousHandler?.(error, isFatal);
    };

    errorUtils.setGlobalHandler(globalHandler);
    return () => {
      if (previousHandler !== undefined) {
        errorUtils.setGlobalHandler(previousHandler);
      }
    };
  }, []);

  return null;
}

export default function AppErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <PostHogErrorBoundary
      additionalProperties={{ error_source: 'react_error_boundary' }}
      fallback={
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>The error was reported for diagnosis.</Text>
        </View>
      }
    >
      <GlobalErrorHandler />
      {children}
    </PostHogErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#4F5051',
    fontSize: 20,
    fontWeight: '700',
  },
  message: {
    color: '#6F777C',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
});