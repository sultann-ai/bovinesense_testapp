import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type DimensionValue,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  BleError,
  Characteristic,
  Device,
  Subscription,
} from 'react-native-ble-plx';

import { captureBleError } from './telemetry';

type AccelerometerReading = {
  x: number;
  y: number;
  z: number;
};

type TemperatureReading = {
  ambient: number | null;
  skin: number | null;
};

export type TelemetryPacket = {
  characteristicUUID: string;
  deviceId: string;
  receivedAt: string;
  payloadHex: string;
  payloadBytes: number[];
};

type LoggedTelemetryPacket = TelemetryPacket & {
  loggedAt: string;
};

type DashboardProps = {
  device: Device;
  serviceUUID: string;
  temperatureCharacteristicUUID: string;
  accelerometerCharacteristicUUID: string;
  parseTemperature?: (payloadBytes: number[]) => TemperatureReading;
  parseAccelerometer?: (payloadBytes: number[]) => AccelerometerReading;
  onPacket?: (packet: TelemetryPacket) => void | Promise<void>;
};

const COLORS = {
  background: '#F8F9FA',
  blue: '#7DBCE2',
  charcoal: '#4F5051',
  border: '#D9E0E4',
  muted: '#6F777C',
  white: '#FFFFFF',
};

const LOG_FLUSH_INTERVAL_MS = 500;

function decodeBase64(value: string): number[] {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  let buffer = 0;
  let bitCount = 0;

  for (const character of value) {
    if (character === '=') {
      break;
    }

    const digit = alphabet.indexOf(character);
    if (digit < 0) {
      continue;
    }

    buffer = (buffer << 6) | digit;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((buffer >> bitCount) & 0xff);
    }
  }

  return bytes;
}

function toSignedInt16(lowByte: number, highByte: number): number {
  const value = lowByte | (highByte << 8);
  return value & 0x8000 ? value - 0x10000 : value;
}

function defaultParseTemperature(payloadBytes: number[]): TemperatureReading {
  return {
    ambient:
      payloadBytes.length >= 2
        ? toSignedInt16(payloadBytes[0], payloadBytes[1]) / 100
        : null,
    skin:
      payloadBytes.length >= 4
        ? toSignedInt16(payloadBytes[2], payloadBytes[3]) / 100
        : null,
  };
}

function defaultParseAccelerometer(payloadBytes: number[]): AccelerometerReading {
  return {
    x: payloadBytes.length >= 2 ? toSignedInt16(payloadBytes[0], payloadBytes[1]) / 1000 : 0,
    y: payloadBytes.length >= 4 ? toSignedInt16(payloadBytes[2], payloadBytes[3]) / 1000 : 0,
    z: payloadBytes.length >= 6 ? toSignedInt16(payloadBytes[4], payloadBytes[5]) / 1000 : 0,
  };
}

function bytesToHex(payloadBytes: number[]): string {
  return payloadBytes.map((byte) => byte.toString(16).padStart(2, '0')).join(' ').toUpperCase();
}

function formatTemperature(value: number | null): string {
  return value === null ? '--' : `${value.toFixed(2)} C`;
}

function AxisMeter({ axis, value }: { axis: string; value: number }) {
  const meterWidth: DimensionValue = `${Math.min(Math.abs(value), 2) * 25}%`;

  return (
    <View style={styles.axisRow}>
      <Text style={styles.axisLabel}>{axis}</Text>
      <View style={styles.axisTrack}>
        <View style={[styles.axisFill, { width: meterWidth }]} />
        <View style={styles.axisCenter} />
      </View>
      <Text style={styles.axisValue}>{value.toFixed(3)} g</Text>
    </View>
  );
}

export default function Dashboard({
  device,
  serviceUUID,
  temperatureCharacteristicUUID,
  accelerometerCharacteristicUUID,
  parseTemperature = defaultParseTemperature,
  parseAccelerometer = defaultParseAccelerometer,
  onPacket,
}: DashboardProps) {
  const [temperature, setTemperature] = useState<TemperatureReading>({ ambient: null, skin: null });
  const [accelerometer, setAccelerometer] = useState<AccelerometerReading>({ x: 0, y: 0, z: 0 });
  const [rawPayload, setRawPayload] = useState('--');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubscribing, setIsSubscribing] = useState(true);
  const [isLogging, setIsLogging] = useState(false);
  const [loggedPacketCount, setLoggedPacketCount] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const pendingFrameRef = useRef<{
    temperature?: TemperatureReading;
    accelerometer?: AccelerometerReading;
    rawPayload?: string;
  }>({});
  const frameRef = useRef<number | null>(null);
  const logQueueRef = useRef<Promise<void>>(Promise.resolve());
  const isLoggingRef = useRef(false);
  const loggedPacketsRef = useRef<LoggedTelemetryPacket[]>([]);
  const sessionFileUriRef = useRef<string | null>(null);
  const fileWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const fileFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queueJsonWrite = useCallback((snapshot: LoggedTelemetryPacket[], fileUri: string) => {
    fileWriteQueueRef.current = fileWriteQueueRef.current
      .then(() => FileSystem.writeAsStringAsync(fileUri, JSON.stringify(snapshot)))
      .catch(() => undefined);
    return fileWriteQueueRef.current;
  }, []);

  const flushSessionToDisk = useCallback(() => {
    const fileUri = sessionFileUriRef.current;
    if (fileUri === null) {
      return fileWriteQueueRef.current;
    }

    return queueJsonWrite([...loggedPacketsRef.current], fileUri);
  }, [queueJsonWrite]);

  const scheduleSessionFlush = useCallback(() => {
    if (fileFlushTimerRef.current !== null) {
      return;
    }

    fileFlushTimerRef.current = setTimeout(() => {
      fileFlushTimerRef.current = null;
      void flushSessionToDisk();
      startTransition(() => setLoggedPacketCount(loggedPacketsRef.current.length));
    }, LOG_FLUSH_INTERVAL_MS);
  }, [flushSessionToDisk]);

  const startLogging = useCallback(() => {
    if (FileSystem.documentDirectory === null) {
      setErrorMessage('Local storage is unavailable.');
      return;
    }

    const sessionFileUri = `${FileSystem.documentDirectory}bovinesense-session-${Date.now()}.json`;
    loggedPacketsRef.current = [];
    sessionFileUriRef.current = sessionFileUri;
    isLoggingRef.current = true;
    setLoggedPacketCount(0);
    setIsLogging(true);
    setErrorMessage(null);
    void queueJsonWrite([], sessionFileUri);
  }, [queueJsonWrite]);

  const stopLogging = useCallback(async () => {
    isLoggingRef.current = false;
    if (fileFlushTimerRef.current !== null) {
      clearTimeout(fileFlushTimerRef.current);
      fileFlushTimerRef.current = null;
    }

    await flushSessionToDisk();
    setLoggedPacketCount(loggedPacketsRef.current.length);
    setIsLogging(false);
  }, [flushSessionToDisk]);

  const escapeCsv = (value: string | number | null) => {
    const text = value === null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };

  const exportData = useCallback(async () => {
    if (loggedPacketsRef.current.length === 0 || FileSystem.cacheDirectory === null) {
      setErrorMessage('Start logging and collect data before exporting.');
      return;
    }

    setIsExporting(true);
    setErrorMessage(null);

    try {
      await flushSessionToDisk();
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        throw new Error('Data sharing is unavailable on this device.');
      }

      const header = 'loggedAt,receivedAt,deviceId,characteristicUUID,payloadHex,payloadBytes';
      const rows = loggedPacketsRef.current.map((packet) =>
        [
          packet.loggedAt,
          packet.receivedAt,
          packet.deviceId,
          packet.characteristicUUID,
          packet.payloadHex,
          packet.payloadBytes.join(' '),
        ]
          .map(escapeCsv)
          .join(','),
      );
      const csv = [header, ...rows].join('\n');
      const csvUri = `${FileSystem.cacheDirectory}bovinesense-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(csvUri, csv);
      await Sharing.shareAsync(csvUri, {
        dialogTitle: 'Export BovineSense telemetry',
        mimeType: 'text/csv',
        UTI: 'public.comma-separated-values-text',
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to export telemetry.');
    } finally {
      setIsExporting(false);
    }
  }, [flushSessionToDisk]);

  useEffect(() => {
    let isMounted = true;
    const subscriptions: Subscription[] = [];

    const flushPendingFrame = () => {
      frameRef.current = null;
      const pending = pendingFrameRef.current;
      pendingFrameRef.current = {};

      startTransition(() => {
        if (pending.temperature !== undefined) {
          setTemperature(pending.temperature);
        }
        if (pending.accelerometer !== undefined) {
          setAccelerometer(pending.accelerometer);
        }
        if (pending.rawPayload !== undefined) {
          setRawPayload(pending.rawPayload);
        }
      });
    };

    const scheduleFrame = () => {
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(flushPendingFrame);
      }
    };

    const enqueuePacket = (characteristic: Characteristic) => {
      if (characteristic.value === null) {
        return [];
      }

      const payloadBytes = decodeBase64(characteristic.value);
      const packet: TelemetryPacket = {
        characteristicUUID: characteristic.uuid,
        deviceId: device.id,
        receivedAt: new Date().toISOString(),
        payloadHex: bytesToHex(payloadBytes),
        payloadBytes,
      };

      if (isLoggingRef.current) {
        loggedPacketsRef.current.push({
          ...packet,
          loggedAt: new Date().toISOString(),
        });
        scheduleSessionFlush();
      }

      logQueueRef.current = logQueueRef.current
        .then(async () => {
          await onPacket?.(packet);
        })
        .catch(() => undefined);

      pendingFrameRef.current.rawPayload = packet.payloadHex || '--';
      scheduleFrame();
      return payloadBytes;
    };

    const handleTemperature = (error: BleError | null, characteristic: Characteristic | null) => {
      if (error !== null) {
        captureBleError(error, {
          ble_operation: 'temperature_subscription',
          device_id: device.id,
        });
        if (isMounted) {
          setErrorMessage(error.message);
        }
        return;
      }
      if (characteristic !== null) {
        const payloadBytes = enqueuePacket(characteristic);
        pendingFrameRef.current.temperature = parseTemperature(payloadBytes);
        scheduleFrame();
      }
    };

    const handleAccelerometer = (error: BleError | null, characteristic: Characteristic | null) => {
      if (error !== null) {
        captureBleError(error, {
          ble_operation: 'accelerometer_subscription',
          device_id: device.id,
        });
        if (isMounted) {
          setErrorMessage(error.message);
        }
        return;
      }
      if (characteristic !== null) {
        const payloadBytes = enqueuePacket(characteristic);
        pendingFrameRef.current.accelerometer = parseAccelerometer(payloadBytes);
        scheduleFrame();
      }
    };

    try {
      subscriptions.push(
        device.monitorCharacteristicForService(
          serviceUUID,
          temperatureCharacteristicUUID,
          handleTemperature,
        ),
        device.monitorCharacteristicForService(
          serviceUUID,
          accelerometerCharacteristicUUID,
          handleAccelerometer,
        ),
      );
      setIsSubscribing(false);
    } catch (error) {
      captureBleError(error, { ble_operation: 'telemetry_subscription', device_id: device.id });
      setIsSubscribing(false);
      setErrorMessage(error instanceof Error ? error.message : 'Unable to subscribe to telemetry.');
    }

    return () => {
      isMounted = false;
      subscriptions.forEach((subscription) => subscription.remove());
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      isLoggingRef.current = false;
      if (fileFlushTimerRef.current !== null) {
        clearTimeout(fileFlushTimerRef.current);
      }
      void flushSessionToDisk();
    };
  }, [
    accelerometerCharacteristicUUID,
    device,
    onPacket,
    parseAccelerometer,
    parseTemperature,
    scheduleSessionFlush,
    serviceUUID,
    temperatureCharacteristicUUID,
  ]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Telemetry dashboard</Text>
          <Text style={styles.deviceId}>{device.name ?? device.localName ?? device.id}</Text>
          <Text style={styles.connectionStatus}>Connected</Text>
        </View>
        {isSubscribing && <ActivityIndicator color={COLORS.blue} />}
      </View>

      <View style={styles.loggingBar}>
        <View style={styles.loggingCopy}>
          <Text style={styles.loggingTitle}>{isLogging ? 'Logging active' : 'Logging stopped'}</Text>
          <Text style={styles.loggingCount}>{loggedPacketCount} packets saved locally</Text>
        </View>
        <View style={styles.loggingActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isLogging }}
            disabled={isLogging}
            onPress={startLogging}
            style={({ pressed }) => [
              styles.startButton,
              pressed && styles.buttonPressed,
              isLogging && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.startButtonText}>Start Logging</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !isLogging }}
            disabled={!isLogging}
            onPress={() => void stopLogging()}
            style={({ pressed }) => [
              styles.stopButton,
              pressed && styles.buttonPressed,
              !isLogging && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.stopButtonText}>Stop Logging</Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: loggedPacketCount === 0 || isExporting }}
        disabled={loggedPacketCount === 0 || isExporting}
        onPress={() => void exportData()}
        style={({ pressed }) => [
          styles.exportButton,
          pressed && styles.buttonPressed,
          (loggedPacketCount === 0 || isExporting) && styles.buttonDisabled,
        ]}
      >
        {isExporting ? (
          <ActivityIndicator color={COLORS.charcoal} />
        ) : (
          <Text style={styles.exportButtonText}>Export Data</Text>
        )}
      </Pressable>

      {errorMessage !== null && (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {errorMessage}
        </Text>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Temperature</Text>
        <View style={styles.temperatureGrid}>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Ambient</Text>
            <Text style={styles.metricValue}>{formatTemperature(temperature.ambient)}</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Skin</Text>
            <Text style={styles.metricValue}>{formatTemperature(temperature.skin)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>3-axis accelerometer</Text>
        <AxisMeter axis="X" value={accelerometer.x} />
        <AxisMeter axis="Y" value={accelerometer.y} />
        <AxisMeter axis="Z" value={accelerometer.z} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Raw payload</Text>
        <Text selectable style={styles.rawPayload}>
          {rawPayload}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.background,
    flexGrow: 1,
    padding: 20,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    color: COLORS.charcoal,
    fontSize: 22,
    fontWeight: '700',
  },
  deviceId: {
    color: COLORS.charcoal,
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 6,
  },
  connectionStatus: {
    color: '#35734F',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  errorText: {
    backgroundColor: '#FDECEC',
    borderRadius: 6,
    color: '#8A3030',
    marginBottom: 12,
    padding: 12,
  },
  loggingBar: {
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    padding: 12,
  },
  loggingCopy: {
    flex: 1,
    marginRight: 10,
  },
  loggingTitle: {
    color: COLORS.charcoal,
    fontSize: 14,
    fontWeight: '700',
  },
  loggingCount: {
    color: COLORS.muted,
    fontFamily: 'monospace',
    fontSize: 11,
    marginTop: 4,
  },
  loggingActions: {
    flexDirection: 'row',
    gap: 6,
  },
  startButton: {
    alignItems: 'center',
    backgroundColor: COLORS.blue,
    borderRadius: 6,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 10,
  },
  stopButton: {
    alignItems: 'center',
    backgroundColor: COLORS.charcoal,
    borderRadius: 6,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 10,
  },
  startButtonText: {
    color: COLORS.charcoal,
    fontSize: 12,
    fontWeight: '700',
  },
  stopButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '700',
  },
  exportButton: {
    alignItems: 'center',
    backgroundColor: COLORS.blue,
    borderRadius: 6,
    justifyContent: 'center',
    marginBottom: 14,
    minHeight: 44,
  },
  exportButtonText: {
    color: COLORS.charcoal,
    fontSize: 14,
    fontWeight: '700',
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  section: {
    backgroundColor: COLORS.white,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    padding: 16,
  },
  sectionTitle: {
    color: COLORS.charcoal,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 14,
  },
  temperatureGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  metric: {
    backgroundColor: COLORS.background,
    borderRadius: 6,
    flex: 1,
    padding: 12,
  },
  metricLabel: {
    color: COLORS.muted,
    fontSize: 13,
  },
  metricValue: {
    color: COLORS.charcoal,
    fontFamily: 'monospace',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 8,
  },
  axisRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 14,
  },
  axisLabel: {
    color: COLORS.charcoal,
    fontSize: 14,
    fontWeight: '700',
    width: 22,
  },
  axisTrack: {
    backgroundColor: '#E8EDF0',
    borderRadius: 3,
    flex: 1,
    height: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  axisFill: {
    backgroundColor: COLORS.blue,
    height: '100%',
  },
  axisCenter: {
    backgroundColor: COLORS.charcoal,
    height: '100%',
    left: '50%',
    position: 'absolute',
    width: 1,
  },
  axisValue: {
    color: COLORS.charcoal,
    fontFamily: 'monospace',
    fontSize: 12,
    textAlign: 'right',
    width: 76,
  },
  rawPayload: {
    backgroundColor: COLORS.charcoal,
    borderRadius: 6,
    color: COLORS.white,
    fontFamily: 'monospace',
    fontSize: 12,
    minHeight: 48,
    padding: 12,
  },
});