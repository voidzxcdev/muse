import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import { ArrowLeft, Check, CheckCheck, Circle, Copy, Film, Image as ImageIcon, ListMusic, Mic, Music2, Paperclip, Pencil, Play, Pause, Reply, Search, Send, Smile, Square, Trash2, UserMinus, UserPlus, Users, X, Video, Lock } from 'lucide-react';
import { api, fetchJSON, post, upload } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useRouter } from '@/lib/router';
import { useUI } from '@/lib/ui-store';
import { usePlayer } from '@/player/store';
import type { ChatMsg, PubUser, Track } from '@/lib/types';
import { cn, fmt, prettyTitle, seenLabel, writeClip, ytThumb } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Avatar, Skeleton, Tip, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';
import { Empty } from '@/components/tracks';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const REACTS = ['❤️', '🔥', '👍', '😂', '😮', '😢', '🎉'];
const KIND_LABEL: Record<string, string> = { song: 'Трек', playlist: 'Плейлист', profile: 'Профиль', voice: 'Голосовое', audio: 'Аудио', video: 'Видео', round: 'Кружок', gif: 'GIF', image: 'Фото', text: '' };
const fileSrc = (p: any) => { let u = p?.url || (p?.file ? `/api/chat/file/${encodeURIComponent(p.file)}` : ''); if (!u) return ''; return u.includes('?') ? `${u}&m=260` : `${u}?m=260`; };
const timeOf = (ts: number) => { try { return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

interface FriendsData { friends: PubUser[]; incoming: PubUser[]; outgoing: PubUser[] }

export function FriendsView({ handle }: { handle: string }) {
  const me = useSession((s) => s.me);
  const open = useUI((s) => s.open);
  const nav = useRouter((s) => s.navigate);
  const [data, setData] = React.useState<FriendsData | null>(null);
  const [q, setQ] = React.useState('');
  const [hits, setHits] = React.useState<PubUser[] | null>(null);
  const load = React.useCallback(() => api<FriendsData>('/api/friends').then(setData).catch(() => {}), []);
  React.useEffect(() => { if (me) { load(); const t = setInterval(load, 15000); return () => clearInterval(t); } }, [me?.id]);
  React.useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => fetchJSON(`/api/users?q=${encodeURIComponent(q.trim().replace(/^@/, ''))}&n=8`, { signal: ctl.signal }).then((j) => setHits(j.users || [])).catch(() => {}), 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  if (!me) return <div className="mx-auto max-w-3xl px-4 py-10"><Empty icon={Lock} title="Друзья" sub="Sign in to add friends, chat and see what they're listening to."><Button onClick={() => open({ kind: 'auth', tab: 'signin' })}>Sign in</Button></Empty></div>;
  const act = async (path: string, h: string, ok: string) => { try { await post(path, { handle: h }); toast.success(ok); load(); } catch (e: any) { toast.error(e.message); } };
  const chatOpen = !!handle;
  return <div className="mx-auto grid h-full min-h-0 w-full max-w-[1400px] grid-cols-1 md:grid-cols-[320px_1fr]">
    <aside className={cn('flex min-h-0 flex-col border-r', chatOpen && 'max-md:hidden')}>
      <div className="border-b p-4">
        <h1 className="text-xl font-semibold tracking-tight">Друзья</h1>
        <div className="relative mt-3"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти по @handle" className="pl-8" /></div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-thin">
        {hits && <Section title="Поиск">{hits.length ? hits.filter((u) => u.handle !== me.handle).map((u) => {
          const isF = data?.friends.some((f) => f.handle === u.handle); const out = data?.outgoing.some((f) => f.handle === u.handle); const inc = data?.incoming.some((f) => f.handle === u.handle);
          return <PersonRow key={u.handle} u={u} onClick={() => nav({ view: 'user', handle: u.handle })} right={isF ? <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); nav({ view: 'friends', handle: u.handle }); }}>Chat</Button>
            : out ? <span className="text-xs text-muted-foreground">sent</span> : inc ? <Button size="sm" onClick={(e) => { e.stopPropagation(); act('/api/friends/accept', u.handle, 'Теперь вы друзья'); }}>Accept</Button>
            : <Button size="icon-sm" variant="outline" aria-label="Add friend" onClick={(e) => { e.stopPropagation(); act('/api/friends/request', u.handle, 'Заявка отправлена'); }}><UserPlus /></Button>} />;
        }) : <p className="px-2 py-3 text-sm text-muted-foreground">Никого не нашли</p>}</Section>}
        {!data ? <div className="space-y-2 p-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div> : <>
          {data.incoming.length > 0 && <Section title={`Заявки · ${data.incoming.length}`}>{data.incoming.map((u) => <PersonRow key={u.handle} u={u} onClick={() => nav({ view: 'user', handle: u.handle })}
            right={<div className="flex gap-1"><Button size="icon-sm" aria-label="Accept" onClick={(e) => { e.stopPropagation(); act('/api/friends/accept', u.handle, 'Теперь вы друзья'); }}><Check /></Button><Button size="icon-sm" variant="outline" aria-label="Decline" onClick={(e) => { e.stopPropagation(); act('/api/friends/decline', u.handle, 'Отклонено'); }}><X /></Button></div>} />)}</Section>}
          <Section title={`Друзья · ${data.friends.length}`}>{data.friends.length ? data.friends.map((u) => <PersonRow key={u.handle} u={u} active={handle === u.handle} sub={seenLabel(u) || `@${u.handle}`} onClick={() => nav({ view: 'friends', handle: u.handle })} />)
            : <p className="px-2 py-3 text-sm text-muted-foreground">Пока никого. Найди друзей по @handle.</p>}</Section>
          {data.outgoing.length > 0 && <Section title="Отправленные">{data.outgoing.map((u) => <PersonRow key={u.handle} u={u} sub="ждёт ответа" onClick={() => nav({ view: 'user', handle: u.handle })} />)}</Section>}
        </>}
      </div>
    </aside>
    <section className={cn('flex min-h-0 flex-col', !chatOpen && 'max-md:hidden')}>
      {chatOpen ? <Chat key={handle} handle={handle} meta={data?.friends.find((f) => f.handle === handle)} onRemoved={() => { load(); nav({ view: 'friends', handle: '' }); }} />
        : <div className="flex flex-1 items-center justify-center p-8"><Empty icon={Users} title="Выбери друга" sub="Сообщения, треки, плейлисты, голосовые и кружки." /></div>}
    </section>
  </div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="mb-3"><p className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>{children}</div>;
}
function PersonRow({ u, onClick, right, sub, active }: { u: PubUser; onClick: () => void; right?: React.ReactNode; sub?: string; active?: boolean }) {
  return <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => e.key === 'Enter' && onClick()}
    className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/60', active && 'bg-accent')}>
    <Avatar user={u} size={38} online={u.online} />
    <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{u.display || u.handle}</div><div className={cn('truncate text-xs', u.online ? 'text-emerald-500' : 'text-muted-foreground')}>{sub ?? `@${u.handle}`}</div></div>
    {right}
  </div>;
}

/* ---------------- Chat ---------------- */
function useRecorder() {
  const [rec, setRec] = React.useState<{ kind: 'voice' | 'round'; started: number; stream: MediaStream } | null>(null);
  const mr = React.useRef<MediaRecorder | null>(null);
  const chunks = React.useRef<Blob[]>([]);
  const start = async (kind: 'voice' | 'round') => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(kind === 'voice' ? { audio: { echoCancellation: true, noiseSuppression: true } } : { audio: true, video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } } });
      const types = kind === 'voice' ? ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'] : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm'];
      const mimeType = types.find((t) => (window as any).MediaRecorder?.isTypeSupported?.(t));
      const r = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000, videoBitsPerSecond: kind === 'round' ? 1_200_000 : undefined });
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.start(250);
      mr.current = r;
      setRec({ kind, started: Date.now(), stream });
    } catch (e: any) { toast.error(e?.name === 'NotAllowedError' ? 'Нет доступа к микрофону/камере' : 'Не удалось начать запись'); }
  };
  const stop = (send: boolean): Promise<{ blob: Blob; kind: 'voice' | 'round'; dur: number } | null> => new Promise((res) => {
    const r = mr.current; const cur = rec;
    if (!r || !cur) { res(null); return; }
    r.onstop = () => {
      cur.stream.getTracks().forEach((t) => t.stop());
      const dur = (Date.now() - cur.started) / 1000;
      setRec(null); mr.current = null;
      if (!send || dur < 0.3) { res(null); return; }
      res({ blob: new Blob(chunks.current, { type: r.mimeType || (cur.kind === 'voice' ? 'audio/webm' : 'video/webm') }), kind: cur.kind, dur });
    };
    try { r.stop(); } catch { res(null); }
  });
  return { rec, start, stop };
}

function Chat({ handle, meta, onRemoved }: { handle: string; meta?: PubUser; onRemoved: () => void }) {
  const nav = useRouter((s) => s.navigate);
  const reduce = useReducedMotion();
  const [peer, setPeer] = React.useState<PubUser | undefined>(meta);
  const [msgs, setMsgs] = React.useState<ChatMsg[] | null>(null);
  const [typing, setTyping] = React.useState(false);
  const [text, setText] = React.useState('');
  const [reply, setReply] = React.useState<ChatMsg | null>(null);
  const [editing, setEditing] = React.useState<ChatMsg | null>(null);
  const [more, setMore] = React.useState(false);
  const [pick, setPick] = React.useState<'song' | 'playlist' | 'gif' | null>(null);
  const log = React.useRef<HTMLDivElement>(null);
  const after = React.useRef(0); const since = React.useRef(0);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const lastTyping = React.useRef(0);
  const { rec, start, stop } = useRecorder();
  const atBottom = () => { const l = log.current; return !l || l.scrollHeight - l.scrollTop - l.clientHeight < 120; };
  const toBottom = (smooth = true) => requestAnimationFrame(() => { const l = log.current; if (l) l.scrollTo({ top: l.scrollHeight, behavior: smooth && !reduce ? 'smooth' : 'auto' }); });

  const merge = React.useCallback((list: ChatMsg[], edits: ChatMsg[] = []) => {
    setMsgs((cur) => {
      const map = new Map<number, ChatMsg>((cur || []).filter((m) => !m.pending).map((m) => [m.id, m]));
      for (const m of [...list, ...edits]) map.set(m.id, m);
      const pend = (cur || []).filter((m) => m.pending);
      return [...[...map.values()].sort((a, b) => a.id - b.id), ...pend];
    });
    for (const m of list) { if (m.id > after.current) after.current = m.id; }
    for (const m of [...list, ...edits]) { const u = Number(m.updated || m.created || 0); if (u > since.current) since.current = u; }
  }, []);

  React.useEffect(() => {
    let dead = false;
    after.current = 0; since.current = 0;
    (async () => {
      try {
        const j = await api<any>(`/api/friends/chat?with=${encodeURIComponent(handle)}`);
        if (dead) return;
        setPeer(j.with); setMsgs([]); merge(j.messages || []); setTyping(!!j.typing); setMore((j.messages || []).length >= 80); toBottom(false);
      } catch (e: any) { if (!dead) { setMsgs([]); toast.error(e.message === 'not friends' ? 'Вы больше не друзья' : e.message); } }
    })();
    const poll = setInterval(async () => {
      if (document.hidden || !after.current && msgs === null) return;
      try {
        const j = await api<any>(`/api/friends/chat?with=${encodeURIComponent(handle)}&after=${after.current}&since=${since.current}`);
        if (dead) return;
        const bottom = atBottom();
        merge(j.messages || [], j.edits || []); setTyping(!!j.typing); if (j.with) setPeer(j.with);
        if (j.peer_read) setMsgs((cur) => cur && cur.map((m) => m.mine && m.id <= j.peer_read && !m.read ? { ...m, read: true } : m));
        if ((j.messages || []).length && bottom) toBottom();
      } catch {}
    }, 2500);
    return () => { dead = true; clearInterval(poll); };
  }, [handle]);

  const loadOlder = async () => {
    const first = msgs?.find((m) => !m.pending); if (!first) return;
    const l = log.current; const h = l?.scrollHeight || 0;
    try {
      const j = await api<any>(`/api/friends/chat?with=${encodeURIComponent(handle)}&before=${first.id}`);
      merge(j.messages || []); setMore(!!j.more);
      requestAnimationFrame(() => { if (l) l.scrollTop = l.scrollHeight - h; });
    } catch {}
  };

  const send = async (body: { kind: string; body?: string; payload?: any }) => {
    const tmp: ChatMsg = { id: Date.now() * 1000, mine: true, kind: body.kind, body: body.body || '', payload: body.payload || {}, created: Date.now() / 1000, reply: reply ? { id: reply.id, kind: reply.kind, body: reply.body } : null, edited: false, deleted: false, read: false, updated: 0, reacts: [], pending: true };
    setMsgs((cur) => [...(cur || []), tmp]); toBottom();
    const replyId = reply?.id; setReply(null);
    try {
      const j = await post('/api/friends/chat', { handle, ...body, ...(replyId ? { reply_to: replyId } : {}) });
      setMsgs((cur) => (cur || []).filter((m) => m.id !== tmp.id));
      if (j.message) merge([j.message]);
    } catch (e: any) { setMsgs((cur) => (cur || []).filter((m) => m.id !== tmp.id)); toast.error(e.message || 'Не отправилось'); }
  };
  const submit = async () => {
    const t = text.trim(); if (!t) return;
    setText('');
    if (editing) {
      const id = editing.id; setEditing(null);
      try { const j = await post('/api/friends/chat/edit', { id, body: t }); if (j.message) merge([], [j.message]); else setMsgs((c) => c && c.map((m) => m.id === id ? { ...m, body: t, edited: true } : m)); } catch (e: any) { toast.error(e.message); }
      return;
    }
    send({ kind: 'text', body: t });
  };
  const onType = (v: string) => {
    setText(v);
    if (Date.now() - lastTyping.current > 3000 && v) { lastTyping.current = Date.now(); post('/api/friends/typing', { handle }).catch(() => {}); }
  };
  const sendFile = async (f: File | Blob, kind: string, duration = 0) => {
    const id = toast.loading('Загрузка…');
    try {
      const up = await upload('/api/friends/chat/file', f, { 'X-Muse-Kind': kind, 'X-Muse-Duration': String(duration || 0) });
      toast.dismiss(id);
      await send({ kind, payload: { file: up.file, url: up.url, duration: up.duration || duration, ctype: up.ctype } });
    } catch (e: any) { toast.error(e.message || 'Не загрузилось', { id }); }
  };
  const pickFile = (f: File) => {
    const kind = /gif$/i.test(f.type) ? 'gif' : f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : '';
    if (!kind) { toast.error('Этот тип файла не поддерживается'); return; }
    if (kind === 'video' || kind === 'audio') {
      const el = document.createElement(kind === 'video' ? 'video' : 'audio'); el.preload = 'metadata';
      el.onloadedmetadata = () => { sendFile(f, kind, Math.round(el.duration || 0)); URL.revokeObjectURL(el.src); };
      el.onerror = () => sendFile(f, kind, 0);
      el.src = URL.createObjectURL(f);
    } else sendFile(f, kind);
  };
  const react = async (m: ChatMsg, emoji: string) => {
    try { const j = await post('/api/friends/chat/react', { id: m.id, emoji }); if (j.message) merge([], [j.message]); else if (j.reacts) setMsgs((c) => c && c.map((x) => x.id === m.id ? { ...x, reacts: j.reacts } : x)); } catch (e: any) { toast.error(e.message); }
  };
  const del = async (m: ChatMsg) => {
    try { await post('/api/friends/chat/delete', { id: m.id }); setMsgs((c) => c && c.map((x) => x.id === m.id ? { ...x, deleted: true, kind: 'deleted', body: '', payload: {} } : x)); } catch (e: any) { toast.error(e.message); }
  };
  const removeFriend = async () => { try { await post('/api/friends/remove', { handle }); toast.success('Удалён из друзей'); onRemoved(); } catch (e: any) { toast.error(e.message); } };

  return <>
    <header className="flex items-center gap-3 border-b px-3 py-2.5 md:px-5">
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => nav({ view: 'friends', handle: '' })} aria-label="Back"><ArrowLeft /></Button>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => nav({ view: 'user', handle })}>
        <Avatar user={peer || { handle }} size={36} online={peer?.online} />
        <div className="min-w-0"><div className="truncate text-sm font-semibold">{peer?.display || handle}</div>
          <div className={cn('truncate text-xs', typing || peer?.online ? 'text-emerald-500' : 'text-muted-foreground')}>{typing ? 'печатает…' : peer ? seenLabel(peer) || `@${handle}` : `@${handle}`}</div></div>
      </button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="More"><Users /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => nav({ view: 'user', handle })}><Users />Профиль</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={removeFriend}><UserMinus />Удалить из друзей</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </header>
    <div ref={log} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 scrollbar-thin md:px-6">
      {more && <div className="mb-3 flex justify-center"><Button size="sm" variant="outline" onClick={loadOlder}>Загрузить ранние</Button></div>}
      {msgs === null ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className={cn('h-10 w-1/2', i % 2 && 'ml-auto')} />)}</div>
        : msgs.length === 0 ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Напиши первым 👋</div>
        : <div className="flex flex-col gap-1.5">
          <AnimatePresence initial={false}>
            {msgs.map((m) => <motion.div key={m.id} layout={!reduce ? 'position' : false} initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: m.pending ? 0.6 : 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={cn('group flex max-w-[85%] flex-col gap-1 md:max-w-[70%]', m.mine ? 'items-end self-end' : 'items-start self-start')}>
              <Message m={m} onReply={() => setReply(m)} onEdit={() => { setEditing(m); setText(m.body); }} onDelete={() => del(m)} onReact={(e) => react(m, e)} />
            </motion.div>)}
          </AnimatePresence>
        </div>}
    </div>
    <div className="border-t p-2 md:p-3">
      <AnimatePresence>{(reply || editing) && <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="mb-2 flex items-center gap-2 rounded-md border-l-2 border-foreground bg-muted/60 px-3 py-1.5 text-xs">
        {editing ? <Pencil className="size-3.5" /> : <Reply className="size-3.5" />}<span className="min-w-0 flex-1 truncate">{editing ? 'Редактирование' : (reply!.body || KIND_LABEL[reply!.kind] || '…')}</span>
        <button type="button" onClick={() => { setReply(null); setEditing(null); if (editing) setText(''); }} aria-label="Cancel" className="tap p-1"><X className="size-4" /></button></motion.div>}</AnimatePresence>
      {rec ? <RecordingBar rec={rec} onCancel={() => stop(false)} onSend={async () => { const r = await stop(true); if (r) sendFile(r.blob, r.kind, Math.round(r.dur)); }} />
        : <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" hidden accept="image/*,video/*,audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ''; }} />
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Attach"><Paperclip /></Button></DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start">
              <DropdownMenuItem onSelect={() => fileRef.current?.click()}><ImageIcon />Фото / видео / аудио</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPick('song')}><Music2 />Трек</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPick('playlist')}><ListMusic />Плейлист</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPick('gif')}><Film />GIF</DropdownMenuItem>
              {usePlayer.getState().current && <DropdownMenuItem onSelect={() => { const c = usePlayer.getState().current!; send({ kind: 'song', payload: { id: c.id, title: c.title, thumbnail: c.thumbnail, duration: c.duration || 0 } }); }}><Play />Сейчас играет</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => start('round')}><Video />Кружок</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu>
          <Textarea value={text} rows={1} placeholder="Сообщение" onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === 'Escape') { setReply(null); setEditing(null); } }}
            className="max-h-36 min-h-9 flex-1 py-2" style={{ fieldSizing: 'content' } as any} />
          {text.trim() ? <Button size="icon" onClick={submit} aria-label="Send"><Send /></Button>
            : <Tip label="Голосовое"><Button size="icon" variant="ghost" onClick={() => start('voice')} aria-label="Record voice"><Mic /></Button></Tip>}
        </div>}
    </div>
    <SongPicker open={pick === 'song'} onClose={() => setPick(null)} onPick={(t) => { setPick(null); send({ kind: 'song', payload: { id: t.id, title: t.title, thumbnail: t.thumbnail, duration: t.duration || 0 } }); }} />
    <PlaylistPicker open={pick === 'playlist'} onClose={() => setPick(null)} onPick={(payload) => { setPick(null); send({ kind: 'playlist', payload }); }} />
    <GifPicker open={pick === 'gif'} onClose={() => setPick(null)} onPick={(g) => { setPick(null); send({ kind: 'gif', payload: { url: g.url, preview: g.preview, w: g.w, h: g.h } }); }} />
  </>;
}

function RecordingBar({ rec, onCancel, onSend }: { rec: { kind: string; started: number; stream: MediaStream }; onCancel: () => void; onSend: () => void }) {
  const [now, setNow] = React.useState(Date.now());
  const vid = React.useRef<HTMLVideoElement>(null);
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(t); }, []);
  React.useEffect(() => { if (vid.current && rec.kind === 'round') { vid.current.srcObject = rec.stream; vid.current.play().catch(() => {}); } }, [rec]);
  const s = (now - rec.started) / 1000;
  React.useEffect(() => { if (rec.kind === 'round' && s >= 60) onSend(); }, [s >= 60]);
  return <div className="flex items-center gap-3">
    {rec.kind === 'round' && <video ref={vid} muted playsInline className="size-28 rounded-full object-cover ring-2 ring-foreground -scale-x-100" />}
    <span className="flex items-center gap-2 text-sm"><Circle className="size-3 animate-pulse fill-red-500 text-red-500" />{fmt(s)}</span>
    <span className="flex-1 text-xs text-muted-foreground">{rec.kind === 'round' ? 'Запись кружка (до 60с)' : 'Запись голосового'}</span>
    <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Cancel"><Trash2 /></Button>
    <Button size="icon" onClick={onSend} aria-label="Send"><Send /></Button>
  </div>;
}

function MediaPlayerInline({ src, kind, dur }: { src: string; kind: 'voice' | 'audio' | 'round'; dur: number }) {
  const ref = React.useRef<HTMLMediaElement | null>(null);
  const [on, setOn] = React.useState(false); const [t, setT] = React.useState(0);
  const toggle = () => { const el = ref.current; if (!el) return; if (el.paused) { document.querySelectorAll<HTMLMediaElement>('[data-chatmedia]').forEach((x) => x !== el && x.pause()); el.play().catch(() => {}); } else el.pause(); };
  const common = { 'data-chatmedia': '', src, preload: 'metadata', onPlay: () => setOn(true), onPause: () => setOn(false), onEnded: () => { setOn(false); setT(0); }, onTimeUpdate: (e: any) => setT(e.currentTarget.currentTime) } as any;
  const total = dur || ref.current?.duration || 0;
  if (kind === 'round') return <button type="button" onClick={toggle} className="relative size-48 overflow-hidden rounded-full border">
    <video ref={ref as any} {...common} playsInline muted={false} className="size-full object-cover" />
    <svg className="pointer-events-none absolute inset-0 -rotate-90" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeOpacity=".9" strokeWidth="2" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - (total ? t / total : 0)} /></svg>
    {!on && <span className="absolute inset-0 flex items-center justify-center bg-black/25"><Play className="size-8 fill-white text-white" /></span>}
    <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 text-[10px] text-white">{fmt(on ? t : total)}</span>
  </button>;
  return <div className="flex w-60 items-center gap-3">
    <audio ref={ref as any} {...common} />
    <button type="button" onClick={toggle} className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background">{on ? <Pause className="size-4 fill-current" /> : <Play className="size-4 translate-x-px fill-current" />}</button>
    <div className="flex-1"><div className="flex h-6 items-center gap-[2px]">{Array.from({ length: 28 }, (_, i) => { const h = 30 + ((i * 37) % 70); const done = total ? i / 28 < t / total : false; return <span key={i} className={cn('w-[3px] rounded-full transition-colors', done ? 'bg-current' : 'bg-current/30')} style={{ height: `${h}%` }} />; })}</div>
      <div className="text-[10px] opacity-70">{fmt(on ? t : total)}</div></div>
  </div>;
}

function Message({ m, onReply, onEdit, onDelete, onReact }: { m: ChatMsg; onReply: () => void; onEdit: () => void; onDelete: () => void; onReact: (e: string) => void }) {
  const nav = useRouter((s) => s.navigate);
  const open = useUI((s) => s.open);
  const p = m.payload || {};
  const bubble = cn('rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap', m.mine ? 'bg-foreground text-background rounded-br-md' : 'bg-muted rounded-bl-md');
  let body: React.ReactNode;
  if (m.deleted || m.kind === 'deleted') body = <div className={cn(bubble, 'italic opacity-60')}>Сообщение удалено</div>;
  else if (m.kind === 'song') body = <button type="button" onClick={() => usePlayer.getState().play({ id: p.id, title: p.title, thumbnail: p.thumbnail, duration: p.duration }, null, 'chat')}
    className="flex w-64 items-center gap-3 rounded-xl border bg-card p-2 text-left text-card-foreground transition-colors hover:bg-accent"><img src={ytThumb(p.id, p.thumbnail)} alt="" className="size-12 rounded-md object-cover" /><span className="min-w-0"><span className="block truncate text-sm font-medium">{prettyTitle(p.title) || 'Song'}</span><span className="block text-xs text-muted-foreground">Нажми, чтобы слушать</span></span></button>;
  else if (m.kind === 'playlist') body = <button type="button" onClick={() => nav({ view: 'shared', handle: p.handle, slug: p.slug })}
    className="flex w-64 items-center gap-3 rounded-xl border bg-card p-2 text-left text-card-foreground transition-colors hover:bg-accent">{p.cover ? <img src={p.cover} alt="" className="size-12 rounded-md object-cover" /> : <span className="flex size-12 items-center justify-center rounded-md bg-muted font-semibold">{(p.name || '#')[0]}</span>}<span className="min-w-0"><span className="block truncate text-sm font-medium">{p.name || 'Playlist'}</span><span className="block text-xs text-muted-foreground">@{p.handle} · {p.count || 0} tracks</span></span></button>;
  else if (m.kind === 'profile') body = <button type="button" onClick={() => nav({ view: 'user', handle: p.handle })} className="flex w-56 items-center gap-3 rounded-xl border bg-card p-2 text-left text-card-foreground hover:bg-accent"><Avatar user={p.hidden ? { handle: p.handle, hue: p.hue } : p} size={40} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{p.hidden ? 'Профиль скрыт' : p.display || p.handle}</span><span className="block text-xs text-muted-foreground">@{p.handle}</span></span></button>;
  else if (m.kind === 'image' || m.kind === 'gif') body = <button type="button" onClick={() => open({ kind: 'media', type: 'image', src: fileSrc(p) })} className="overflow-hidden rounded-xl border"><img src={fileSrc(p)} alt="" className="max-h-72 max-w-64 object-cover" loading="lazy" /></button>;
  else if (m.kind === 'video') body = <button type="button" onClick={() => open({ kind: 'media', type: 'video', src: fileSrc(p) })} className="relative overflow-hidden rounded-xl border"><video src={fileSrc(p)} muted playsInline preload="metadata" className="max-h-72 max-w-64" /><span className="absolute inset-0 flex items-center justify-center bg-black/25"><Play className="size-8 fill-white text-white" /></span></button>;
  else if (m.kind === 'voice' || m.kind === 'audio') body = <div className={bubble}><MediaPlayerInline src={fileSrc(p)} kind={m.kind} dur={p.duration || 0} /></div>;
  else if (m.kind === 'round') body = <MediaPlayerInline src={fileSrc(p)} kind="round" dur={p.duration || 0} />;
  else body = <div className={cn(bubble, /^\p{Extended_Pictographic}{1,3}$/u.test(m.body.trim()) && 'bg-transparent text-4xl px-0')}>{m.body}</div>;
  return <>
    {m.reply && <div className={cn('max-w-full truncate rounded-md border-l-2 border-foreground/40 bg-muted/50 px-2 py-1 text-xs text-muted-foreground')}>{m.reply.body || KIND_LABEL[m.reply.kind || ''] || '…'}</div>}
    <div className={cn('flex items-center gap-1', m.mine && 'flex-row-reverse')}>
      {body}
      {!m.deleted && !m.pending && <div className="flex opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
        <Popover><PopoverTrigger asChild><button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="React"><Smile className="size-3.5" /></button></PopoverTrigger>
          <PopoverContent side="top" className="flex w-auto gap-1 p-1">{REACTS.map((e) => <button key={e} type="button" onClick={() => onReact(e)} className="rounded-md p-1 text-lg transition-transform hover:scale-125">{e}</button>)}</PopoverContent></Popover>
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="Actions"><Reply className="size-3.5" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align={m.mine ? 'end' : 'start'}>
            <DropdownMenuItem onSelect={onReply}><Reply />Ответить</DropdownMenuItem>
            {m.kind === 'text' && <DropdownMenuItem onSelect={() => writeClip(m.body).then(() => toast.success('Скопировано'))}><Copy />Копировать</DropdownMenuItem>}
            {m.mine && m.kind === 'text' && <DropdownMenuItem onSelect={onEdit}><Pencil />Изменить</DropdownMenuItem>}
            {m.mine && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 />Удалить</DropdownMenuItem></>}
          </DropdownMenuContent></DropdownMenu>
      </div>}
    </div>
    {m.reacts?.length > 0 && <div className="flex flex-wrap gap-1">{m.reacts.map((r) => <button key={r.emoji} type="button" onClick={() => onReact(r.emoji)} className={cn('rounded-full border px-1.5 py-0.5 text-xs transition-transform active:scale-90', r.mine && 'border-foreground/50 bg-accent')}>{r.emoji} {(r.n ?? r.count ?? 1) > 1 ? r.n ?? r.count : ''}</button>)}</div>}
    <div className="flex items-center gap-1 px-1 text-[10px] text-muted-foreground">{m.edited && 'изменено · '}{timeOf(m.created)}{m.mine && !m.pending && (m.read ? <CheckCheck className="size-3" /> : <Check className="size-3" />)}</div>
  </>;
}

function SongPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (t: Track) => void }) {
  const [q, setQ] = React.useState(''); const [hits, setHits] = React.useState<Track[]>([]);
  React.useEffect(() => { if (!q.trim()) { setHits([]); return; } const ctl = new AbortController(); const t = setTimeout(() => fetchJSON(`/api/search?q=${encodeURIComponent(q)}&n=12`, { signal: ctl.signal }, 12000).then((j) => setHits(j.results || [])).catch(() => {}), 280); return () => { clearTimeout(t); ctl.abort(); }; }, [q]);
  return <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Отправить трек">
    <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск песни" className="mt-4" />
    <div className="mt-3 max-h-80 overflow-y-auto">{hits.map((t) => <button key={t.id} type="button" onClick={() => onPick(t)} className="flex w-full items-center gap-3 rounded-md p-1.5 text-left hover:bg-accent"><img src={ytThumb(t.id, t.thumbnail)} alt="" className="size-10 rounded object-cover" /><span className="min-w-0"><span className="block truncate text-sm">{prettyTitle(t.title)}</span><span className="block truncate text-xs text-muted-foreground">{t.uploader}</span></span></button>)}</div>
  </Dialog>;
}
function PlaylistPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (p: any) => void }) {
  const pls = useSession((s) => s.playlists); const me = useSession((s) => s.me);
  return <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Отправить плейлист">
    <div className="mt-4 max-h-80 overflow-y-auto">{pls.length ? pls.map((p) => <button key={p.id} type="button" onClick={() => onPick({ id: p.id, name: p.name, handle: me?.handle, slug: p.slug, cover: p.custom_cover || p.cover, count: p.count })}
      className="flex w-full items-center gap-3 rounded-md p-1.5 text-left hover:bg-accent">{p.custom_cover || p.cover ? <img src={p.custom_cover || p.cover} alt="" className="size-10 rounded object-cover" /> : <span className="flex size-10 items-center justify-center rounded bg-muted">{p.name[0]}</span>}<span><span className="block text-sm">{p.name}</span><span className="block text-xs text-muted-foreground">{p.count} треков</span></span></button>)
      : <p className="text-sm text-muted-foreground">Сначала собери плейлист</p>}</div>
  </Dialog>;
}
function GifPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (g: any) => void }) {
  const [q, setQ] = React.useState('music'); const [gifs, setGifs] = React.useState<any[]>([]);
  React.useEffect(() => { if (!open || !q.trim()) return; const ctl = new AbortController(); const t = setTimeout(() => fetchJSON(`/api/gifs?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((j) => setGifs(j.gifs || [])).catch(() => {}), 300); return () => { clearTimeout(t); ctl.abort(); }; }, [q, open]);
  return <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="GIF" className="max-w-lg">
    <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск GIF" className="mt-4" />
    <div className="mt-3 grid max-h-96 grid-cols-3 gap-2 overflow-y-auto">{gifs.map((g, i) => <button key={i} type="button" onClick={() => onPick(g)} className="overflow-hidden rounded-md bg-muted"><img src={g.preview} alt="" className="aspect-square w-full object-cover" loading="lazy" /></button>)}</div>
  </Dialog>;
}
