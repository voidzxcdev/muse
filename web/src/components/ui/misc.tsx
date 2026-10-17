import * as React from 'react';
import * as S from '@radix-ui/react-switch';
import * as T from '@radix-ui/react-tooltip';
import * as Tabs from '@radix-ui/react-tabs';
import * as P from '@radix-ui/react-popover';
import { cn, avatarBG } from '@/lib/utils';

export function Switch({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return <S.Root className={cn('peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input disabled:opacity-50', className)} {...props}>
    <S.Thumb className="pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0 dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground" />
  </S.Root>;
}

export const TooltipProvider = T.Provider;
export function Tip({ label, children, side = 'top' }: { label: React.ReactNode; children: React.ReactElement; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return <T.Root delayDuration={350}>
    <T.Trigger asChild>{children}</T.Trigger>
    <T.Portal><T.Content side={side} sideOffset={6} className="z-[60] rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 duration-100">{label}</T.Content></T.Portal>
  </T.Root>;
}

export const TabsRoot = Tabs.Root;
export function TabsList({ className, ...p }: React.ComponentProps<typeof Tabs.List>) {
  return <Tabs.List className={cn('inline-flex h-9 items-center rounded-lg bg-muted p-[3px] text-muted-foreground', className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof Tabs.Trigger>) {
  return <Tabs.Trigger className={cn('inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors outline-none data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-input/40 focus-visible:ring-[3px] focus-visible:ring-ring/50', className)} {...p} />;
}
export const TabsContent = Tabs.Content;

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export function PopoverContent({ className, sideOffset = 8, ...p }: React.ComponentProps<typeof P.Content>) {
  return <P.Portal><P.Content sideOffset={sideOffset} className={cn('z-50 w-72 rounded-2xl bg-surface-high p-3 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 duration-150', className)} {...p} /></P.Portal>;
}

export function Skeleton({ className, ...p }: React.ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...p} />;
}

export function Badge({ className, variant = 'default', ...p }: React.ComponentProps<'span'> & { variant?: 'default' | 'secondary' | 'outline' }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
    variant === 'default' && 'bg-primary text-primary-foreground', variant === 'secondary' && 'bg-secondary text-secondary-foreground',
    variant === 'outline' && 'border text-muted-foreground', className)} {...p} />;
}

export function Avatar({ user, size = 32, className, online }: { user?: { display?: string; handle?: string; avatar?: string; hue?: number } | null; size?: number; className?: string; online?: boolean }) {
  const letter = ((user?.display || user?.handle || '?')[0] || '?').toUpperCase();
  return <span className={cn('relative inline-flex shrink-0 rounded-full', className)} style={{ width: size, height: size }}>
    {user?.avatar
      ? <img src={user.avatar} alt="" className="size-full rounded-full object-cover bg-muted" draggable={false} />
      : <span className="flex size-full items-center justify-center rounded-full font-semibold text-white" style={{ background: avatarBG(user?.hue), fontSize: size * 0.42 }}>{letter}</span>}
    {online && <span className="absolute bottom-0 right-0 size-[28%] min-w-2 min-h-2 rounded-full bg-emerald-500 ring-2 ring-background" />}
  </span>;
}

export function Kbd({ className, ...p }: React.ComponentProps<'kbd'>) {
  return <kbd className={cn('pointer-events-none inline-flex h-5 select-none items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground', className)} {...p} />;
}
