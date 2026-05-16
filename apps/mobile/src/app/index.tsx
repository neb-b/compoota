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

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
};

const STORAGE_KEY = 'compoota.connection.v1';

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
        isInteractive
        style={style}
        tintColor={tintColor}>
        {children}
      </GlassView>
    );
  }

  return <View style={style}>{children}</View>;
}

function MenuGlyph({ color }: { color: string }) {
  return (
    <View style={glyphStyles.menuGlyph}>
      <View style={[glyphStyles.menuBar, { backgroundColor: color }]} />
      <View style={[glyphStyles.menuBar, { backgroundColor: color }]} />
    </View>
  );
}

function WaveGlyph({ color }: { color: string }) {
  return (
    <View style={glyphStyles.waveGlyph}>
      {[12, 20, 28, 18, 24].map((height, index) => (
        <View key={index} style={[glyphStyles.waveBar, { height, backgroundColor: color }]} />
      ))}
    </View>
  );
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
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Connect to your Hermes house server, then send a command.',
    },
  ]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function loadConnection() {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Connection;
          if (parsed.serverUrl && parsed.deviceId && parsed.deviceToken) {
            setConnection(parsed);
            setServerUrl(parsed.serverUrl);
            setMessages([
              {
                id: 'ready',
                role: 'assistant',
                text: 'Connected. What should Hermes help with?',
              },
            ]);
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

      const response = await fetch(`${normalizedUrl}/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode: cleanedCode,
          deviceName: cleanedName,
        }),
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const data = (await response.json()) as { deviceId: string; deviceToken: string };
      const nextConnection = {
        serverUrl: normalizedUrl,
        deviceId: data.deviceId,
        deviceToken: data.deviceToken,
      };

      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextConnection));
      setConnection(nextConnection);
      setPairingCode('');
      setDeviceName(cleanedName);
      setMessages([
        {
          id: messageId(),
          role: 'assistant',
          text: 'Connected. What should Hermes help with?',
        },
      ]);
    } catch (err) {
      const message =
        err instanceof TypeError
          ? 'Server unreachable. Check the URL and LAN connection.'
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
    setMessages((current) => [...current, { id: messageId(), role: 'user', text }]);

    try {
      const response = await fetch(`${connection.serverUrl}/command`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${connection.deviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (response.status === 401) {
        throw new Error('This device is unauthorized or revoked. Reset and pair again.');
      }

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const data = (await response.json()) as { reply: string };
      setMessages((current) => [
        ...current,
        { id: messageId(), role: 'assistant', text: data.reply },
      ]);
    } catch (err) {
      const message =
        err instanceof TypeError
          ? 'Server unreachable. Check the URL and LAN connection.'
          : err instanceof Error
            ? err.message
            : 'Command failed.';
      setError(message);
      setMessages((current) => [...current, { id: messageId(), role: 'system', text: message }]);
    } finally {
      setBusy(false);
    }
  }

  async function resetConnection() {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setConnection(null);
    setCommand('');
    setError('');
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        text: 'Connect to your Hermes house server, then send a command.',
      },
    ]);
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
            <View style={styles.connectTopBar}>
              <Pressable style={styles.iconButton}>
                <Text style={styles.iconText}>+</Text>
              </Pressable>
              <GlassSurface isDark={isDark} style={styles.statusPill} tintColor={colors.glassTint}>
                <Text style={styles.statusText}>Pairing</Text>
              </GlassSurface>
              <Pressable style={styles.iconButton}>
                <Text style={styles.iconText}>...</Text>
              </Pressable>
            </View>

            <View style={styles.connectContent}>
              <Text style={styles.brand}>Hermes House</Text>
              <Text style={styles.connectTitle}>Connect your local companion</Text>
              <Text style={styles.connectCopy}>
                Pair this phone with the house-server on your LAN. Hermes stays private.
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
                  <Text style={styles.connectButtonText}>Connect</Text>
                )}
              </Pressable>
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
            <Pressable style={styles.headerIcon}>
              <MenuGlyph color={colors.text} />
            </Pressable>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.chatTitle}>Hermes</Text>
              <Text numberOfLines={1} style={styles.chatSubtitle}>
                {connection.serverUrl}
              </Text>
            </View>
            <Pressable onPress={resetConnection} style={styles.headerIcon}>
              <Text style={styles.composeIcon}>...</Text>
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
                  <Text style={styles.assistantMark}>H</Text>
                ) : null}
                <View
                  style={[
                    styles.message,
                    message.role === 'user' && styles.userMessage,
                    message.role === 'system' && styles.systemMessage,
                  ]}>
                  <Text
                    style={[
                      styles.messageText,
                      message.role === 'user' && styles.userMessageText,
                      message.role === 'system' && styles.systemMessageText,
                    ]}>
                    {message.text}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>

          {error ? <Text style={styles.chatError}>{error}</Text> : null}

          <View style={styles.composerWrap}>
            <GlassSurface isDark={isDark} style={styles.composer} tintColor={colors.glassTint}>
              <Pressable style={styles.addButton}>
                <Text style={styles.addIcon}>+</Text>
              </Pressable>
              <TextInput
                multiline
                onChangeText={setCommand}
                onSubmitEditing={Platform.OS === 'web' ? sendCommand : undefined}
                placeholder="Ask Hermes"
                placeholderTextColor={colors.placeholder}
                style={styles.commandInput}
                value={command}
              />
            <Pressable
                disabled={busy}
                onPress={sendCommand}
                style={({ pressed }) => [
                  styles.voiceButton,
                  (pressed || busy) && styles.pressed,
                ]}>
                {busy ? (
                  <Text style={styles.busyText}>...</Text>
                ) : (
                  <WaveGlyph color={colors.actionText} />
                )}
              </Pressable>
            </GlassSurface>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const glyphStyles = StyleSheet.create({
  menuGlyph: {
    width: 22,
    gap: 6,
  },
  menuBar: {
    height: 3,
    borderRadius: 2,
    width: 22,
  },
  waveGlyph: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  waveBar: {
    width: 4,
    borderRadius: 2,
  },
});

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
      paddingTop: 12,
      paddingBottom: Math.max(bottomInset, 16) + 8,
    },
    connectTopBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 56,
    },
    iconButton: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor,
      shadowOpacity: 0.12,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
    },
    iconText: {
      color: colors.text,
      fontSize: 26,
      fontWeight: '600',
      lineHeight: 28,
    },
    statusPill: {
      height: 52,
      minWidth: 132,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: colors.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor,
      shadowOpacity: 0.14,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
    },
    statusText: {
      color: '#147ef5',
      fontSize: 20,
      fontWeight: '700',
      letterSpacing: 0,
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
    connectButton: {
      height: 54,
      borderRadius: 27,
      backgroundColor: colors.action,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
    },
    connectButtonText: {
      color: colors.actionText,
      fontSize: 16,
      fontWeight: '800',
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
      paddingHorizontal: 8,
      backgroundColor: colors.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor,
      shadowOpacity: 0.16,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 12 },
    },
    headerIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    composeIcon: {
      color: colors.text,
      fontSize: 24,
      lineHeight: 24,
      fontWeight: '800',
      marginTop: -8,
    },
    headerTitleWrap: {
      alignItems: 'center',
      flex: 1,
      paddingHorizontal: 8,
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
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor: colors.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor,
      shadowOpacity: 0.18,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 16 },
    },
    addButton: {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addIcon: {
      color: colors.text,
      fontSize: 38,
      fontWeight: '300',
      lineHeight: 40,
      marginTop: -3,
    },
    commandInput: {
      flex: 1,
      minHeight: 46,
      maxHeight: 118,
      color: colors.text,
      paddingHorizontal: 2,
      paddingVertical: 12,
      fontSize: 20,
      lineHeight: 24,
    },
    voiceButton: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: colors.action,
      alignItems: 'center',
      justifyContent: 'center',
    },
    busyText: {
      color: colors.actionText,
      fontSize: 15,
      fontWeight: '900',
      letterSpacing: 0,
    },
  });
}
