import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  BleManager,
  Device,
  State as BleState,
} from 'react-native-ble-plx';

import { captureBleError } from './telemetry';

const SCAN_DURATION_MS = 10000;

async function requestBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  const permissions =
    Platform.Version >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const results = await PermissionsAndroid.requestMultiple(permissions);

  return permissions.every(
    (permission) => results[permission] === PermissionsAndroid.RESULTS.GRANTED,
  );
}

export default function BLEScanner() {
  const managerRef = useRef<BleManager | null>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [connectingDeviceId, setConnectingDeviceId] = useState<string | null>(null);
  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (managerRef.current === null) {
    managerRef.current = new BleManager();
  }

  const stopScan = useCallback(async () => {
    if (scanTimeoutRef.current !== null) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }

    await managerRef.current?.stopDeviceScan();
    setIsScanning(false);
  }, []);

  const startScan = useCallback(async () => {
    const manager = managerRef.current;
    if (manager === null) {
      return;
    }

    setErrorMessage(null);
    setDevices([]);

    const hasPermission = await requestBluetoothPermissions();
    if (!hasPermission) {
      setErrorMessage('Bluetooth permission is required to scan for devices.');
      return;
    }

    const state = await manager.state();
    if (state !== BleState.PoweredOn) {
      setErrorMessage(
        state === BleState.Unauthorized
          ? 'Bluetooth permission was not granted.'
          : 'Turn on Bluetooth to scan for nearby devices.',
      );
      return;
    }

    await stopScan();
    setIsScanning(true);

    await manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        captureBleError(error, { ble_operation: 'scan' });
        setErrorMessage(error.message);
        void stopScan();
        return;
      }

      if (device !== null) {
        setDevices((currentDevices) => {
          const existingIndex = currentDevices.findIndex((item) => item.id === device.id);
          if (existingIndex === -1) {
            return [...currentDevices, device];
          }

          const nextDevices = [...currentDevices];
          nextDevices[existingIndex] = device;
          return nextDevices;
        });
      }
    });

    scanTimeoutRef.current = setTimeout(() => {
      void stopScan();
    }, SCAN_DURATION_MS);
  }, [stopScan]);

  const connectToDevice = useCallback(async (device: Device) => {
    setConnectingDeviceId(device.id);
    setErrorMessage(null);

    try {
      const connectedDevice = await managerRef.current?.connectToDevice(device.id, {
        timeout: 10000,
      });

      if (connectedDevice !== undefined) {
        await connectedDevice.discoverAllServicesAndCharacteristics();
        setConnectedDeviceId(device.id);
      }
    } catch (error) {
      captureBleError(error, { ble_operation: 'connect', device_id: device.id });
      setErrorMessage(error instanceof Error ? error.message : 'Unable to connect to device.');
    } finally {
      setConnectingDeviceId(null);
    }
  }, []);

  useEffect(() => {
    const manager = managerRef.current;
    if (manager === null) {
      return;
    }

    const stateSubscription = manager.onStateChange((state) => {
      if (state === BleState.PoweredOn) {
        void startScan();
      }
    }, true);

    void startScan();

    return () => {
      stateSubscription.remove();
      void stopScan();
      void manager.destroy();
    };
  }, [startScan, stopScan]);

  const renderDevice = ({ item }: { item: Device }) => {
    const isConnecting = connectingDeviceId === item.id;
    const isConnected = connectedDeviceId === item.id;

    return (
      <View style={styles.deviceRow}>
        <View style={styles.deviceDetails}>
          <Text style={styles.deviceName}>{item.name ?? item.localName ?? 'Unnamed device'}</Text>
          <Text style={styles.deviceId}>{item.id}</Text>
          <Text style={styles.rssi}>RSSI: {item.rssi ?? 'N/A'} dBm</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Connect to ${item.name ?? item.id}`}
          disabled={isConnecting || isConnected}
          onPress={() => void connectToDevice(item)}
          style={({ pressed }) => [
            styles.connectButton,
            pressed && styles.connectButtonPressed,
            (isConnecting || isConnected) && styles.connectButtonDisabled,
          ]}
        >
          {isConnecting ? (
            <ActivityIndicator color={COLORS.charcoal} size="small" />
          ) : (
            <Text style={styles.connectButtonText}>{isConnected ? 'Connected' : 'Connect'}</Text>
          )}
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Nearby devices</Text>
          <Text style={styles.subtitle}>{isScanning ? 'Scanning for BLE devices...' : 'Scan complete'}</Text>
        </View>
        {isScanning && <ActivityIndicator color={COLORS.blue} />}
      </View>

      {errorMessage !== null && (
        <Pressable onPress={() => Alert.alert('Bluetooth', errorMessage)} style={styles.errorBanner}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </Pressable>
      )}

      <FlatList
        contentContainerStyle={devices.length === 0 ? styles.emptyList : undefined}
        data={devices}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {isScanning ? 'Waiting for nearby devices...' : 'No devices found.'}
          </Text>
        }
        renderItem={renderDevice}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Scan for nearby Bluetooth devices"
        onPress={() => void startScan()}
        style={({ pressed }) => [styles.scanButton, pressed && styles.scanButtonPressed]}
      >
        <Text style={styles.scanButtonText}>{isScanning ? 'Scan Again' : 'Scan Again'}</Text>
      </Pressable>
    </View>
  );
}

const COLORS = {
  background: '#F8F9FA',
  blue: '#7DBCE2',
  charcoal: '#4F5051',
  border: '#D9E0E4',
  muted: '#6F777C',
  white: '#FFFFFF',
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.background,
    flex: 1,
    padding: 20,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    color: COLORS.charcoal,
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 14,
    marginTop: 4,
  },
  deviceRow: {
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    padding: 14,
  },
  deviceDetails: {
    flex: 1,
    marginRight: 12,
  },
  deviceName: {
    color: COLORS.charcoal,
    fontSize: 16,
    fontWeight: '600',
  },
  deviceId: {
    color: COLORS.charcoal,
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 5,
  },
  rssi: {
    color: COLORS.muted,
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 3,
  },
  connectButton: {
    alignItems: 'center',
    backgroundColor: COLORS.blue,
    borderRadius: 6,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 88,
    paddingHorizontal: 12,
  },
  connectButtonPressed: {
    opacity: 0.75,
  },
  connectButtonDisabled: {
    opacity: 0.55,
  },
  connectButtonText: {
    color: COLORS.charcoal,
    fontSize: 13,
    fontWeight: '700',
  },
  errorBanner: {
    backgroundColor: '#FDECEC',
    borderRadius: 6,
    marginBottom: 12,
    padding: 12,
  },
  errorText: {
    color: '#8A3030',
    fontSize: 13,
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyText: {
    color: COLORS.muted,
    fontSize: 15,
    textAlign: 'center',
  },
  scanButton: {
    alignItems: 'center',
    backgroundColor: COLORS.charcoal,
    borderRadius: 6,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 46,
  },
  scanButtonPressed: {
    opacity: 0.8,
  },
  scanButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
  },
});