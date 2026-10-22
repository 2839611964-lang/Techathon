import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bell, Check, ChevronRight, Heart, ImagePlus, MessageCircle, Mic, MicOff, PackageOpen, Send, Settings, ShieldCheck, Sparkles, Upload, User, Volume2, X } from 'lucide-react';
import LiveMirror from './components/CameraStudio';
import { looks, socialPosts, vanityItems } from './data/lookbook';
import { createRealtimeConversation } from './lib/realtime';
import { readJson } from './lib/api';

function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN'; utterance.rate = .96; utterance.pitch = 1.04;
  window.speechSynthesis.speak(utterance);
}

function thumbSrc(src = '') {
  return src.startsWith('/looks/') ? src.replace('/looks/', '/thumbs/') : src;
}

function spokenStepNumber(value = '') {
  if (/^\d+$/.test(value)) return Number(value);
  return { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }[value] || 0;
}

function voiceStepTarget(text, current, total) {
  const command = String(text || '').replace(/[\s，。！？,.!?]/g, '');
  if (!command || /(?:不要|别|不用|先不).*(?:下一步|上一步|切换)/.test(command)) return null;
  const numbered = command.match(/第([一二三四五六七八九十\d]+)(?:步|个步骤)/);
  if (numbered) {
    const index = spokenStepNumber(numbered[1]) - 1;
    return index >= 0 && index < total ? index : null;
  }
  if (/(?:上一步|上一个步骤|返回前一步|回到前一步)/.test(command)) return Math.max(0, current - 1);
  if (/(?:下一步|下一个步骤|进入下步|开始下步)/.test(command) && !/(?:是什么|怎么|做什么|内容)/.test(command)) return Math.min(total - 1, current + 1);
  if (/^(?:好|好的|可以|完成|完成了)?(?:继续|往下)(?:吧|了)?$/.test(command)) return Math.min(total - 1, current + 1);
  return null;
}

function LookCard({ look, onOpen }) {
  return <button className="look-card photo-card" onClick={() => onOpen(look)}>
    <img src={look.image} alt={`${look.title} AI 妆容示意`} loading="lazy" decoding="async" /><span className="look-shade" />
    <div className="photo-card-copy"><small>{look.duration} · {look.level}</small><h3>{look.title}</h3><span>{look.focus}<ChevronRight size={16} /></span></div>
  </button>;
}

function LookDetail({ look, onClose, onStart }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={look.title}><div className="look-sheet page-enter">
    <img src={look.image} alt={`${look.title} AI 妆容效果`} decoding="async" /><button className="sheet-close" onClick={onClose} aria-label="关闭"><X /></button>
    <div className="sheet-copy"><small>{look.level} · {look.duration}</small><h2>{look.title}</h2>
      <div className="palette">{look.palette.map((color) => <i key={color} style={{ background: color }} />)}</div>
      <div className="step-mini">{look.steps.map((item, index) => <span key={item.title}><b>{index + 1}</b>{item.part}</span>)}</div>
      <button className="start-look" onClick={() => onStart(look)}><Volume2 size={18} />和 Marie 开始</button>
      {look.sourceUrl !== '#' && <a href={look.sourceUrl} target="_blank" rel="noreferrer">灵感来源 ↗</a>}
    </div>
  </div></div>;
}

function SocialPage({ onStart }) {
  const [liked, setLiked] = useState([]);
  return <section className="social-page page-enter">
    <header className="social-head"><div className="wordmark">MARIE<small>COMMUNITY</small></div><button aria-label="通知"><Bell size={19} /></button></header>
    <div className="social-title"><small>BONJOUR, BEAUTY</small><h1>每一种年龄，<br />都有自己的光。</h1></div>
    <div className="story-row">{looks.slice(4, 8).map((look) => <button key={look.id} onClick={() => onStart(look)}><img src={thumbSrc(look.image)} alt="" decoding="async" /><span>{look.focus.split(' / ')[0]}</span></button>)}</div>
    <div className="feed-grid">{socialPosts.map((post) => <article className="post-card" key={post.id}>
      <header><img src={thumbSrc(post.avatar)} alt="" loading="lazy" decoding="async" /><div><b>{post.user}</b><small>{post.meta}</small></div><span>{post.tag}</span></header>
      <img className="post-image" src={post.image} alt={`${post.user}分享的妆容`} loading="lazy" decoding="async" />
      <div className="post-actions"><button className={liked.includes(post.id) ? 'liked' : ''} onClick={() => setLiked((items) => items.includes(post.id) ? items.filter((id) => id !== post.id) : [...items, post.id])}><Heart size={18} fill={liked.includes(post.id) ? 'currentColor' : 'none'} />{post.likes + (liked.includes(post.id) ? 1 : 0)}</button><span><MessageCircle size={17} />{post.comments}</span></div>
      <p>{post.text}</p>
    </article>)}</div>
  </section>;
}

function LibraryPage({ onLook }) {
  const [filter, setFilter] = useState('全部'); const inputRef = useRef(null);
  const filtered = useMemo(() => {
    if (filter === '全部') return looks;
    if (filter === '50+') return looks.filter((look) => look.id === 'mature-lift');
    return looks.filter((look) => look.level === filter || look.focus.includes(filter));
  }, [filter]);
  const importLook = (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    const image = URL.createObjectURL(file); const base = looks[0];
    onLook({ ...base, id: `import-${Date.now()}`, image, title: file.name.replace(/\.[^.]+$/, '') || '我导入的妆容', subtitle: '由 Marie 按画面拆解', sourceUrl: '#', focus: '我的参考图' });
  };
  return <section className="library-page visual-library page-enter">
    <header className="visual-title library-title"><div><small>LOOKBOOK</small><h1>不同年龄，<br />都能找到参照。</h1></div><button className="import-look" onClick={() => inputRef.current?.click()}><Upload size={17} />导入妆容</button><input ref={inputRef} type="file" accept="image/*" hidden onChange={importLook} /></header>
    <div className="filter-row">{['全部', '新手', '50+', '银发', '多元肤色'].map((item) => <button className={filter === item ? 'on' : ''} onClick={() => setFilter(item)} key={item}>{item}</button>)}</div>
    <div className="portrait-grid">{filtered.map((look) => <LookCard key={look.id} look={look} onOpen={onLook} />)}</div>
  </section>;
}

function AssistantPage({ activeLook, onChoose }) {
  const [step, setStep] = useState(0); const [voiceState, setVoiceState] = useState('idle'); const [muted, setMuted] = useState(false);
  const [voiceError, setVoiceError] = useState(''); const [level, setLevel] = useState(0); const [feedback, setFeedback] = useState(null);
  const [chatOpen, setChatOpen] = useState(false); const [input, setInput] = useState(''); const [messages, setMessages] = useState([]); const [sending, setSending] = useState(false);
  const conversation = useRef(null); const mirror = useRef(null); const lastSpoken = useRef(''); const stepRef = useRef(0); const lastVoiceCommand = useRef({ text: '', at: 0 }); const current = activeLook.steps[step];
  const voiceActive = voiceState === 'connected' || voiceState === 'fallback';

  useEffect(() => { stepRef.current = 0; setStep(0); setFeedback(null); return () => { conversation.current?.disconnect(); window.speechSynthesis?.cancel(); }; }, [activeLook]);
  const coachSay = (text) => {
    if (!text || text === lastSpoken.current) return; lastSpoken.current = text;
    if (voiceState === 'connected') conversation.current?.sendObservation?.(text); else speak(text);
  };
  const handleRealtimeTranscript = useCallback((item) => {
    setMessages((items) => [...items, item]);
    if (item.role !== 'user') return;
    const commandText = String(item.text || '').replace(/\s/g, ''); const now = Date.now();
    if (commandText === lastVoiceCommand.current.text && now - lastVoiceCommand.current.at < 2000) return;
    const targetIndex = voiceStepTarget(item.text, stepRef.current, activeLook.steps.length);
    if (targetIndex == null || targetIndex === stepRef.current) return;
    lastVoiceCommand.current = { text: commandText, at: now };
    stepRef.current = targetIndex; setStep(targetIndex); setFeedback(null);
    conversation.current?.updateStep?.({ look: activeLook, step: activeLook.steps[targetIndex], index: targetIndex });
  }, [activeLook]);
  const beginVoice = async () => {
    setVoiceError('');
    if (voiceActive || voiceState === 'connecting') { conversation.current?.disconnect(); mirror.current?.stopCamera(); window.speechSynthesis?.cancel(); setVoiceState('idle'); return; }
    setVoiceState('connecting'); mirror.current?.startCamera();
    try {
      conversation.current = await createRealtimeConversation({ look: activeLook, step: current, onState: (state, detail) => { setVoiceState(state); if (detail) setVoiceError(detail); }, onTranscript: handleRealtimeTranscript, onLevel: setLevel });
      await conversation.current.connect();
    } catch (error) {
      conversation.current?.disconnect(); conversation.current = null; setVoiceState('fallback');
      setVoiceError(`${error.message || '豆包实时语音暂不可用'} · 已切换设备语音`);
      speak(`我们开始${activeLook.title}。第一步，${current.title}。${current.detail}`);
    }
  };
  const toggleMute = () => { const next = !muted; setMuted(next); conversation.current?.setMuted(next); if (next) window.speechSynthesis?.cancel(); };
  const goStep = (next) => {
    const value = Math.max(0, Math.min(activeLook.steps.length - 1, next)); stepRef.current = value; setStep(value); setFeedback(null); const target = activeLook.steps[value];
    if (voiceState === 'connected') conversation.current?.updateStep?.({ look: activeLook, step: target, index: value });
    else if (voiceState === 'fallback') speak(`第${value + 1}步，${target.part}。${target.title}。${target.detail}`);
  };
  const handleFeedback = (data) => { setFeedback(data); coachSay(`镜头发现：${data.summary}。现在先${data.suggestions?.[0] || data.summary}`); };
  const handleLocalFeedback = (data) => { if (!voiceActive || muted) return; setFeedback(data); };
  const handleVisionSnapshot = useCallback((packet) => conversation.current?.sendVisionSnapshot?.(packet), []);
  const send = async () => {
    const text = input.trim(); if (!text || sending) return; setInput(''); setSending(true); setMessages((items) => [...items, { role: 'user', text }]);
    try { const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [...messages, { role: 'user', text }].slice(-10) }) }); const data = await readJson(response, 'Marie 暂时没有连上'); setMessages((items) => [...items, { role: 'assistant', text: data.text }]); }
    catch (error) { setMessages((items) => [...items, { role: 'assistant', text: error.message }]); } finally { setSending(false); }
  };
  return <section className="coach-page page-enter">
    <header className="coach-head"><button onClick={onChoose}><ArrowLeft size={18} /></button><div><small>MARIE · {String(step + 1).padStart(2, '0')}/{String(activeLook.steps.length).padStart(2, '0')}</small><h1>{activeLook.title}</h1></div><img src={thumbSrc(activeLook.image)} alt="" decoding="async" /></header>
    <div className="coach-stage"><LiveMirror ref={mirror} look={activeLook} step={current} voiceActive={voiceActive} onFeedback={handleFeedback} onLocalFeedback={handleLocalFeedback} onVisionSnapshot={handleVisionSnapshot} />
      <div className="coach-instruction"><small>{current.part}</small><h2>{current.title}</h2>{feedback && <p>{feedback.suggestions?.[0] || feedback.summary}</p>}</div>
    </div>
    <div className="coach-controls"><button className="step-arrow" onClick={() => goStep(step - 1)} disabled={step === 0}><ArrowLeft /></button>
      {voiceActive && <button className={`mute-control ${muted ? 'on' : ''}`} onClick={toggleMute}>{muted ? <MicOff /> : <Mic />}</button>}
      <button className={`coach-call ${voiceState !== 'idle' ? 'active' : ''}`} style={{ '--pulse': 1 + level * .1 }} onClick={beginVoice}>{voiceState === 'idle' ? <><Volume2 />开始实时陪练</> : voiceState === 'connecting' ? '连接中…' : voiceState === 'connected' ? 'Marie 在听' : '设备语音中'}</button>
      <button className="step-arrow" onClick={() => goStep(step + 1)} disabled={step === activeLook.steps.length - 1}><ArrowRight /></button></div>
    {voiceError && <div className="coach-error">{voiceError}</div>}
    <div className="step-dots">{activeLook.steps.map((item, index) => <button key={item.title} className={index === step ? 'on' : index < step ? 'done' : ''} onClick={() => goStep(index)} aria-label={`第${index + 1}步 ${item.part}`}>{index < step ? <Check size={11} /> : index + 1}</button>)}</div>
    <button className="chat-toggle" onClick={() => setChatOpen((value) => !value)}>{chatOpen ? '收起' : '文字问 Marie'}</button>
    {chatOpen && <div className="mini-chat"><div>{messages.slice(-3).map((item, index) => <p className={item.role} key={index}>{item.text}</p>)}</div><label><input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && send()} placeholder="问一句…" /><button onClick={send} disabled={!input.trim() || sending}><Send size={16} /></button></label></div>}
  </section>;
}

function ProductDetail({ item, onClose }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="product-sheet page-enter"><button className="sheet-close" onClick={onClose}><X /></button><img className="product-main" src={item.image} alt={item.name} /><small>{item.type}</small><h2>{item.name}</h2><p>当前为 AI 产品候选，接入真实商品库后可替换为品牌、色号与购买链接。</p><div className="product-list">{item.products.map((name, index) => <button key={name}><img src={item.image} alt="" /><span><b>{name}</b><small>{['自然质感', '日常耐用', '多肤质可选'][index]}</small></span><ChevronRight /></button>)}</div></div></div>;
}

function VanityPage({ onProduct }) {
  return <section className="vanity-page page-enter"><header className="visual-title"><small>MY VANITY</small><h1>这一包，<br />都能替换。</h1></header>
    <div className="vanity-hero"><img src="/looks/vanity-tools.webp" alt="AI 生成的化妆工具组合" decoding="async" /><span>8 essentials</span></div>
    <div className="vanity-grid">{vanityItems.map((item) => <button key={item.id} onClick={() => onProduct(item)}><img src={item.image} alt={item.name} loading="lazy" decoding="async" /><span><b>{item.name}</b><small>{item.type} · {item.products.length} 个候选</small></span><ChevronRight size={16} /></button>)}</div>
  </section>;
}

function SettingsPage() {
  const [cameraTips, setCameraTips] = useState(true); const [voiceTips, setVoiceTips] = useState(true);
  return <section className="settings-page page-enter"><header className="visual-title"><small>MY MARIE</small><h1>为你，<br />调成刚刚好。</h1></header>
    <div className="profile-card"><img src="/marie-avatar.webp" alt="" decoding="async" /><div><h2>Marie 用户</h2><p>已完成 3 次跟妆</p></div><button><User size={18} />编辑</button></div>
    <div className="settings-group"><h3>陪练设置</h3><label><span><Volume2 />持续语音指导</span><input type="checkbox" checked={voiceTips} onChange={() => setVoiceTips(!voiceTips)} /></label><label><span><Sparkles />实时镜头纠偏</span><input type="checkbox" checked={cameraTips} onChange={() => setCameraTips(!cameraTips)} /></label></div>
    <div className="settings-group"><h3>隐私与服务</h3><button><span><ShieldCheck />相机与隐私</span><ChevronRight /></button><button><span><Settings />AI 服务状态</span><small>设备模式可用</small></button></div>
    <p className="privacy-note">实时陪练会发送压缩快照与设备端视觉特征；画面仅即时处理，不会保存。</p>
  </section>;
}

export default function App() {
  const [tab, setTab] = useState('social'); const [selectedLook, setSelectedLook] = useState(null); const [selectedProduct, setSelectedProduct] = useState(null); const [activeLook, setActiveLook] = useState(looks[0]);
  useEffect(() => { window.scrollTo(0, 0); }, [tab]);
  const startLook = (look) => { setActiveLook(look); setSelectedLook(null); setTab('assistant'); };
  const render = () => {
    if (tab === 'social') return <SocialPage onStart={startLook} />;
    if (tab === 'library') return <LibraryPage onLook={setSelectedLook} />;
    if (tab === 'assistant') return <AssistantPage activeLook={activeLook} onChoose={() => setTab('library')} />;
    if (tab === 'vanity') return <VanityPage onProduct={setSelectedProduct} />;
    return <SettingsPage />;
  };
  const tabs = [{ id: 'social', label: '圈子', icon: MessageCircle }, { id: 'library', label: '妆容', icon: Heart }, { id: 'assistant', label: 'Marie', icon: Sparkles }, { id: 'vanity', label: '化妆包', icon: PackageOpen }, { id: 'settings', label: '我的', icon: Settings }];
  return <div className="app-shell"><main>{render()}</main><nav className="tabbar five-tabs">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={`${tab === id ? 'on' : ''} ${id === 'assistant' ? 'marie-tab' : ''}`} onClick={() => setTab(id)}><span>{id === 'assistant' ? <img src="/marie-avatar.webp" alt="" decoding="async" /> : <Icon size={19} />}</span><small>{label}</small></button>)}</nav>
    {selectedLook && <LookDetail look={selectedLook} onClose={() => setSelectedLook(null)} onStart={startLook} />}{selectedProduct && <ProductDetail item={selectedProduct} onClose={() => setSelectedProduct(null)} />}
  </div>;
}
