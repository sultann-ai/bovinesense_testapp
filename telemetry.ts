import { PostHog } from 'posthog-react-native';

const posthogApiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? '';
const posthogHost = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

export const posthog = new PostHog(posthogApiKey, {
  host: posthogHost,
  errorTracking: {
    autocapture: {
      console: false,
      uncaughtExceptions: true,
      unhandledRejections: true,
    },
  },
});

export function captureAppException(error: unknown, properties: Record<string, unknown> = {}) {
  posthog.captureException(error, {
    app_area: 'bovinesense-test-app',
    ...properties,
  });
}

export function captureBleError(
  error: unknown,
  properties: Record<string, unknown> = {},
) {
  const message = error instanceof Error ? error.message : String(error);
  const isTimeout = /timeout|timed out/i.test(message);

  posthog.capture(isTimeout ? 'ble_connection_timeout' : 'ble_error', {
    app_area: 'bovinesense-test-app',
    error_message: message,
    error_name: error instanceof Error ? error.name : 'UnknownError',
    ...properties,
  });

  if (isTimeout) {
    captureAppException(error, {
      error_category: 'ble_connection_timeout',
      ...properties,
    });
  }
}