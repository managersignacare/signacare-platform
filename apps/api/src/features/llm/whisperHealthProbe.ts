export async function probeWhisperHealth(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
