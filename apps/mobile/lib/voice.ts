import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

let currentRecording: Audio.Recording | null = null;
let currentSound: Audio.Sound | null = null;

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 128000,
  },
  ios: {
    extension: '.m4a',
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 128000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 128000,
  },
};

export async function requestMicrophonePermission(): Promise<boolean> {
  const { status } = await Audio.requestPermissionsAsync();
  return status === 'granted';
}

export async function startRecording(): Promise<boolean> {
  try {
    if (currentRecording) {
      await stopRecording();
    }

    const hasPermission = await requestMicrophonePermission();
    if (!hasPermission) {
      console.warn('[Voice] Microphone permission denied');
      return false;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
    currentRecording = recording;

    console.log('[Voice] Recording started');
    return true;
  } catch (err) {
    console.error('[Voice] Failed to start recording:', err);
    return false;
  }
}

export async function stopRecording(): Promise<string | null> {
  try {
    if (!currentRecording) {
      console.warn('[Voice] No active recording');
      return null;
    }

    await currentRecording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
    });

    const uri = currentRecording.getURI();
    currentRecording = null;

    console.log('[Voice] Recording stopped, URI:', uri);
    return uri;
  } catch (err) {
    console.error('[Voice] Failed to stop recording:', err);
    currentRecording = null;
    return null;
  }
}

export function isRecording(): boolean {
  return currentRecording !== null;
}

export async function getRecordingStatus(): Promise<Audio.RecordingStatus | null> {
  if (!currentRecording) return null;
  try {
    return await currentRecording.getStatusAsync();
  } catch {
    return null;
  }
}

export async function readAudioFileAsBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

export async function playAudioResponse(base64Data: string, extension = 'mp3'): Promise<void> {
  const cacheDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!cacheDir) {
    throw new Error('No writable cache directory available for audio playback');
  }

  const fileUri = `${cacheDir}karna-voice-response-${Date.now()}.${extension}`;

  if (currentSound) {
    try {
      await currentSound.unloadAsync();
    } catch {
      // ignore stale sound cleanup failures
    }
    currentSound = null;
  }

  await FileSystem.writeAsStringAsync(fileUri, base64Data, {
    encoding: FileSystem.EncodingType.Base64,
  });

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
  });

  const { sound } = await Audio.Sound.createAsync(
    { uri: fileUri },
    { shouldPlay: true },
  );

  currentSound = sound;
  sound.setOnPlaybackStatusUpdate((status) => {
    if (!status.isLoaded || !status.didJustFinish) return;

    sound.unloadAsync().catch(() => {});
    if (currentSound === sound) {
      currentSound = null;
    }
  });
}
