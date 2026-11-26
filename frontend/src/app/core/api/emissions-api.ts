import { apiRequest, readApiError } from './api-client';

export interface RoadEmissionResult {
  origin: string;
  destination: string;
  distanceKm: number;
  weightKg: number;
  tonKilometers: number;
  factorKgCo2ePerTkm: number;
  emissionsKgCo2e: number;
  attribution: string;
  cached?: boolean;
  approximate?: boolean;
}

type ProgressEvent = { type: 'progress'; message: string };
type ResultEvent = { type: 'result'; result: RoadEmissionResult };
type ErrorEvent = { type: 'error'; error: string };
type StreamEvent = ProgressEvent | ResultEvent | ErrorEvent;

export async function calculateRoadEmissions(
  origin: string,
  destination: string,
  weightKg: number,
  onProgress: (message: string) => void = () => undefined,
): Promise<RoadEmissionResult> {
  let response: Response;
  try {
    response = await apiRequest('/emissions/road/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ origin, destination, weightKg }),
      signal: AbortSignal.timeout(35000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(
        'API se ni odzval v 35 sekundah. Preveri, da sta zagnana Railopt API in internetna povezava.',
      );
    }
    throw new Error(
      'Z aplikacijskim API-jem se ni mogoče povezati. Zapri in ponovno zaženi Railopt.',
    );
  }
  if (!response.ok)
    throw new Error(await readApiError(response, 'Cestne razdalje ni bilo mogoče izračunati.'));
  if (!response.body) throw new Error('Strežnik ni poslal podatkov o napredku.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: RoadEmissionResult | undefined;
  let serverError: string | undefined;

  const handleFrame = (frame: string): void => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data) return;
    const event = JSON.parse(data) as StreamEvent;
    if (event.type === 'progress') onProgress(event.message);
    if (event.type === 'result') result = event.result;
    if (event.type === 'error') serverError = event.error;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || '';
      for (const frame of frames) handleFrame(frame);
      if (done) break;
    }
    if (buffer.trim()) handleFrame(buffer);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error('Iskanje je preseglo 35 sekund. Preveri povezavo in poskusi znova.');
    }
    throw new Error('Povezava s storitvijo za iskanje cestne poti je bila prekinjena.');
  }
  if (serverError) throw new Error(serverError);
  if (!result) throw new Error('Strežnik je zaključil iskanje brez rezultata. Poskusi znova.');
  return result;
}

export function googleMapsSearchUrl(value: string): string {
  const query = value.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || 'Slovenia')}`;
}
