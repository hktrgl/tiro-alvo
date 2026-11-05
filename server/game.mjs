import { randomInt, randomUUID } from 'node:crypto';

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const rewardFromRoll = (roll) => {
  if (!Number.isInteger(roll) || roll < 0 || roll >= 10_000) {
    throw new RangeError('O sorteio deve ser um inteiro de 0 a 9999.');
  }
  if (roll < 200) return 'giftcard';
  if (roll < 500) return 'coupon';
  if (roll < 1_500) return 'keychain';
  if (roll < 4_000) return 'highlights';
  return 'consolation';
};

export const createGameState = () => ({
  mode: 'demo',
  shots: 3,
  depositTotal: 0,
  depositRemainder: 0,
  history: [],
  rewards: { giftcard: 0, coupon: 0, keychain: 0, highlights: 0 },
});

export const createDocument = () => ({ version: 1, state: createGameState(), receipts: {} });

function validateKey(key) {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(key)) {
    throw new GameError('Envie uma chave única válida para esta operação.');
  }
}

function receipt(document, operation, key, fingerprint) {
  validateKey(key);
  const saved = document.receipts[`${operation}:${key}`];
  if (saved && saved.fingerprint !== fingerprint) {
    throw new GameError('Esta chave já foi usada em outra operação.', 409);
  }
  return saved;
}

/** Pure transactions: persist nextDocument atomically before accepting the response. */
export function deposit(document, input) {
  const { amount, idempotencyKey } = input;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 10_000) {
    throw new GameError('O depósito de demonstração deve ser entre R$ 0,01 e R$ 10.000.');
  }
  const cents = Math.round(amount * 100);
  if (cents < 1 || Math.abs(amount * 100 - cents) > 0.000001) {
    throw new GameError('Informe um valor com até duas casas decimais.');
  }
  const fingerprint = String(cents);
  const saved = receipt(document, 'deposit', idempotencyKey, fingerprint);
  if (saved) return { nextDocument: document, response: { state: document.state, creditedShots: saved.creditedShots } };

  const nextDocument = structuredClone(document);
  const state = nextDocument.state;
  const remainderCents = Math.round(state.depositRemainder * 100) + cents;
  const creditedShots = Math.floor(remainderCents / 10_000) * 3;
  const totalCents = Math.round(state.depositTotal * 100) + cents;
  if (!Number.isSafeInteger(totalCents) || !Number.isSafeInteger(state.shots + creditedShots)) {
    throw new GameError('Limite de demonstração atingido.', 409);
  }
  state.depositTotal = totalCents / 100;
  state.depositRemainder = (remainderCents % 10_000) / 100;
  state.shots += creditedShots;
  nextDocument.receipts[`deposit:${idempotencyKey}`] = { fingerprint, creditedShots };
  return { nextDocument, response: { state, creditedShots } };
}

const descriptions = {
  giftcard: { title: 'Gift Card de R$ 10', description: 'R$ 10 em créditos de demonstração para usar na plataforma.' },
  coupon: { title: 'Cupom de 5%', description: '5% de bônus no próximo depósito ou troca. Recompensa demonstrativa.' },
  keychain: { title: 'Chaveiro surpresa', description: 'Um chaveiro para a sua coleção. Item ilustrativo nesta demonstração.' },
  highlights: { title: '3 destaques para anúncios', description: 'Seu anúncio no radar: você ganhou um pacote com 3 destaques.' },
  consolation: { title: '1 destaque de consolação', description: 'O alvo escapou, mas sua skin ganha visibilidade com 1 destaque gratuito.' },
};

export function shoot(document, input, options = {}) {
  const { x, y, idempotencyKey } = input;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    throw new GameError('Escolha um ponto dentro da arena.');
  }
  const fingerprint = JSON.stringify([x, y]);
  const saved = receipt(document, 'shot', idempotencyKey, fingerprint);
  if (saved) return { nextDocument: document, response: { state: document.state, result: saved.result } };
  if (document.state.shots < 1) throw new GameError('Você está sem tiros. Faça um depósito de demonstração para recarregar.', 409);

  const type = rewardFromRoll(options.roll ? options.roll() : randomInt(10_000));
  const result = { id: randomUUID(), type, ...descriptions[type], createdAt: new Date().toISOString(), x, y };
  const nextDocument = structuredClone(document);
  const state = nextDocument.state;
  state.shots -= 1;
  if (type === 'giftcard') state.rewards.giftcard += 10;
  if (type === 'coupon') state.rewards.coupon += 1;
  if (type === 'keychain') state.rewards.keychain += 1;
  if (type === 'highlights') state.rewards.highlights += 3;
  if (type === 'consolation') state.rewards.highlights += 1;
  state.history = [result, ...state.history].slice(0, 100);
  nextDocument.receipts[`shot:${idempotencyKey}`] = { fingerprint, result };
  return { nextDocument, response: { state, result } };
}
