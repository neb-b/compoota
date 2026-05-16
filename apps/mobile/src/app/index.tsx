import AsyncStorage from '@react-native-async-storage/async-storage';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import React, { PropsWithChildren, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
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
  role: 'user' | 'assistant' | 'system';
  text: string;
  activity?: ActivityStep[];
  isStreaming?: boolean;
};

type StreamReader = {
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
};

type StreamingResponse = Response & {
  body?: {
    getReader?: () => StreamReader;
  } | null;
};

const STORAGE_KEY = 'compoota.connection.v1';
const PREFERENCES_KEY = 'compoota.connection-preferences.v1';
const MESSAGE_HISTORY_KEY_PREFIX = 'compoota.messages.v1.';

const CONNECT_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  text: 'Connect to your Compoota house-server, then send a command.',
};

const READY_MESSAGE: Message = {
  id: 'ready',
  role: 'assistant',
  text: 'Compoota is awake. What should we try?',
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
    detail: 'Compoota is nudging the house brain.',
    status: 'running',
  },
];

function normalizeServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  const url = new URL(trimmed);

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

function activitySummary(activity: ActivityStep[]): string {
  if (activity.some((step) => step.status === 'error')) {
    return 'Compoota hit a snag';
  }

  const running = [...activity].reverse().find((step) => step.status === 'running');
  if (running) {
    return running.label;
  }

  const latest = activity[activity.length - 1];
  return latest?.label ?? `${activity.length} step${activity.length === 1 ? '' : 's'} completed`;
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
      (message.role === 'user' || message.role === 'assistant' || message.role === 'system'),
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

function GlassSurface({
  children,
  style,
  tintColor,
  isDark,
}: PropsWithChildren<{
  style?: object;
  tintColor: string;
  isDark: boolean;
}>) {
  const canUseGlass = Platform.OS === 'ios' && isGlassEffectAPIAvailable();

  if (canUseGlass) {
    return (
      <GlassView
        colorScheme={isDark ? 'dark' : 'light'}
        glassEffectStyle="regular"
        isInteractive={false}
        style={style}
        tintColor={tintColor}>
        {children}
      </GlassView>
    );
  }

  return <View style={style}>{children}</View>;
}

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const isDark = colorScheme === 'dark';
  const styles = useMemo(() => createStyles(isDark, insets.bottom), [isDark, insets.bottom]);
  const colors = useMemo(() => createColors(isDark), [isDark]);
  const scrollRef = useRef<ScrollView>(null);

  const [connection, setConnection] = useState<Connection | null>(null);
  const [serverUrl, setServerUrl] = useState('http://192.168.1.50:8787');
  const [pairingCode, setPairingCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [command, setCommand] = useState('');
  const [messages, setMessages] = useState<Message[]>([CONNECT_MESSAGE]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checkingServer, setCheckingServer] = useState(false);
  const [expandedActivity, setExpandedActivity] = useState<Record<string, boolean>>({});

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
            setMessages(storedMessages ?? [READY_MESSAGE]);
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
        Platform.select({ ios: 'iPhone', android: 'Android', default: 'Compoota device' });

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
      setMessages([{ ...READY_MESSAGE, id: messageId() }]);
    } catch (err) {
      const message =
        err instanceof TypeError
          ? 'Server unreachable. Check the URL, Wi-Fi, and LAN connection.'
          : err instanceof Error && err.name === 'AbortError'
            ? 'Server did not respond. Check that the phone and Pi are on the same LAN.'
            : err instanceof Error
              ? err.message
              : 'Pairing failed.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function testServer() {
    setError('');
    setCheckingServer(true);

    try {
      const normalizedUrl = normalizeServerUrl(serverUrl);
      const response = await fetchWithTimeout(`${normalizedUrl}/health`, { method: 'GET' }, 6000);

      if (!response.ok) {
        throw new Error(`Server health check failed with status ${response.status}.`);
      }

      setServerUrl(normalizedUrl);
      setError('Server is reachable. Use a fresh pairing code to connect.');
    } catch (err) {
      const message =
        err instanceof TypeError
          ? 'Server unreachable from this device. Check Expo Go Local Network permission and Wi-Fi.'
          : err instanceof Error && err.name === 'AbortError'
            ? 'Server did not respond from this device. Check Expo Go Local Network permission.'
            : err instanceof Error
              ? err.message
              : 'Server check failed.';
      setError(message);
    } finally {
      setCheckingServer(false);
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
    setExpandedActivity((current) => ({ ...current, [assistantId]: false }));
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
      const response = await fetchWithTimeout(
        `${connection.serverUrl}/command/stream`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${connection.deviceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text }),
        },
        180000,
      );

      if (response.status === 401) {
        throw new Error('This device is unauthorized or revoked. Reset and pair again.');
      }

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const reader = (response as StreamingResponse).body?.getReader?.();
      if (!reader) {
        throw new Error('This device cannot read the progress stream yet.');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\n\n/);
        buffer = blocks.pop() ?? '';

        for (const block of blocks) {
          const parsed = parseSseBlock(block);
          if (!parsed) {
            continue;
          }

          if (parsed.event === 'activity') {
            const step = parsed.data as ActivityStep;
            updateAssistant((message) => ({
              ...message,
              activity: mergeActivity(message.activity, step),
            }));
          } else if (parsed.event === 'reply') {
            const data = parsed.data as { reply?: string; activity?: ActivityStep[] };
            updateAssistant((message) => ({
              ...message,
              text: data.reply || '',
              activity: Array.isArray(data.activity) ? data.activity : message.activity,
              isStreaming: false,
            }));
          } else if (parsed.event === 'error') {
            throw new Error('Command failed.');
          }
        }
      }

      updateAssistant((message) => ({ ...message, isStreaming: false }));
    } catch (err) {
      const message =
        err instanceof TypeError
          ? 'Server unreachable. Check the URL and LAN connection.'
          : err instanceof Error && err.name === 'AbortError'
            ? 'Compoota is taking too long to respond. Try again in a moment.'
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
    setConnection(null);
    setCommand('');
    setError('');
    setMessages([CONNECT_MESSAGE]);
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
              <Text style={styles.brand}>Compoota</Text>
              <Text style={styles.connectTitle}>Connect your local companion</Text>
              <Text style={styles.connectCopy}>
                Pair this phone with the house-server on your LAN. The house brain stays private.
              </Text>
            </View>

            <GlassSurface isDark={isDark} style={styles.connectCard} tintColor={colors.glassTint}>
              <View style={styles.field}>
                <Text style={styles.label}>Server URL</Text>
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
                <Text style={styles.label}>Pairing code</Text>
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
                <Text style={styles.label}>Device name</Text>
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
                  disabled={busy || checkingServer}
                  onPress={connect}
                  style={({ pressed }) => [
                    styles.connectButton,
                    (pressed || busy) && styles.pressed,
                  ]}>
                  {busy ? (
                    <ActivityIndicator color={colors.actionText} />
                  ) : (
                    <Text style={styles.connectButtonText}>Connect</Text>
                  )}
                </Pressable>
                <Pressable
                  disabled={busy || checkingServer}
                  onPress={testServer}
                  style={({ pressed }) => [
                    styles.testButton,
                    (pressed || checkingServer) && styles.pressed,
                  ]}>
                  {checkingServer ? (
                    <ActivityIndicator color={colors.text} />
                  ) : (
                    <Text style={styles.testButtonText}>Test server</Text>
                  )}
                </Pressable>
              </View>
            </GlassSurface>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}>
        <View style={styles.chatShell}>
          <GlassSurface isDark={isDark} style={styles.chatHeader} tintColor={colors.glassTint}>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.chatTitle}>Compoota</Text>
              <Text numberOfLines={1} style={styles.chatSubtitle}>
                {connection.serverUrl}
              </Text>
            </View>
            <Pressable onPress={resetConnection} style={styles.resetButton}>
              <Text style={styles.resetButtonText}>Reset</Text>
            </Pressable>
          </GlassSurface>

          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.messagesContent}
            keyboardShouldPersistTaps="handled"
            style={styles.messages}>
            {messages.map((message) => (
              <View
                key={message.id}
                style={[
                  styles.messageRow,
                  message.role === 'user' && styles.userMessageRow,
                  message.role === 'system' && styles.systemMessageRow,
                ]}>
                {message.role === 'assistant' ? (
                  <Text style={styles.assistantMark}>C</Text>
                ) : null}
                <View
                  style={[
                    styles.message,
                    message.role === 'user' && styles.userMessage,
                    message.role === 'system' && styles.systemMessage,
                  ]}>
                  {message.text ? (
                    <Text
                      style={[
                        styles.messageText,
                        message.role === 'user' && styles.userMessageText,
                        message.role === 'system' && styles.systemMessageText,
                      ]}>
                      {message.text}
                    </Text>
                  ) : null}
                  {message.activity?.length ? (
                    <Pressable
                      onPress={() =>
                        setExpandedActivity((current) => ({
                          ...current,
                          [message.id]: !current[message.id],
                        }))
                      }
                      style={styles.activityCard}>
                      <View style={styles.activityHeader}>
                        <View style={styles.activityTitleWrap}>
                          {message.isStreaming ? (
                            <ActivityIndicator color={colors.secondaryText} size="small" />
                          ) : null}
                          <Text style={styles.activityTitle}>{activitySummary(message.activity)}</Text>
                        </View>
                        <Text style={styles.activityToggle}>{expandedActivity[message.id] ? 'Hide' : 'Show'}</Text>
                      </View>
                      {expandedActivity[message.id] ? (
                        <View style={styles.activityList}>
                          {message.activity.map((step, index) => (
                            <View
                              key={step.id}
                              style={[
                                styles.activityStep,
                                step.status === 'done' &&
                                  index < (message.activity?.length ?? 0) - 1 &&
                                  styles.activityStepFaded,
                              ]}>
                              <View
                                style={[
                                  styles.activityDot,
                                  step.status === 'error' && styles.activityDotError,
                                  step.status === 'running' && styles.activityDotRunning,
                                ]}
                              />
                              <View style={styles.activityTextWrap}>
                                <Text style={styles.activityStepLabel}>{step.label}</Text>
                                {step.detail ? (
                                  <Text style={styles.activityStepDetail}>{step.detail}</Text>
                                ) : null}
                              </View>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
          </ScrollView>

          {error ? <Text style={styles.chatError}>{error}</Text> : null}

          <View style={styles.composerWrap}>
            <GlassSurface isDark={isDark} style={styles.composer} tintColor={colors.glassTint}>
              <TextInput
                multiline
                onChangeText={setCommand}
                onSubmitEditing={Platform.OS === 'web' ? sendCommand : undefined}
                placeholder="Ask Compoota"
                placeholderTextColor={colors.placeholder}
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
            </GlassSurface>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createColors(isDark: boolean) {
  return {
    background: isDark ? '#111111' : '#f8f8f7',
    text: isDark ? '#f6f6f4' : '#171717',
    secondaryText: isDark ? '#a7a7a2' : '#686863',
    subtleText: isDark ? '#858580' : '#8f8f88',
    border: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(12,12,12,0.08)',
    elevated: isDark ? 'rgba(32,32,31,0.84)' : 'rgba(255,255,255,0.82)',
    glassTint: isDark ? 'rgba(38,38,36,0.64)' : 'rgba(255,255,255,0.72)',
    input: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.92)',
    placeholder: isDark ? '#8d8d88' : '#9a9a94',
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
      paddingHorizontal: 22,
      paddingTop: 24,
      paddingBottom: Math.max(bottomInset, 16) + 8,
    },
    connectContent: {
      flex: 1,
      justifyContent: 'center',
      gap: 10,
      paddingBottom: 16,
    },
    brand: {
      color: colors.subtleText,
      fontSize: 13,
      fontWeight: '800',
      letterSpacing: 0,
      textTransform: 'uppercase',
    },
    connectTitle: {
      color: colors.text,
      fontSize: 42,
      lineHeight: 46,
      fontWeight: '800',
      letterSpacing: 0,
      maxWidth: 360,
    },
    connectCopy: {
      color: colors.secondaryText,
      fontSize: 17,
      lineHeight: 24,
      maxWidth: 340,
    },
    connectCard: {
      gap: 14,
      borderRadius: 30,
      padding: 18,
      overflow: 'hidden',
      backgroundColor: colors.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor,
      shadowOpacity: 0.16,
      shadowRadius: 26,
      shadowOffset: { width: 0, height: 18 },
    },
    field: {
      gap: 8,
    },
    label: {
      color: colors.secondaryText,
      fontSize: 13,
      fontWeight: '700',
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
      fontWeight: '800',
    },
    testButton: {
      height: 50,
      borderRadius: 25,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    },
    testButtonText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    pressed: {
      opacity: 0.62,
    },
    chatShell: {
      flex: 1,
      backgroundColor: colors.background,
    },
    chatHeader: {
      position: 'absolute',
      top: 10,
      left: 18,
      right: 18,
      zIndex: 3,
      height: 58,
      borderRadius: 29,
      overflow: 'hidden',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      backgroundColor: colors.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor,
      shadowOpacity: 0.16,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 12 },
    },
    resetButton: {
      minWidth: 58,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    },
    resetButtonText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
    },
    headerTitleWrap: {
      alignItems: 'flex-start',
      flex: 1,
      paddingRight: 12,
    },
    chatTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '800',
      letterSpacing: 0,
    },
    chatSubtitle: {
      color: colors.secondaryText,
      fontSize: 11,
      maxWidth: 210,
      marginTop: 1,
    },
    messages: {
      flex: 1,
    },
    messagesContent: {
      paddingTop: 92,
      paddingHorizontal: 20,
      paddingBottom: 118 + Math.max(bottomInset, 10),
      gap: 20,
    },
    messageRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      maxWidth: 560,
      width: '100%',
      alignSelf: 'center',
    },
    userMessageRow: {
      justifyContent: 'flex-end',
    },
    systemMessageRow: {
      justifyContent: 'center',
    },
    assistantMark: {
      width: 28,
      height: 28,
      borderRadius: 14,
      overflow: 'hidden',
      textAlign: 'center',
      lineHeight: 28,
      color: colors.actionText,
      backgroundColor: colors.action,
      fontSize: 13,
      fontWeight: '800',
      marginTop: 2,
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
    systemMessage: {
      maxWidth: '92%',
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 9,
      backgroundColor: isDark ? 'rgba(217,61,61,0.14)' : 'rgba(217,61,61,0.08)',
    },
    thinkingBubble: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
    },
    thinkingText: {
      color: colors.secondaryText,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '600',
    },
    activityCard: {
      marginTop: 12,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    activityHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    activityTitleWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    activityTitle: {
      flex: 1,
      color: colors.secondaryText,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 18,
    },
    activityToggle: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '800',
    },
    activityList: {
      gap: 10,
      marginTop: 12,
    },
    activityStep: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    activityStepFaded: {
      opacity: 0.48,
    },
    activityDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginTop: 6,
      backgroundColor: isDark ? '#f6f6f4' : '#171717',
      opacity: 0.46,
    },
    activityDotRunning: {
      opacity: 1,
      backgroundColor: '#147ef5',
    },
    activityDotError: {
      opacity: 1,
      backgroundColor: colors.error,
    },
    activityTextWrap: {
      flex: 1,
      gap: 2,
    },
    activityStepLabel: {
      color: colors.text,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
    },
    activityStepDetail: {
      color: colors.secondaryText,
      fontSize: 12,
      lineHeight: 17,
    },
    pendingActivityPanel: {
      flexShrink: 1,
      gap: 8,
      maxWidth: '86%',
    },
    pendingActivityWrap: {
      gap: 7,
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderRadius: 18,
      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)',
    },
    pendingStep: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 9,
    },
    pendingStepText: {
      flex: 1,
      color: colors.secondaryText,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
    },
    messageText: {
      color: colors.text,
      fontSize: 17,
      lineHeight: 25,
    },
    userMessageText: {
      color: colors.userText,
      fontSize: 16,
      lineHeight: 22,
    },
    systemMessageText: {
      color: colors.error,
      fontSize: 14,
      textAlign: 'center',
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
    composerWrap: {
      position: 'absolute',
      left: 16,
      right: 16,
      bottom: Math.max(bottomInset, 12),
      zIndex: 4,
    },
    composer: {
      minHeight: 62,
      borderRadius: 31,
      overflow: 'hidden',
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 10,
      paddingLeft: 18,
      paddingRight: 8,
      paddingVertical: 8,
      backgroundColor: colors.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor,
      shadowOpacity: 0.18,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 16 },
    },
    commandInput: {
      flex: 1,
      minHeight: 46,
      maxHeight: 118,
      color: colors.text,
      paddingHorizontal: 0,
      paddingVertical: 12,
      fontSize: 18,
      lineHeight: 24,
    },
    sendButton: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: colors.action,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendIcon: {
      color: colors.actionText,
      fontSize: 26,
      fontWeight: '900',
      lineHeight: 28,
      marginTop: -2,
    },
    busyText: {
      color: colors.actionText,
      fontSize: 15,
      fontWeight: '900',
      letterSpacing: 0,
    },
  });
}
