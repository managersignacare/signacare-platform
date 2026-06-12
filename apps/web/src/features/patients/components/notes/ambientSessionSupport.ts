export function isAmbientScribeSessionActive(
  recording: boolean,
  processing: boolean,
): boolean {
  return recording || processing;
}
