import * as React from 'react';
import * as D from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/* shadcn Dialog with Motion enter/exit (spring scale + fade; reduced motion → fade only).
   `side="bottom"` renders as a mobile sheet that slides up. */
export function Dialog({ open, onOpenChange, children, className, side = 'center', title, description, hideClose }: {
  open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode; className?: string;
  side?: 'center' | 'bottom' | 'full'; title?: string; description?: string; hideClose?: boolean;
}) {
  const reduce = useReducedMotion();
  const drag = useDragControls();
  const panel = side === 'bottom'
    ? { initial: { y: reduce ? 0 : '100%', opacity: reduce ? 0 : 1 }, animate: { y: 0, opacity: 1 }, exit: { y: reduce ? 0 : '100%', opacity: reduce ? 0 : 1 } }
    : side === 'full'
      ? { initial: { opacity: 0, y: reduce ? 0 : 24 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: reduce ? 0 : 24 } }
      : { initial: { opacity: 0, scale: reduce ? 1 : 0.96 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: reduce ? 1 : 0.98 } };
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <D.Portal forceMount>
            <D.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
            </D.Overlay>
            <D.Content asChild forceMount aria-describedby={description ? undefined : undefined}>
              <motion.div {...panel}
                {...(side === 'bottom' ? { drag: 'y' as const, dragListener: false, dragControls: drag, dragConstraints: { top: 0, bottom: 0 }, dragElastic: { top: 0, bottom: 0.7 },
                  onDragEnd: (_: any, i: any) => { if (i.offset.y > 110 || i.velocity.y > 600) onOpenChange(false); } } : {})}
                transition={reduce ? { duration: 0.12 } : { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }}
                className={cn('fixed z-50 bg-background text-foreground border shadow-xl outline-none',
                  side === 'center' && 'left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-md rounded-xl p-6 max-h-[85dvh] overflow-y-auto scrollbar-thin',
                  side === 'bottom' && 'inset-x-0 bottom-0 rounded-t-2xl p-5 pt-0 pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] max-h-[90dvh] overflow-y-auto overscroll-contain',
                  side === 'full' && 'inset-0 border-0',
                  className)}
                style={side === 'center' ? { x: '-50%', y: '-50%' } : undefined}>
                {side === 'bottom' && <div onPointerDown={(e) => drag.start(e)} className="sticky top-0 z-10 -mx-5 mb-1 flex cursor-grab touch-none justify-center bg-background pb-2 pt-3 active:cursor-grabbing" aria-hidden><div className="h-1 w-10 rounded-full bg-muted-foreground/30" /></div>}
                {title ? <D.Title className="text-lg font-semibold tracking-tight">{title}</D.Title> : <D.Title className="sr-only">Dialog</D.Title>}
                {description ? <D.Description className="text-sm text-muted-foreground mt-1">{description}</D.Description> : <D.Description className="sr-only">Dialog</D.Description>}
                {children}
                {!hideClose && (
                  <D.Close className="tap absolute right-3 top-3 z-20 rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none" aria-label="Close">
                    <X className="size-4" />
                  </D.Close>
                )}
              </motion.div>
            </D.Content>
          </D.Portal>
        )}
      </AnimatePresence>
    </D.Root>
  );
}
