import AsyncStorage from '@react-native-async-storage/async-storage';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import React, { PropsWithChildren, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  StyleProp,
  Text,
  TextInput,
  useColorScheme,
  View,
  ViewStyle,
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

function activitySummary(activity: ActivityStep[], includeRunning = true): string {
  if (activity.some((step) => step.status === 'error')) {
    return 'Compoota hit a snag';
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

  return activity.some((step) => step.status === 'error') ? 'Compoota hit a snag' : 'Worked just now';
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
    xhr.ontimeout = () => fail(new Error('Compoota is taking too long to respond. Try again in a moment.'));
    xhr.send(JSON.stringify({ text }));
  });
}

function GlassSurface({
  children,
  interactive = false,
  style,
  tintColor,
  isDark,
}: PropsWithChildren<{
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
  tintColor: string;
  isDark: boolean;
}>) {
  const canUseGlass = Platform.OS === 'ios' && isGlassEffectAPIAvailable();

  if (canUseGlass) {
    return (
      <GlassView
        colorScheme={isDark ? 'dark' : 'light'}
        glassEffectStyle="regular"
        isInteractive={interactive}
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
  const [selectedActivityMessageId, setSelectedActivityMessageId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);

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
  const sidebarPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (event, gesture) =>
          !sidebarOpen &&
          event.nativeEvent.pageX < 28 &&
          gesture.dx > 12 &&
          Math.abs(gesture.dy) < 36,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx > 44) {
            setSidebarOpen(true);
          }
        },
      }),
    [sidebarOpen],
  );

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
    setSidebarOpen(false);
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
        <View style={styles.chatShell} {...sidebarPanResponder.panHandlers}>
          <Pressable
            accessibilityLabel="Open sidebar"
            onPress={() => setSidebarOpen(true)}
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
                  {message.role === 'assistant' && message.activity?.length ? (
                    <Pressable
                      onPress={() => setSelectedActivityMessageId(message.id)}
                      style={({ pressed }) => [styles.activityLine, pressed && styles.activityLinePressed]}>
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
                        message.role === 'system' && styles.systemMessageText,
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
            <GlassSurface
              interactive
              isDark={isDark}
              style={[styles.composer, composerFocused && styles.composerFocused]}
              tintColor={colors.glassTint}>
              <TextInput
                multiline
                onBlur={() => setComposerFocused(false)}
                onChangeText={setCommand}
                onFocus={() => setComposerFocused(true)}
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
      <Modal
        animationType="fade"
        onRequestClose={() => setSidebarOpen(false)}
        transparent
        visible={sidebarOpen}>
        <View style={styles.sidebarModalRoot}>
          <Pressable style={styles.sidebarScrim} onPress={() => setSidebarOpen(false)} />
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
        </View>
      </Modal>
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
                <Text style={styles.sheetTitle}>Compoota’s work</Text>
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
      fontWeight: '700',
      letterSpacing: 0,
      textTransform: 'uppercase',
    },
    connectTitle: {
      color: colors.text,
      fontSize: 42,
      lineHeight: 46,
      fontWeight: '700',
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
      fontWeight: '600',
    },
    pressed: {
      opacity: 0.62,
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
    sidebarModalRoot: {
      flex: 1,
      flexDirection: 'row',
    },
    sidebarScrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: isDark ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0.04)',
    },
    sidebarPanel: {
      width: '82%',
      maxWidth: 360,
      height: '100%',
      paddingTop: 64,
      paddingHorizontal: 24,
      paddingBottom: Math.max(bottomInset, 18) + 18,
      justifyContent: 'space-between',
      backgroundColor: isDark ? '#050505' : '#fbfbfa',
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
      shadowColor: '#000000',
      shadowOpacity: 0.24,
      shadowRadius: 28,
      shadowOffset: { width: 12, height: 0 },
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
      fontWeight: '700',
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
    composerFocused: {
      borderColor: isDark ? 'rgba(255,255,255,0.28)' : 'rgba(20,20,20,0.18)',
      shadowOpacity: 0.24,
      shadowRadius: 32,
      transform: [{ scale: 1.006 }],
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
