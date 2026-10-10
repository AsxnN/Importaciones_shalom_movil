import * as Haptics from 'expo-haptics';

let hapticEnabled = true;

export function setHapticsActive(enabled: boolean) {
  hapticEnabled = enabled;
}

export async function hapticSuccess(): Promise<void> {
  if (!hapticEnabled) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Silencio en plataformas no compatibles
  }
}

export async function hapticWarning(): Promise<void> {
  if (!hapticEnabled) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch {
    // Silencio en plataformas no compatibles
  }
}

export async function hapticError(): Promise<void> {
  if (!hapticEnabled) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {
    // Silencio en plataformas no compatibles
  }
}

export async function hapticImpact(style = Haptics.ImpactFeedbackStyle.Medium): Promise<void> {
  if (!hapticEnabled) return;
  try {
    await Haptics.impactAsync(style);
  } catch {
    // Silencio en plataformas no compatibles
  }
}
