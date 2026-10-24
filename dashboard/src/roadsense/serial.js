import { CONFIG, state } from "./state.js";
import { parseDeviceLine } from "./protocol.js";

export function serialSupported() {
  return "serial" in navigator;
}

export async function connectSerial(onMessage, onDisconnect) {
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: CONFIG.baudRate });
  state.port = port;

  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable).catch(() => {});
  const reader = decoder.readable.getReader();
  state.reader = reader;
  let buffer = "";

  void (async () => {
    try {
      while (state.reader === reader) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        lines.filter(Boolean).forEach((line) => onMessage(parseDeviceLine(line)));
      }
    } catch (error) {
      console.warn("Serial read stopped", error);
    } finally {
      await disconnectSerial();
      onDisconnect();
    }
  })();
}

export async function disconnectSerial() {
  const reader = state.reader;
  state.reader = null;
  if (reader) {
    try {
      await reader.cancel();
    } catch (_) {}
    try {
      reader.releaseLock();
    } catch (_) {}
  }
  const port = state.port;
  state.port = null;
  if (port?.readable || port?.writable) {
    try {
      await port.close();
    } catch (_) {}
  }
}

export async function sendCommand(command) {
  if (!state.port?.writable) return false;
  const writer = state.port.writable.getWriter();
  try {
    await writer.write(new TextEncoder().encode(`${command}\n`));
    return true;
  } finally {
    writer.releaseLock();
  }
}
