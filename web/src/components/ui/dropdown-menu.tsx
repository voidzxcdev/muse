import * as React from 'react';
import * as M from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export const DropdownMenuSub = M.Sub;
const content = 'z-50 min-w-[12rem] overflow-hidden rounded-2xl bg-surface-high p-1.5 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 duration-150';
export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof M.Content>) {
  return <M.Portal><M.Content sideOffset={sideOffset} className={cn(content, className)} {...props} /></M.Portal>;
}
export function DropdownMenuItem({ className, inset, variant, ...props }: React.ComponentProps<typeof M.Item> & { inset?: boolean; variant?: 'destructive' }) {
  return <M.Item className={cn("relative flex cursor-default select-none items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none transition-colors focus:bg-surface-highest focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground",
    inset && 'pl-8', variant === 'destructive' && 'text-destructive focus:text-destructive [&_svg]:!text-destructive', className)} {...props} />;
}
export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof M.Label>) {
  return <M.Label className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)} {...props} />;
}
export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof M.Separator>) {
  return <M.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}
export function DropdownMenuSubTrigger({ className, ...props }: React.ComponentProps<typeof M.SubTrigger>) {
  return <M.SubTrigger className={cn('flex cursor-default select-none items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none focus:bg-surface-highest data-[state=open]:bg-surface-highest [&_svg]:size-4 [&_svg]:text-muted-foreground', className)} {...props} />;
}
export function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof M.SubContent>) {
  return <M.Portal><M.SubContent className={cn(content, 'max-h-72 overflow-y-auto', className)} {...props} /></M.Portal>;
}
