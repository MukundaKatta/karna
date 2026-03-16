import {
  useMultiFileAuthState,
  type AuthenticationState,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import pino from "pino";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuthState {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

// ─── Auth Directory ─────────────────────────────────────────────────────────

const DEFAULT_AUTH_DIR = join(homedir(), ".karna", "whatsapp-auth");

/**
 * Initialize or restore WhatsApp authentication state.
 * Uses Baileys multi-file auth state persisted to ~/.karna/whatsapp-auth/
 */
export async function initAuthState(
  authDir: string = DEFAULT_AUTH_DIR,
): Promise<AuthState> {
  await mkdir(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  return { state, saveCreds };
}

// ─── QR Code Display ────────────────────────────────────────────────────────

/**
 * Print a QR code to the console for WhatsApp Web pairing.
 * Uses a simple block-character renderer for terminal display.
 */
export function displayQRCode(qr: string): void {
  console.log("\n");
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   Scan this QR code with WhatsApp        ║");
  console.log("║   Open WhatsApp > Linked Devices > Link   ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("\n");

  // Render QR using Unicode block characters
  // Each QR module is represented by a block or space
  const size = Math.sqrt(qr.length);

  if (Number.isInteger(size)) {
    for (let y = 0; y < size; y += 2) {
      let line = "  ";
      for (let x = 0; x < size; x++) {
        const top = qr[y * size + x] === "1";
        const bottom = y + 1 < size ? qr[(y + 1) * size + x] === "1" : false;

        if (top && bottom) {
          line += "\u2588"; // Full block
        } else if (top) {
          line += "\u2580"; // Upper half block
        } else if (bottom) {
          line += "\u2584"; // Lower half block
        } else {
          line += " ";
        }
      }
      console.log(line);
    }
  } else {
    // Fallback: just print the raw QR string for external rendering
    console.log(qr);
  }

  console.log("\n");
}

/**
 * Get the auth directory path.
 */
export function getAuthDir(): string {
  return DEFAULT_AUTH_DIR;
}
