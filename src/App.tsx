import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowRight, ArrowRightLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, CircleHelp, Crosshair, Gift, History, Info, KeyRound, LoaderCircle, Menu, Plus, ShieldCheck, Sparkles, Target, Ticket, Trophy, Volume2, VolumeX, X, Zap } from 'lucide-react';
import { api } from './api';
import type { GameState, RewardType, ShotResult } from './api';

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const rewardInfo: Record<RewardType, { label: string; chance: number; description: string; icon: typeof Gift; color: string }> = {
  giftcard: { label: 'Gift card', chance: 2, description: 'R$ 10 em créditos na plataforma', icon: Gift, color: 'pink' },
  coupon: { label: 'Cupom de bônus', chance: 3, description: '5% no próximo depósito ou troca', icon: Ticket, color: 'yellow' },
  keychain: { label: 'Chaveiro', chance: 10, description: 'Um novo detalhe para sua skin', icon: KeyRound, color: 'blue' },
  highlights: { label: '3 destaques', chance: 25, description: 'Mais visibilidade para seus anúncios', icon: Zap, color: 'purple' },
  consolation: { label: '1 destaque', chance: 60, description: 'Errou? Sua skin ainda sai ganhando', icon: Sparkles, color: 'green' },
};

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const elements = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]');
      if (!elements?.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', onKey); before?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
      <div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Fechar" onClick={onClose}><X size={20} /></button></div>
      {children}
    </div>
  </div>;
}

function RewardIcon({ type, large = false }: { type: RewardType; large?: boolean }) {
  const { icon: Icon, color } = rewardInfo[type];
  return <div className={`reward-icon ${color} ${large ? 'large' : ''}`}><Icon size={large ? 36 : 22} strokeWidth={1.8} /></div>;
}

function playShot() {
  try {
    const context = new AudioContext();
    const buffer = context.createBuffer(1, context.sampleRate * 0.13, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 4);
    const source = context.createBufferSource();
    const gain = context.createGain(); gain.gain.value = 0.12;
    source.buffer = buffer; source.connect(gain); gain.connect(context.destination); source.start();
    source.onended = () => { void context.close(); };
  } catch { /* Audio is optional; gameplay remains available. */ }
}

export default function App() {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'deposit' | 'rules' | 'inventory' | null>(null);
  const [result, setResult] = useState<ShotResult | null>(null);
  const [firing, setFiring] = useState(false);
  const [impact, setImpact] = useState<{ x: number; y: number } | null>(null);
  const [sound, setSound] = useState(true);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [depositAmount, setDepositAmount] = useState('100');
  const [depositing, setDepositing] = useState(false);
  const [depositError, setDepositError] = useState('');
  const [toast, setToast] = useState('');
  const firingRef = useRef(false);
  const depositLock = useRef(false);
  const pendingShot = useRef<{ x: number; y: number; idempotencyKey: string } | null>(null);
  const depositKeys = useRef(new Map<number, string>());
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    setError('');
    try { setState(await api<GameState>('state')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar a campanha.'); }
  }, []);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);

  const openModal = (next: 'deposit' | 'rules' | 'inventory') => {
    if (firingRef.current) { setToast('Aguarde a revelação do seu prêmio para continuar.'); return; }
    setModal(next);
  };

  const shoot = async (x: number, y: number) => {
    if (!state || firingRef.current || result || modal) return;
    if (state.shots === 0) { openModal('deposit'); return; }
    firingRef.current = true; setFiring(true); setError(''); setImpact({ x, y });
    if (sound) playShot();
    const request = pendingShot.current ?? { x, y, idempotencyKey: crypto.randomUUID() };
    pendingShot.current = request;
    try {
      const [response] = await Promise.all([
        api<{ state: GameState; result: ShotResult }>('shots', request),
        new Promise(resolve => setTimeout(resolve, 650)),
      ]);
      pendingShot.current = null;
      if (alive.current) { setState(response.state); setResult(response.result); }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Não foi possível atirar. Tente novamente.');
    } finally { firingRef.current = false; if (alive.current) { setFiring(false); setImpact(null); } }
  };

  const deposit = async () => {
    if (depositLock.current) return;
    const amount = Number(depositAmount.replace(',', '.'));
    if (!Number.isFinite(amount) || amount < 0.01 || amount > 10000 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001) {
      setDepositError('Informe um valor de R$ 0,01 a R$ 10.000, com até 2 casas decimais.'); return;
    }
    depositLock.current = true; setDepositing(true); setDepositError('');
    const idempotencyKey = depositKeys.current.get(amount) ?? crypto.randomUUID();
    depositKeys.current.set(amount, idempotencyKey);
    try {
      const response = await api<{ state: GameState; creditedShots: number }>('deposits', { amount, idempotencyKey });
      depositKeys.current.delete(amount); setState(response.state); setModal(null);
      setToast(response.creditedShots ? `Depósito simulado! +${response.creditedShots} tiros no seu arsenal.` : 'Depósito simulado! Seu progresso para os próximos tiros foi atualizado.');
    } catch (e) { setDepositError(e instanceof Error ? e.message : 'Não foi possível simular o depósito.'); }
    finally { depositLock.current = false; setDepositing(false); }
  };

  const history = state ? [...state.history].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) : [];
  const shotCount = state?.shots ?? 0;
  const depositNumber = Number(depositAmount.replace(',', '.')) || 0;
  const predictedShots = Math.max(0, Math.floor(((state?.depositRemainder ?? 0) + depositNumber) / 100) * 3);

  return <>
    <header className="site-header">
      <div className="header-inner">
        <a className="brand" href="#inicio" aria-label="Dash Skins início"><span className="brand-symbol">$</span><span>DASH<span className="brand-light">SKINS</span><span className="brand-dot">.</span></span></a>
        <nav className={mobileMenu ? 'main-nav nav-open' : 'main-nav'} aria-label="Navegação principal">
          <a href="#como-funciona" onClick={() => setMobileMenu(false)}><ArrowRightLeft size={16} /> Como funciona</a>
          <a href="#premios" className="nav-active" onClick={() => setMobileMenu(false)}><Target size={17} /> Promoções<span className="nav-new">NOVO</span></a>
          <button onClick={() => { openModal('rules'); setMobileMenu(false); }}><CircleHelp size={16} /> Ajuda <ChevronDown size={12} /></button>
        </nav>
        <div className="header-account"><span className="demo-pill">DEMONSTRAÇÃO</span><button className="account-button" onClick={() => openModal('inventory')} aria-label="Abrir meus prêmios"><div className="avatar"><Crosshair size={21} /></div><span>Jogador<span className="account-sub">Modo treino</span></span><ChevronDown size={14} /></button></div>
        <button className="icon-button mobile-toggle" aria-label="Menu" aria-expanded={mobileMenu} onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X /> : <Menu />}</button>
      </div>
    </header>

    <main id="inicio" className="page-shell">
      <div className="breadcrumb"><span>Dash Skins</span><ChevronRight size={12} /><span>Promoções</span><ChevronRight size={12} /><span>Tiro ao Alvo</span></div>
      <section className="hero" aria-labelledby="campaign-title">
        <div className="hero-copy"><div className="eyebrow"><span className="live-dot" /> TIRO AO ALVO PREMIADO <span className="eyebrow-line" /></div><h1 id="campaign-title">MIRA NA SORTE.<br />ACERTE EM <span>PRÊMIOS.</span><span className="title-cross"><Crosshair /></span></h1><p>Seu próximo prêmio está a um tiro de distância.<br className="mobile-break" /> Aqui, até quem erra sai ganhando.</p></div>
        <div className="hero-promo"><div className="promo-icon"><Target size={32} strokeWidth={1.6} /><span>+3</span></div><div><span className="promo-kicker">RECARREGUE SUA SORTE</span><p>A cada <strong>R$ 100</strong> depositados,<br /> você ganha <strong className="text-green">3 tiros.</strong></p><button className="text-link" onClick={() => openModal('deposit')}>Conseguir mais tiros <ArrowUpRight size={15} /></button></div><ArrowUpRight className="promo-corner" size={17} /></div>
      </section>

      {error && <div className="error-banner" role="alert"><Info size={18} /><span>{error}</span><button onClick={() => void load()}>Atualizar</button></div>}

      <section className="play-layout" aria-label="Arena e seus tiros">
        <div className="game-column">
          <div className="arena-wrapper">
            <div className="arena-toolbar"><div><span className="live-dot" /><strong>CAMPO DE TREINO</strong><span className="toolbar-divider" /><span>DUST ARENA</span></div><div className="toolbar-actions"><span><ShieldCheck size={13} /> Todo tiro vale</span><button className="icon-button" onClick={() => setSound(!sound)} aria-label={sound ? 'Desativar som' : 'Ativar som'} aria-pressed={sound}>{sound ? <Volume2 size={17} /> : <VolumeX size={17} />}</button></div></div>
            <div ref={arenaRef} className={`arena ${firing ? 'is-firing' : ''} ${!shotCount && state ? 'no-shots' : ''}`} onPointerMove={e => { const rect = e.currentTarget.getBoundingClientRect(); if (e.pointerType === 'mouse') setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top }); }} onPointerLeave={() => setCursor(null)} onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); void shoot((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height); }} role="button" tabIndex={0} aria-label={shotCount ? `Atirar no alvo. ${shotCount} tiros disponíveis. Use Enter ou espaço.` : 'Sem tiros. Abrir recarga.'} aria-disabled={firing || !state} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); void shoot(0.5, 0.48); } }}>
              <div className="arena-image" /><div className="arena-shade" /><div className="arena-scanlines" />
              <div className="arena-top-hud"><span className="arena-badge"><span /> MODO DEMONSTRAÇÃO</span><div className="coordinate">DE_DUST • SECTOR 07 <span>128 TICK</span></div></div>
              <div className="arena-instruction"><span className="instruction-line" /><span>ESCOLHA SEU ALVO.</span><span className="instruction-line" /></div>
              <div className="targets" aria-hidden="true">{[0, 1, 2].map((n) => <div className={`target-stand target-${n}`} key={n}><div className="target-label">0{n + 1}</div><div className="target-board"><div className="target-ring ring-outer"><div className="target-ring ring-mid"><div className="target-ring ring-inner"><div className="bullseye"><Crosshair size={20} strokeWidth={1.5} /></div></div></div></div><i className="board-screw screw-tl" /><i className="board-screw screw-tr" /><i className="board-screw screw-bl" /><i className="board-screw screw-br" /></div><div className="target-pole" /><div className="target-foot" /></div>)}</div>
              <div className="arena-floor-label" aria-hidden="true"><span>✦</span> DASH TRAINING FACILITY <span>✦</span></div>
              <div className="weapon" aria-hidden="true"><img src="/pixel-rifle.svg" alt="" /><div className="weapon-flash" /></div>
              <div className="arena-bottom-hud"><div className="weapon-tag"><span className="weapon-indicator" /><div><strong>AK-47 <span>|</span> NEON DASH</strong><span>SEU EQUIPAMENTO DE TREINO</span></div></div><div className="ammo-hud"><Crosshair size={19} /><strong>{String(shotCount).padStart(2, '0')}</strong><span>TIROS<br />DISPONÍVEIS</span></div></div>
              {cursor && !firing && <span className="cs-crosshair" aria-hidden="true" style={{ left: cursor.x, top: cursor.y }}><i /><i /><i /><i /><b /></span>}
              {impact && <div className="impact" style={{ left: `${impact.x * 100}%`, top: `${impact.y * 100}%` }} aria-hidden="true"><X /><span /></div>}
              {!state && <div className="arena-loading"><LoaderCircle className="spin" />{error ? 'Arena indisponível. Atualize para tentar novamente.' : 'Preparando seu arsenal…'}</div>}
              {state && shotCount === 0 && !firing && <div className="empty-arena"><div className="empty-arena-inner"><Crosshair size={32} /><strong>HORA DE RECARREGAR.</strong><span>Mais tiros, mais chances de ganhar.</span><span className="button button-primary">Conseguir tiros <Plus size={16} /></span></div></div>}
            </div>
            <div className="arena-footer"><div><Crosshair size={15} /><span>{firing ? 'Revelando seu prêmio…' : 'Mire e clique em qualquer ponto para atirar.'}</span></div><span className="arena-footer-tip"><kbd>↵</kbd> também atira</span></div>
          </div>
          <div className="fairness-note"><ShieldCheck size={14} /><span>A mira é sua. A sorte é do sistema. <button onClick={() => openModal('rules')}>Entenda as probabilidades <ArrowUpRight size={12} /></button></span></div>
        </div>

        <aside className="player-panel" aria-label="Seu arsenal">
          <div className="arsenal-card"><div className="card-heading"><span><Crosshair size={17} /> SEU ARSENAL</span><span className="small-demo">DEMO</span></div><div className="shots-display"><span className="shot-number">{state ? String(shotCount).padStart(2, '0') : '—'}<span className="shot-number-shadow" aria-hidden="true">{String(shotCount).padStart(2, '0')}</span></span><div><strong>tiros disponíveis</strong><span>{history.length ? 'Seu próximo prêmio te espera.' : '3 tiros de boas-vindas para testar.'}</span></div></div><div className="ammo-bullets" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} className={i < shotCount ? 'bullet-active' : ''} />)}<span>{shotCount > 12 ? `+${shotCount - 12}` : 'PRONTO PARA O PRÓXIMO?'}</span></div><button className="button button-primary deposit-cta" onClick={() => openModal('deposit')} disabled={!state}><Plus size={18} /> Conseguir mais tiros <ArrowUpRight size={18} /></button><div className="deposit-progress"><div><span>Próxima recarga</span><strong>{money(state?.depositRemainder ?? 0)} <span>/ R$ 100</span></strong></div><div className="progress-track"><span style={{ width: `${state?.depositRemainder ?? 0}%` }} /></div><p>Complete R$ 100 em depósitos e ganhe +3 tiros.</p></div></div>
          <div className="inventory-card"><div className="card-heading"><span><Gift size={16} /> MEUS PRÊMIOS</span><button onClick={() => openModal('inventory')} aria-label="Ver todos os meus prêmios"><ArrowUpRight size={17} /></button></div><div className="inventory-summary"><span className="mini-reward purple"><Zap size={19} /></span><span><strong>{state?.rewards.highlights ?? 0} destaques</strong><small>para suas skins brilharem</small></span><span className="inventory-count">{history.length} <Trophy size={13} /></span></div><button className="inventory-link" onClick={() => openModal('inventory')}>Ver minhas recompensas <ChevronRight size={14} /></button></div>
          <div className="consolation-note"><div><Sparkles size={19} /></div><p><strong>Aqui não tem tiro perdido.</strong>Até errando o alvo, você ganha 1 destaque para ajudar a vender sua skin.</p></div>
        </aside>
      </section>

      <section id="premios" className="prizes-section" aria-labelledby="prizes-heading"><div className="section-heading"><div><span className="section-kicker">LOOT NA MIRA</span><h2 id="prizes-heading">CADA TIRO, UMA NOVA CHANCE.</h2></div><button className="quiet-button" onClick={() => openModal('rules')}><Info size={15} /> Regras e probabilidades <ArrowUpRight size={14} /></button></div><div className="prize-grid">{(Object.entries(rewardInfo) as [RewardType, typeof rewardInfo[RewardType]][]).map(([type, info]) => <div className={`prize-card ${info.color}`} key={type}><div className="prize-card-top"><RewardIcon type={type} /><span className="chance">{info.chance}<small>%</small></span></div><h3>{info.label}{type === 'giftcard' && <span className="rare-label">RARO</span>}</h3><p>{info.description}</p><div className="prize-bar"><span style={{ width: `${info.chance}%` }} /></div></div>)}</div></section>

      <section className="below-grid"><div id="como-funciona" className="how-section"><span className="section-kicker">DO DEPÓSITO AO PRÊMIO</span><h2>SEM COMPLICAÇÃO. SÓ NO ALVO.</h2><div className="steps"><div><span className="step-number">01</span><div><h3>Recarregue</h3><p>A cada R$ 100 depositados, ganhe 3 tiros para jogar.</p></div></div><ChevronRight className="step-arrow" size={17} /><div><span className="step-number">02</span><div><h3>Escolha e atire</h3><p>Mire em qualquer ponto da arena. O próximo tiro é seu.</p></div></div><ChevronRight className="step-arrow" size={17} /><div><span className="step-number">03</span><div><h3>Receba seu prêmio</h3><p>Todo disparo revela uma recompensa. Até quando errar.</p></div></div></div></div><div className="recent-section"><div className="recent-heading"><h3><History size={17} /> Seus últimos tiros</h3><button onClick={() => openModal('inventory')} aria-label="Ver histórico completo"><ArrowUpRight size={17} /></button></div>{history.length ? <div className="recent-list">{history.slice(0, 3).map(item => <div className="recent-item" key={item.id}><RewardIcon type={item.type} /><div><strong>{item.title}</strong><span>{new Date(item.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })} · Recompensa de demonstração</span></div><Check size={15} /></div>)}</div> : <div className="history-empty"><Target size={25} /><p>Seu primeiro prêmio começa com um tiro.<span>Experimente a arena e acompanhe tudo aqui.</span></p></div>}</div></section>

      <div className="demo-notice"><Info size={15} /><p><strong>Você está em uma demonstração.</strong> Os depósitos, itens e benefícios são simulados e não têm valor real. Nenhum pagamento é realizado.</p></div>
      <footer><a className="brand footer-brand" href="#inicio"><span className="brand-symbol">$</span><span>DASHSKINS<span className="brand-dot">.</span></span></a><span>O jogo continua aqui.</span><button onClick={() => openModal('rules')}>Regulamento da demonstração <ArrowUpRight size={13} /></button><a className="back-top" href="#inicio">Voltar ao topo <ArrowDown size={13} /></a></footer>
    </main>

    {modal === 'deposit' && <Modal title="RECARREGUE SUA SORTE." onClose={() => { if (!depositing) setModal(null); }}><div className="modal-eyebrow"><span className="live-dot" /> DEPÓSITO SIMULADO · SEM PAGAMENTO REAL</div><p className="modal-description">A cada R$ 100, seu arsenal recebe 3 tiros. Experimente a campanha sem gastar nada.</p><label className="input-label" htmlFor="deposit-amount">Valor do depósito</label><div className="money-input"><span>R$</span><input id="deposit-amount" type="text" inputMode="decimal" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} disabled={depositing} autoComplete="off" /></div><div className="amount-presets">{[100, 200, 500].map(amount => <button key={amount} className={depositNumber === amount ? 'selected' : ''} onClick={() => setDepositAmount(String(amount))} disabled={depositing}>{money(amount)}</button>)}</div><div className="deposit-preview"><span><Crosshair size={20} /> Você recebe</span><strong>+{Number.isFinite(predictedShots) ? predictedShots : 0} tiros</strong></div><p className="small-note">Valores menores também acumulam. Seu progresso atual: {money(state?.depositRemainder ?? 0)} de R$ 100.</p>{depositError && <p className="form-error" role="alert">{depositError}</p>}<button className="button button-primary modal-primary" onClick={() => void deposit()} disabled={depositing}>{depositing ? <><LoaderCircle size={17} className="spin" /> Simulando…</> : <>Simular depósito <ArrowRight size={18} /></>}</button><div className="modal-security"><ShieldCheck size={13} /> Nenhum dado de pagamento será solicitado.</div></Modal>}

    {modal === 'rules' && <Modal title="NA MIRA, SEM MISTÉRIO." onClose={() => setModal(null)} wide><div className="modal-eyebrow">REGRAS DA DEMONSTRAÇÃO</div><p className="modal-description">Cada disparo consome 1 tiro e revela uma recompensa. A posição da mira é interativa: o resultado é sorteado pelo servidor, independentemente de onde você clicar.</p><div className="rules-table">{(Object.entries(rewardInfo) as [RewardType, typeof rewardInfo[RewardType]][]).map(([type, info]) => <div key={type}><RewardIcon type={type} /><span><strong>{info.label}</strong><small>{info.description}</small></span><strong className={`text-${info.color}`}>{info.chance}%</strong></div>)}</div><div className="rules-details"><h3>Como os tiros são creditados?</h3><p>3 tiros iniciais são oferecidos para testar. Depois, cada R$ 100 em depósitos simulados rende 3 tiros. O valor restante acumula para a próxima recarga.</p><h3>Ganhei. E agora?</h3><p>As recompensas ficam salvas em “Meus prêmios”. Nesta versão, gift cards de R$ 10, cupons de 5%, chaveiros e destaques são demonstrativos. Não há entrega ou resgate de itens reais.</p><h3>Uma nova chance a cada disparo</h3><p>Os sorteios são independentes. As porcentagens representam a chance de cada tiro, sem garantia de prêmio raro após uma quantidade de tentativas. A soma das probabilidades é 100%.</p></div><button className="button button-primary modal-primary" onClick={() => setModal(null)}>Entendi, bora para a arena <Crosshair size={17} /></button></Modal>}

    {modal === 'inventory' && <Modal title="SEU LOOT ATÉ AQUI." onClose={() => setModal(null)} wide><div className="modal-eyebrow">INVENTÁRIO DE DEMONSTRAÇÃO</div><div className="inventory-totals"><div><Gift size={20} /><strong>{money(state?.rewards.giftcard ?? 0)}</strong><span>em gift cards</span></div><div><Zap size={20} /><strong>{state?.rewards.highlights ?? 0}</strong><span>destaques</span></div><div><Ticket size={20} /><strong>{state?.rewards.coupon ?? 0}</strong><span>cupons de 5%</span></div><div><KeyRound size={20} /><strong>{state?.rewards.keychain ?? 0}</strong><span>chaveiros</span></div></div><div className="inventory-history-title"><h3>Histórico de recompensas</h3><span>{history.length} tiros registrados</span></div>{history.length ? <div className="inventory-history">{history.map(item => <div className="inventory-history-item" key={item.id}><RewardIcon type={item.type} /><div><strong>{item.title}</strong><p>{item.description}</p><small>{new Date(item.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</small></div><span className="reward-saved"><Check size={13} /> Recebido</span></div>)}</div> : <div className="inventory-empty"><Target size={40} /><h3>Seu inventário está na mira.</h3><p>Atire na arena para revelar sua primeira recompensa.</p><button className="button button-primary" onClick={() => setModal(null)}>Vamos jogar <ArrowRight size={17} /></button></div>}<p className="small-note inventory-disclaimer"><Info size={13} /> Itens simulados, sem valor real. O progresso fica salvo nesta instância de demonstração e é compartilhado entre os visitantes.</p></Modal>}

    {result && <Modal title={result.type === 'consolation' ? 'ERROU O ALVO. GANHOU MESMO ASSIM.' : 'NA MOSCA! OLHA O SEU PRÊMIO.'} onClose={() => setResult(null)}><div className={`result-reveal ${rewardInfo[result.type].color}`}><div className="result-rays" /><span className="result-chance">{rewardInfo[result.type].chance}% DE CHANCE</span><RewardIcon type={result.type} large /><h3>{result.title}</h3><p>{result.description}</p><span className="result-credited"><Check size={14} /> Adicionado ao seu inventário de demonstração</span></div><button className="button button-primary modal-primary" onClick={() => setResult(null)}>{shotCount ? 'Bora para o próximo tiro' : 'Prêmio recebido!'} <ArrowRight size={18} /></button><button className="result-inventory-link" onClick={() => { setResult(null); openModal('inventory'); }}>Ver meus prêmios <ArrowUpRight size={14} /></button></Modal>}
    {toast && <div className="toast" role="status"><div><Check size={18} /></div><span>{toast}</span><button className="icon-button" onClick={() => setToast('')} aria-label="Fechar aviso"><X size={15} /></button></div>}
    <div className="sr-only" aria-live="polite">{state ? `${shotCount} tiros disponíveis.` : 'Carregando arena.'}{firing ? 'Revelando seu prêmio.' : ''}</div>
  </>;
}
