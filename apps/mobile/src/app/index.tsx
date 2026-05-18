import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type Connection = {
  serverUrl: string;
  deviceId: string;
  deviceToken: string;
};

type ConnectionPreferences = {
  serverUrl: string;
  deviceName: string;
};

type ActivityStep = {
  id: string;
  label: string;
  detail?: string;
  status: 'pending' | 'running' | 'done' | 'error';
  at?: string;
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  activity?: ActivityStep[];
  isStreaming?: boolean;
};

const STORAGE_KEY = 'compoota.connection.v1';
const PREFERENCES_KEY = 'compoota.connection-preferences.v1';
const MESSAGE_HISTORY_KEY_PREFIX = 'compoota.messages.v1.';
const SIDEBAR_EDGE_HIT_SLOP = 30;
const SIDEBAR_LAYER_RADIUS = 58;
const SIDEBAR_SPRING = {
  damping: 28,
  mass: 0.9,
  stiffness: 240,
};

const PENDING_ACTIVITY: ActivityStep[] = [
  {
    id: 'compoota.server.received.pending',
    label: 'Sending message to the house-server',
    status: 'done',
  },
  {
    id: 'compoota.server.auth.pending',
    label: 'Checking this device',
    status: 'done',
  },
  {
    id: 'compoota.agent.start.pending',
    label: 'Handing it to the local agent',
    detail: 'compoota is passing the request along.',
    status: 'running',
  },
];

function normalizeServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Enter the house-server URL.');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Enter a valid http:// or https:// server URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Use an http:// or https:// server URL.');
  }

  return url.toString().replace(/\/+$/, '');
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || `Request failed with status ${response.status}.`;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
}

function messageId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function messageHistoryKey(deviceId: string): string {
  return `${MESSAGE_HISTORY_KEY_PREFIX}${deviceId}`;
}

function activitySummary(activity: ActivityStep[], includeRunning = true): string {
  if (activity.some((step) => step.status === 'error')) {
    return 'compoota hit a snag';
  }

  const running = includeRunning ? [...activity].reverse().find((step) => step.status === 'running') : undefined;
  if (running) {
    return running.label;
  }

  const latest = [...activity].reverse().find((step) => step.status === 'done') ?? activity[activity.length - 1];
  return latest?.label ?? `${activity.length} step${activity.length === 1 ? '' : 's'} completed`;
}

function activityDuration(activity: ActivityStep[]): string | null {
  const times = activity
    .map((step) => (step.at ? Date.parse(step.at) : Number.NaN))
    .filter((time) => Number.isFinite(time));

  if (times.length < 2) {
    return null;
  }

  const seconds = Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function activityStatusText(message: Message): string {
  const activity = message.activity ?? [];
  if (message.isStreaming) {
    return activitySummary(activity, true);
  }

  const duration = activityDuration(activity);
  if (duration) {
    return `Worked for ${duration}`;
  }

  return activity.some((step) => step.status === 'error') ? 'compoota hit a snag' : 'Worked just now';
}

function mergeActivity(existing: ActivityStep[] = [], next: ActivityStep): ActivityStep[] {
  const filtered = existing.filter((step) => step.id !== next.id);
  return [...filtered, next];
}

function parseSseBlock(block: string): { event: string; data: unknown } | null {
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

function parseMessages(value: string | null): Message[] | null {
  if (!value) {
    return null;
  }

  const parsed = JSON.parse(value) as Message[];
  if (!Array.isArray(parsed)) {
    return null;
  }

  const messages = parsed.filter(
    (message) =>
      message &&
      typeof message.id === 'string' &&
      typeof message.text === 'string' &&
      (message.role === 'user' || message.role === 'assistant'),
  ).map((message) => ({
    ...message,
    activity: Array.isArray(message.activity) ? message.activity : undefined,
  }));

  return messages.length > 0 ? messages : null;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function streamCommandRequest({
  connection,
  text,
  onActivity,
  onReply,
}: {
  connection: Connection;
  text: string;
  onActivity: (step: ActivityStep) => void;
  onReply: (reply: string, activity?: ActivityStep[]) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let cursor = 0;
    let settled = false;
    let streamBuffer = '';

    function fail(error: Error) {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    }

    function consume(final = false) {
      const chunk = xhr.responseText.slice(cursor);
      cursor = xhr.responseText.length;
      streamBuffer += chunk;
      if (final && streamBuffer.trim()) {
        streamBuffer += '\n\n';
      }
      const blocks = streamBuffer.split(/\n\n/);
      streamBuffer = final ? '' : (blocks.pop() ?? '');

      for (const block of blocks) {
        const parsed = parseSseBlock(block);
        if (!parsed) {
          continue;
        }

        if (parsed.event === 'activity') {
          onActivity(parsed.data as ActivityStep);
        } else if (parsed.event === 'reply') {
          const data = parsed.data as { reply?: string; activity?: ActivityStep[] };
          onReply(data.reply || '', Array.isArray(data.activity) ? data.activity : undefined);
        } else if (parsed.event === 'error') {
          fail(new Error('Command failed.'));
        }
      }
    }

    xhr.open('POST', `${connection.serverUrl}/command/stream`);
    xhr.timeout = 180000;
    xhr.setRequestHeader('Authorization', `Bearer ${connection.deviceToken}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = () => {
      if (xhr.readyState === 3) {
        consume();
      }
    };
    xhr.onload = () => {
      consume(true);

      if (settled) {
        return;
      }

      if (xhr.status === 401) {
        fail(new Error('This device is unauthorized or revoked. Reset and pair again.'));
        return;
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        fail(new Error(`Command failed with status ${xhr.status}.`));
        return;
      }

      settled = true;
      resolve();
    };
    xhr.onerror = () => fail(new Error('Server unreachable. Check the URL and LAN connection.'));
    xhr.ontimeout = () => fail(new Error('compoota is taking too long to respond. Try again in a moment.'));
    xhr.send(JSON.stringify({ text }));
  });
}

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const isDark = colorScheme === 'dark';
  const styles = useMemo(() => createStyles(isDark, insets.bottom), [isDark, insets.bottom]);
  const colors = useMemo(() => createColors(isDark), [isDark]);
  const scrollRef = useRef<ScrollView>(null);
  const sidebarOpenDistance = Math.min(screenWidth * 0.76, 340);

  const [connection, setConnection] = useState<Connection | null>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [command, setCommand] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedActivityMessageId, setSelectedActivityMessageId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const sidebarTranslateX = useSharedValue(0);
  const sidebarGestureStartTranslateX = useSharedValue(0);
  const sidebarGestureEnabled = useSharedValue(false);
  const sidebarOpenValue = useSharedValue(false);

  const selectedActivityMessage = messages.find((message) => message.id === selectedActivityMessageId);
  const sidebarServerHost = useMemo(() => {
    if (!connection) {
      return '';
    }

    try {
      return new URL(connection.serverUrl).host;
    } catch {
      return connection.serverUrl;
    }
  }, [connection]);
  const openSidebar = () => {
    setSidebarOpen(true);
    sidebarOpenValue.value = true;
    sidebarTranslateX.value = withSpring(sidebarOpenDistance, SIDEBAR_SPRING);
  };

  const closeSidebar = () => {
    setSidebarOpen(false);
    sidebarOpenValue.value = false;
    sidebarTranslateX.value = withSpring(0, SIDEBAR_SPRING);
  };

  const sidebarPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-8, 8])
        .failOffsetY([-16, 16])
        .onBegin((event) => {
          sidebarGestureStartTranslateX.value = sidebarTranslateX.value;
          sidebarGestureEnabled.value =
            sidebarOpenValue.value || event.absoluteX <= SIDEBAR_EDGE_HIT_SLOP;
        })
        .onUpdate((event) => {
          if (!sidebarGestureEnabled.value) {
            return;
          }

          const nextTranslateX = Math.min(
            sidebarOpenDistance,
            Math.max(0, sidebarGestureStartTranslateX.value + event.translationX),
          );
          sidebarTranslateX.value = nextTranslateX;
        })
        .onEnd((event) => {
          if (!sidebarGestureEnabled.value) {
            return;
          }

          const projectedX = sidebarTranslateX.value + event.velocityX * 0.18;
          const shouldOpen =
            event.velocityX > 520 || (event.velocityX > -520 && projectedX > sidebarOpenDistance * 0.48);
          sidebarOpenValue.value = shouldOpen;
          sidebarTranslateX.value = withSpring(shouldOpen ? sidebarOpenDistance : 0, {
            ...SIDEBAR_SPRING,
            velocity: event.velocityX,
          });
          runOnJS(setSidebarOpen)(shouldOpen);
        }),
    [
      sidebarGestureEnabled,
      sidebarGestureStartTranslateX,
      sidebarOpenDistance,
      sidebarOpenValue,
      sidebarTranslateX,
    ],
  );

  const sidebarMainStyle = useAnimatedStyle(() => {
    const progress = sidebarOpenDistance > 0 ? sidebarTranslateX.value / sidebarOpenDistance : 0;
    const radius = interpolate(progress, [0, 1], [0, SIDEBAR_LAYER_RADIUS]);
    const layerScale = interpolate(progress, [0, 1], [1, 0.94]);

    return {
      borderTopLeftRadius: radius,
      borderTopRightRadius: radius,
      borderBottomLeftRadius: radius,
      borderBottomRightRadius: radius,
      borderWidth: interpolate(progress, [0, 1], [0, StyleSheet.hairlineWidth]),
      shadowOpacity: interpolate(progress, [0, 1], [0, 0.34]),
      transform: [
        { translateX: sidebarTranslateX.value },
        { scale: layerScale },
      ],
    };
  }, [sidebarOpenDistance]);

  const sidebarUnderlayStyle = useAnimatedStyle(() => {
    const progress = sidebarOpenDistance > 0 ? sidebarTranslateX.value / sidebarOpenDistance : 0;

    return {
      opacity: interpolate(progress, [0, 0.18, 1], [0.1, 0.62, 1]),
      transform: [{ translateX: interpolate(progress, [0, 1], [-28, 0]) }],
    };
  }, [sidebarOpenDistance]);

  useEffect(() => {
    if (sidebarOpenValue.value) {
      sidebarTranslateX.value = withSpring(sidebarOpenDistance, SIDEBAR_SPRING);
    }
  }, [sidebarOpenDistance, sidebarOpenValue, sidebarTranslateX]);

  useEffect(() => {
    async function loadConnection() {
      try {
        const [stored, preferences] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(PREFERENCES_KEY),
        ]);

        if (preferences) {
          const parsedPreferences = JSON.parse(preferences) as ConnectionPreferences;
          if (parsedPreferences.serverUrl) {
            setServerUrl(parsedPreferences.serverUrl);
          }
          if (parsedPreferences.deviceName) {
            setDeviceName(parsedPreferences.deviceName);
          }
        }

        if (stored) {
          const parsed = JSON.parse(stored) as Connection;
          if (parsed.serverUrl && parsed.deviceId && parsed.deviceToken) {
            const storedMessages = parseMessages(
              await AsyncStorage.getItem(messageHistoryKey(parsed.deviceId)),
            );
            setConnection(parsed);
            setServerUrl(parsed.serverUrl);
            setMessages(storedMessages ?? []);
          }
        }
      } catch {
        setError('Saved connection could not be loaded. Pair again to continue.');
      } finally {
        setLoading(false);
      }
    }

    loadConnection();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  useEffect(() => {
    if (!connection || loading) {
      return;
    }

    AsyncStorage.setItem(messageHistoryKey(connection.deviceId), JSON.stringify(messages)).catch(
      () => undefined,
    );
  }, [connection, loading, messages]);

  async function connect() {
    setError('');
    setBusy(true);

    try {
      const normalizedUrl = normalizeServerUrl(serverUrl);
      const cleanedCode = pairingCode.trim();
      const cleanedName =
        deviceName.trim() ||
        Platform.select({ ios: 'iPhone', android: 'Android', default: 'compoota device' });

      if (!/^\d{6}$/.test(cleanedCode)) {
        throw new Error('Enter the 6-digit pairing code from the setup page.');
      }

      const health = await fetchWithTimeout(`${normalizedUrl}/health`, { method: 'GET' }, 6000);
      if (!health.ok) {
        throw new Error(`Server health check failed with status ${health.status}.`);
      }

      const response = await fetchWithTimeout(
        `${normalizedUrl}/pair`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pairingCode: cleanedCode,
            deviceName: cleanedName,
          }),
        },
        12000,
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const data = (await response.json()) as { deviceId: string; deviceToken: string };
      const nextConnection = {
        serverUrl: normalizedUrl,
        deviceId: data.deviceId,
        deviceToken: data.deviceToken,
      };
      const nextPreferences = {
        serverUrl: normalizedUrl,
        deviceName: cleanedName,
      };

      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextConnection)),
        AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(nextPreferences)),
      ]);
      setConnection(nextConnection);
      setServerUrl(normalizedUrl);
      setPairingCode('');
      setDeviceName(cleanedName);
      setMessages([]);
    } catch (err) {
      const message =
        err instanceof TypeError
          ? 'Server unreachable. Check the URL and network connection.'
          : err instanceof Error && err.name === 'AbortError'
            ? 'Server did not respond. Check that the phone can reach the Pi.'
            : err instanceof Error
              ? err.message
              : 'Pairing failed.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function sendCommand() {
    if (!connection || busy) {
      return;
    }

    const text = command.trim();
    if (!text) {
      setError('Type a command first.');
      return;
    }

    setError('');
    setBusy(true);
    setCommand('');
    const assistantId = messageId();
    setMessages((current) => [
      ...current,
      { id: messageId(), role: 'user', text },
      {
        id: assistantId,
        role: 'assistant',
        text: '',
        activity: PENDING_ACTIVITY,
        isStreaming: true,
      },
    ]);

    function updateAssistant(updater: (message: Message) => Message) {
      setMessages((current) =>
        current.map((message) => (message.id === assistantId ? updater(message) : message)),
      );
    }

    try {
      await streamCommandRequest({
        connection,
        text,
        onActivity: (step) => {
          updateAssistant((message) => ({
            ...message,
            activity: mergeActivity(message.activity, step),
          }));
        },
        onReply: (reply, activity) => {
          updateAssistant((message) => ({
            ...message,
            text: reply,
            activity: activity ?? message.activity,
            isStreaming: false,
          }));
        },
      });

      updateAssistant((message) => ({ ...message, isStreaming: false }));
    } catch (err) {
      const message =
        err instanceof TypeError
          ? 'Server unreachable. Check the URL and network connection.'
          : err instanceof Error && err.name === 'AbortError'
            ? 'compoota is taking too long to respond. Try again in a moment.'
          : err instanceof Error
            ? err.message
            : 'Command failed.';
      setError(message);
      updateAssistant((current) => ({
        ...current,
        text: current.text || message,
        activity: mergeActivity(current.activity, {
          id: 'compoota.client.error',
          label: message,
          status: 'error',
          at: new Date().toISOString(),
        }),
        isStreaming: false,
      }));
    } finally {
      setBusy(false);
    }
  }

  async function resetConnection() {
    await AsyncStorage.removeItem(STORAGE_KEY);
    closeSidebar();
    setConnection(null);
    setCommand('');
    setError('');
    setMessages([]);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={colors.text} />
      </SafeAreaView>
    );
  }

  if (!connection) {
    return (
      <SafeAreaView style={styles.screen}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}>
          <View style={styles.connectPage}>
            <View style={styles.connectContent}>
              <Text style={styles.connectTitle}>compoota</Text>
              <Text style={styles.connectCopy}>
                enter your server url and a fresh pairing code from the pi.
              </Text>
            </View>

            <View style={styles.connectForm}>
              <View style={styles.field}>
                <Text style={styles.label}>server url</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  onChangeText={setServerUrl}
                  placeholder="http://192.168.1.50:8787"
                  placeholderTextColor={colors.placeholder}
                  style={styles.input}
                  value={serverUrl}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>pairing code</Text>
                <TextInput
                  keyboardType="number-pad"
                  maxLength={6}
                  onChangeText={setPairingCode}
                  placeholder="123456"
                  placeholderTextColor={colors.placeholder}
                  style={[styles.input, styles.codeInput]}
                  value={pairingCode}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>your name</Text>
                <TextInput
                  onChangeText={setDeviceName}
                  placeholder="Sean iPhone"
                  placeholderTextColor={colors.placeholder}
                  style={styles.input}
                  value={deviceName}
                />
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <View style={styles.connectActions}>
                <Pressable
                  disabled={busy}
                  onPress={connect}
                  style={({ pressed }) => [
                    styles.connectButton,
                    (pressed || busy) && styles.pressed,
                  ]}>
                  {busy ? (
                    <ActivityIndicator color={colors.actionText} />
                  ) : (
                    <Text style={styles.connectButtonText}>connect</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.sidebarStage}>
        <Animated.View
          pointerEvents={sidebarOpen ? 'auto' : 'none'}
          style={[
            styles.sidebarUnderlay,
            { width: sidebarOpenDistance },
            sidebarUnderlayStyle,
          ]}>
          <View style={styles.sidebarPanel}>
            <View style={styles.sidebarTop}>
              <Text style={styles.sidebarTitle}>compoota</Text>
              <Text numberOfLines={1} style={styles.sidebarMeta}>
                {sidebarServerHost ? `connected to ${sidebarServerHost}` : 'local companion'}
              </Text>
            </View>

            <View style={styles.sidebarFooter}>
              <Pressable
                onPress={resetConnection}
                style={({ pressed }) => [styles.sidebarLogout, pressed && styles.pressed]}>
                <Text style={styles.sidebarLogoutText}>logout</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>

        <GestureDetector gesture={sidebarPanGesture}>
          <Animated.View style={[styles.mainPanel, sidebarMainStyle]}>
            <SafeAreaView style={styles.chatSafeArea}>
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.keyboard}>
                <View style={styles.chatShell}>
                <Pressable
                  accessibilityLabel="Open sidebar"
                  onPress={openSidebar}
                  style={({ pressed }) => [styles.sidebarButton, pressed && styles.pressed]}>
                  <View style={styles.sidebarGlyph}>
                    <View style={styles.sidebarGlyphLine} />
                    <View style={[styles.sidebarGlyphLine, styles.sidebarGlyphLineShort]} />
                  </View>
                </Pressable>

                <ScrollView
                  ref={scrollRef}
                  contentContainerStyle={styles.messagesContent}
                  keyboardShouldPersistTaps="handled"
                  style={styles.messages}>
                  {messages.filter((message) => message.text || message.activity?.length).map((message) => (
                    <View
                      key={message.id}
                      style={[
                        styles.messageRow,
                        message.role === 'user' && styles.userMessageRow,
                      ]}>
                      <View
                        style={[
                          styles.message,
                          message.role === 'user' && styles.userMessage,
                        ]}>
                        {message.role === 'assistant' && message.activity?.length ? (
                          <Pressable
                            onPress={() => setSelectedActivityMessageId(message.id)}
                            style={({ pressed }) => [
                              styles.activityLine,
                              pressed && styles.activityLinePressed,
                            ]}>
                            <View style={styles.activityLineTextWrap}>
                              <Text numberOfLines={1} style={styles.activityLineTitle}>
                                {activityStatusText(message)}
                              </Text>
                            </View>
                          </Pressable>
                        ) : null}
                        {message.text ? (
                          <Text
                            style={[
                              styles.messageText,
                              message.role === 'assistant' &&
                                Boolean(message.activity?.length) &&
                                styles.assistantResponseText,
                              message.role === 'user' && styles.userMessageText,
                            ]}>
                            {message.text}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </ScrollView>

                {error ? <Text style={styles.chatError}>{error}</Text> : null}

                <View style={styles.composerWrap}>
                  <View style={[styles.composer, composerFocused && styles.composerFocused]}>
                    <TextInput
                      keyboardAppearance={isDark ? 'dark' : 'light'}
                      onBlur={() => setComposerFocused(false)}
                      onChangeText={setCommand}
                      onFocus={() => setComposerFocused(true)}
                      onSubmitEditing={Platform.OS === 'web' ? sendCommand : undefined}
                      placeholder="compoota..."
                      placeholderTextColor={colors.placeholder}
                      returnKeyType="default"
                      selectionColor={colors.selection}
                      style={styles.commandInput}
                      value={command}
                    />
                    <Pressable
                      disabled={busy}
                      onPress={sendCommand}
                      style={({ pressed }) => [
                        styles.sendButton,
                        (pressed || busy) && styles.pressed,
                      ]}>
                      {busy ? (
                        <Text style={styles.busyText}>...</Text>
                      ) : (
                        <Text style={styles.sendIcon}>↑</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
                </View>
              </KeyboardAvoidingView>
            </SafeAreaView>
            {sidebarOpen ? (
              <Pressable
                accessibilityLabel="Close sidebar"
                onPress={closeSidebar}
                style={styles.sidebarCloseCatcher}
              />
            ) : null}
          </Animated.View>
        </GestureDetector>
      </View>
      <Modal
        animationType="slide"
        onRequestClose={() => setSelectedActivityMessageId(null)}
        transparent
        visible={Boolean(selectedActivityMessage?.activity?.length)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSelectedActivityMessageId(null)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>compoota’s work</Text>
                <Text style={styles.sheetSubtitle}>
                  {selectedActivityMessage ? activityStatusText(selectedActivityMessage) : ''}
                </Text>
              </View>
              <Pressable onPress={() => setSelectedActivityMessageId(null)} style={styles.sheetClose}>
                <Text style={styles.sheetCloseText}>Done</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.sheetSteps} showsVerticalScrollIndicator={false}>
              {selectedActivityMessage?.activity?.map((step, index) => (
                <View
                  key={`${step.id}-${index}`}
                  style={[
                    styles.sheetStep,
                    step.status === 'done' &&
                      index < (selectedActivityMessage.activity?.length ?? 0) - 1 &&
                      styles.sheetStepQuiet,
                  ]}>
                  <View
                    style={[
                      styles.sheetStepDot,
                      selectedActivityMessage?.isStreaming &&
                        step.status === 'running' &&
                        styles.sheetStepDotRunning,
                      step.status === 'error' && styles.sheetStepDotError,
                    ]}
                  />
                  <View style={styles.sheetStepText}>
                    <Text style={styles.sheetStepLabel}>{step.label}</Text>
                    {step.detail ? <Text style={styles.sheetStepDetail}>{step.detail}</Text> : null}
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function createColors(isDark: boolean) {
  return {
    background: isDark ? '#111111' : '#f8f8f7',
    text: isDark ? '#f6f6f4' : '#171717',
    secondaryText: isDark ? '#a7a7a2' : '#686863',
    subtleText: isDark ? '#858580' : '#8f8f88',
    border: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(12,12,12,0.08)',
    input: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.92)',
    placeholder: isDark ? '#8d8d88' : '#9a9a94',
    selection: isDark ? '#ffffff' : '#111111',
    action: isDark ? '#ffffff' : '#0b0b0b',
    actionText: isDark ? '#111111' : '#ffffff',
    userBubble: isDark ? '#eeeeea' : '#161616',
    userText: isDark ? '#111111' : '#ffffff',
    error: '#d93d3d',
  };
}

function createStyles(isDark: boolean, bottomInset: number) {
  const colors = createColors(isDark);
  const shadowColor = isDark ? '#000000' : '#6f6f68';

  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
      overflow: 'hidden',
    },
    keyboard: {
      flex: 1,
    },
    loading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    connectPage: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: Math.max(bottomInset, 16) + 8,
    },
    connectContent: {
      gap: 10,
      paddingBottom: 34,
    },
    connectTitle: {
      color: colors.text,
      fontFamily: 'OcclusionGrotesqueYear3',
      fontSize: 68,
      lineHeight: 72,
      letterSpacing: 0,
    },
    connectCopy: {
      color: colors.secondaryText,
      fontSize: 17,
      lineHeight: 24,
      maxWidth: 340,
    },
    connectForm: {
      gap: 14,
    },
    field: {
      gap: 8,
    },
    label: {
      color: colors.secondaryText,
      fontSize: 13,
      fontWeight: '600',
    },
    input: {
      minHeight: 50,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.input,
      color: colors.text,
      paddingHorizontal: 14,
      fontSize: 16,
    },
    codeInput: {
      fontVariant: ['tabular-nums'],
      letterSpacing: 0,
    },
    error: {
      color: colors.error,
      fontSize: 14,
      lineHeight: 20,
    },
    connectActions: {
      gap: 10,
      marginTop: 4,
    },
    connectButton: {
      height: 54,
      borderRadius: 27,
      backgroundColor: colors.action,
      alignItems: 'center',
      justifyContent: 'center',
    },
    connectButtonText: {
      color: colors.actionText,
      fontSize: 16,
      fontWeight: '700',
    },
    pressed: {
      opacity: 0.62,
    },
    sidebarStage: {
      flex: 1,
      backgroundColor: isDark ? '#050505' : '#f4f2ee',
      overflow: 'hidden',
    },
    mainPanel: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.background,
      borderColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)',
      overflow: 'hidden',
      shadowColor: '#000000',
      shadowRadius: 36,
      shadowOffset: { width: -14, height: 0 },
      elevation: 18,
    },
    chatSafeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    chatShell: {
      flex: 1,
      backgroundColor: colors.background,
    },
    sidebarButton: {
      position: 'absolute',
      top: 8,
      left: 18,
      zIndex: 3,
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(33,33,33,0.74)' : 'rgba(255,255,255,0.74)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor,
      shadowOpacity: 0.14,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
    },
    sidebarGlyph: {
      width: 22,
      gap: 7,
    },
    sidebarGlyphLine: {
      width: 22,
      height: 2.5,
      borderRadius: 2,
      backgroundColor: colors.text,
    },
    sidebarGlyphLineShort: {
      width: 15,
    },
    sidebarUnderlay: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      paddingTop: 64,
      paddingHorizontal: 24,
      paddingBottom: Math.max(bottomInset, 18) + 18,
      backgroundColor: isDark ? '#050505' : '#f4f2ee',
    },
    sidebarPanel: {
      flex: 1,
      justifyContent: 'space-between',
    },
    sidebarTop: {
      gap: 8,
    },
    sidebarTitle: {
      color: colors.text,
      fontSize: 34,
      lineHeight: 40,
      fontWeight: '700',
      letterSpacing: 0,
    },
    sidebarMeta: {
      color: colors.subtleText,
      fontSize: 14,
      lineHeight: 20,
    },
    sidebarFooter: {
      gap: 12,
    },
    sidebarLogout: {
      height: 50,
      borderRadius: 25,
      paddingHorizontal: 18,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'flex-start',
      backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
    },
    sidebarLogoutText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    sidebarCloseCatcher: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 8,
      backgroundColor: 'transparent',
    },
    messages: {
      flex: 1,
    },
    messagesContent: {
      paddingTop: 84,
      paddingHorizontal: 20,
      paddingBottom: 118 + Math.max(bottomInset, 10),
      gap: 24,
    },
    messageRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      maxWidth: 560,
      width: '100%',
      alignSelf: 'center',
    },
    userMessageRow: {
      justifyContent: 'flex-end',
    },
    message: {
      flexShrink: 1,
      maxWidth: '86%',
      paddingVertical: 2,
    },
    userMessage: {
      maxWidth: '78%',
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 11,
      backgroundColor: colors.userBubble,
    },
    activityLine: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      maxWidth: '94%',
      paddingVertical: 2,
      marginBottom: 7,
    },
    activityLinePressed: {
      opacity: 0.58,
    },
    activityLineTextWrap: {
      flexShrink: 1,
    },
    activityLineTitle: {
      color: colors.subtleText,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '500',
    },
    messageText: {
      color: colors.text,
      fontSize: 17,
      lineHeight: 25,
    },
    assistantResponseText: {
      marginTop: 2,
    },
    userMessageText: {
      color: colors.userText,
      fontSize: 16,
      lineHeight: 22,
    },
    chatError: {
      position: 'absolute',
      left: 24,
      right: 24,
      bottom: 94 + Math.max(bottomInset, 10),
      color: colors.error,
      textAlign: 'center',
      fontSize: 13,
      zIndex: 2,
    },
    modalRoot: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    modalBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: isDark ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.03)',
    },
    sheet: {
      maxHeight: '74%',
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingTop: 10,
      paddingHorizontal: 22,
      paddingBottom: Math.max(bottomInset, 16) + 18,
      backgroundColor: isDark ? '#171717' : '#fbfbfa',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor,
      shadowOpacity: 0.18,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: -8 },
    },
    sheetHandle: {
      width: 42,
      height: 5,
      borderRadius: 3,
      alignSelf: 'center',
      backgroundColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.14)',
      marginBottom: 18,
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 18,
      marginBottom: 18,
    },
    sheetTitle: {
      color: colors.text,
      fontSize: 21,
      lineHeight: 26,
      fontWeight: '700',
    },
    sheetSubtitle: {
      color: colors.secondaryText,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 2,
    },
    sheetClose: {
      minWidth: 64,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    },
    sheetCloseText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
    sheetSteps: {
      gap: 16,
      paddingBottom: 8,
    },
    sheetStep: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    sheetStepQuiet: {
      opacity: 0.46,
    },
    sheetStepDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      marginTop: 7,
      backgroundColor: colors.secondaryText,
      opacity: 0.72,
    },
    sheetStepDotRunning: {
      opacity: 1,
      backgroundColor: '#147ef5',
    },
    sheetStepDotError: {
      opacity: 1,
      backgroundColor: colors.error,
    },
    sheetStepText: {
      flex: 1,
      gap: 3,
    },
    sheetStepLabel: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 21,
      fontWeight: '600',
    },
    sheetStepDetail: {
      color: colors.secondaryText,
      fontSize: 13,
      lineHeight: 18,
    },
    composerWrap: {
      position: 'absolute',
      left: 16,
      right: 16,
      bottom: Math.max(bottomInset, 12),
      zIndex: 4,
      borderRadius: 31,
      shadowColor,
      shadowOpacity: 0.18,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 16 },
    },
    composer: {
      minHeight: 62,
      borderRadius: 31,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingLeft: 20,
      paddingRight: 8,
      paddingVertical: 8,
      backgroundColor: isDark ? '#202020' : '#ffffff',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)',
    },
    composerFocused: {
      borderColor: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.16)',
    },
    commandInput: {
      flex: 1,
      height: 44,
      color: colors.text,
      paddingHorizontal: 0,
      paddingTop: 0,
      paddingBottom: 0,
      fontSize: 17,
      lineHeight: 20,
    },
    sendButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.action,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendIcon: {
      color: colors.actionText,
      width: 44,
      height: 44,
      fontSize: 30,
      fontWeight: '800',
      lineHeight: 41,
      textAlign: 'center',
    },
    busyText: {
      color: colors.actionText,
      fontSize: 15,
      fontWeight: '900',
      letterSpacing: 0,
    },
  });
}
