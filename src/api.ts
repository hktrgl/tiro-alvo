export type RewardType = 'giftcard' | 'coupon' | 'keychain' | 'highlights' | 'consolation';
export interface ShotResult {
  id: string; type: RewardType; title: string; description: string;
  createdAt: string; x: number; y: number;
}
export interface GameState {
  shots: number; depositTotal: number; depositRemainder: number; history: ShotResult[];
  rewards: { giftcard: number; coupon: number; keychain: number; highlights: number }; mode: 'demo';
}
export async function api<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir. Tente novamente.');
  return data;
}
