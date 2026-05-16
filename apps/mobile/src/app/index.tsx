import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

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

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const styles = useMemo(() => createStyles(isDark), [isDark]);
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
      const cleanedName = deviceName.trim() || Platform.select({ ios: 'iPhone', android: 'Android', default: 'Compoota device' });

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
      const message = err instanceof TypeError ? 'Server unreachable. Check the URL and LAN connection.' : err instanceof Error ? err.message : 'Pairing failed.';
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
      setMessages((current) => [...current, { id: messageId(), role: 'assistant', text: data.reply }]);
    } catch (err) {
      const message = err instanceof TypeError ? 'Server unreachable. Check the URL and LAN connection.' : err instanceof Error ? err.message : 'Command failed.';
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
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (!connection) {
    return (
      <SafeAreaView style={styles.screen}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
          <View style={styles.connectWrap}>
            <View style={styles.connectHeader}>
              <Text style={styles.kicker}>Compoota</Text>
              <Text style={styles.title}>Connect to Hermes House</Text>
              <Text style={styles.subtitle}>Pair this device with your local house server.</Text>
            </View>

            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={styles.label}>Server URL</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  onChangeText={setServerUrl}
                  placeholder="http://192.168.1.50:8787"
                  placeholderTextColor={isDark ? '#7d8596' : '#8a92a3'}
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
                  placeholderTextColor={isDark ? '#7d8596' : '#8a92a3'}
                  style={styles.input}
                  value={pairingCode}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Device name</Text>
                <TextInput
                  onChangeText={setDeviceName}
                  placeholder="Sean iPhone"
                  placeholderTextColor={isDark ? '#7d8596' : '#8a92a3'}
                  style={styles.input}
                  value={deviceName}
                />
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Pressable disabled={busy} onPress={connect} style={({ pressed }) => [styles.primaryButton, (pressed || busy) && styles.pressed]}>
                {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Connect</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <View style={styles.chatHeader}>
          <View>
            <Text style={styles.kicker}>Hermes House</Text>
            <Text style={styles.serverText}>{connection.serverUrl}</Text>
          </View>
          <Pressable onPress={resetConnection} style={({ pressed }) => [styles.resetButton, pressed && styles.pressed]}>
            <Text style={styles.resetButtonText}>Reset</Text>
          </Pressable>
        </View>

        <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messagesContent}>
          {messages.map((message) => (
            <View
              key={message.id}
              style={[
                styles.bubble,
                message.role === 'user' && styles.userBubble,
                message.role === 'system' && styles.systemBubble,
              ]}>
              <Text
                style={[
                  styles.bubbleText,
                  message.role === 'user' && styles.userBubbleText,
                  message.role === 'system' && styles.systemBubbleText,
                ]}>
                {message.text}
              </Text>
            </View>
          ))}
        </ScrollView>

        {error ? <Text style={styles.chatError}>{error}</Text> : null}

        <View style={styles.composer}>
          <TextInput
            multiline
            onChangeText={setCommand}
            onSubmitEditing={Platform.OS === 'web' ? sendCommand : undefined}
            placeholder="Message Hermes"
            placeholderTextColor={isDark ? '#7d8596' : '#8a92a3'}
            style={styles.commandInput}
            value={command}
          />
          <Pressable disabled={busy} onPress={sendCommand} style={({ pressed }) => [styles.sendButton, (pressed || busy) && styles.pressed]}>
            <Text style={styles.sendButtonText}>{busy ? '...' : 'Send'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(isDark: boolean) {
  const colors = {
    background: isDark ? '#101114' : '#f7f7f8',
    panel: isDark ? '#191b20' : '#ffffff',
    border: isDark ? '#2b3038' : '#dfe3ea',
    text: isDark ? '#f4f6fb' : '#16181d',
    muted: isDark ? '#a6adba' : '#657083',
    input: isDark ? '#111318' : '#ffffff',
    assistant: isDark ? '#20242b' : '#ffffff',
    user: '#2563eb',
    error: '#dc2626',
  };

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
    connectWrap: {
      flex: 1,
      justifyContent: 'center',
      padding: 22,
      gap: 28,
      width: '100%',
      maxWidth: 560,
      alignSelf: 'center',
    },
    connectHeader: {
      gap: 8,
    },
    kicker: {
      color: colors.muted,
      fontSize: 13,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0,
    },
    title: {
      color: colors.text,
      fontSize: 34,
      fontWeight: '800',
      letterSpacing: 0,
    },
    subtitle: {
      color: colors.muted,
      fontSize: 16,
      lineHeight: 23,
    },
    form: {
      gap: 16,
    },
    field: {
      gap: 8,
    },
    label: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
    input: {
      minHeight: 52,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.input,
      color: colors.text,
      paddingHorizontal: 14,
      fontSize: 16,
    },
    error: {
      color: colors.error,
      fontSize: 14,
      lineHeight: 20,
    },
    primaryButton: {
      height: 52,
      borderRadius: 8,
      backgroundColor: colors.user,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
    },
    primaryButtonText: {
      color: '#ffffff',
      fontSize: 16,
      fontWeight: '800',
    },
    pressed: {
      opacity: 0.72,
    },
    chatHeader: {
      minHeight: 68,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.panel,
      paddingHorizontal: 16,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    serverText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
      marginTop: 2,
    },
    resetButton: {
      minHeight: 36,
      paddingHorizontal: 13,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    resetButtonText: {
      color: colors.text,
      fontWeight: '700',
    },
    messages: {
      flex: 1,
    },
    messagesContent: {
      padding: 16,
      gap: 12,
    },
    bubble: {
      maxWidth: '86%',
      alignSelf: 'flex-start',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.assistant,
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    userBubble: {
      alignSelf: 'flex-end',
      backgroundColor: colors.user,
      borderColor: colors.user,
    },
    systemBubble: {
      alignSelf: 'center',
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      maxWidth: '96%',
    },
    bubbleText: {
      color: colors.text,
      fontSize: 16,
      lineHeight: 22,
    },
    userBubbleText: {
      color: '#ffffff',
    },
    systemBubbleText: {
      color: colors.error,
      fontSize: 14,
      textAlign: 'center',
    },
    chatError: {
      color: colors.error,
      paddingHorizontal: 16,
      paddingBottom: 6,
      fontSize: 14,
    },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 10,
      padding: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.panel,
    },
    commandInput: {
      flex: 1,
      minHeight: 46,
      maxHeight: 120,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.input,
      color: colors.text,
      paddingHorizontal: 14,
      paddingVertical: 11,
      fontSize: 16,
    },
    sendButton: {
      height: 46,
      minWidth: 68,
      borderRadius: 8,
      backgroundColor: colors.user,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 14,
    },
    sendButtonText: {
      color: '#ffffff',
      fontWeight: '800',
      fontSize: 15,
    },
  });
}
