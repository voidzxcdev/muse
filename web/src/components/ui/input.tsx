import * as React from 'react';
import { cn } from '@/lib/utils';
export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return <input type={type} data-slot="input" className={cn(
    'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow,border-color] outline-none disabled:pointer-events-none disabled:opacity-50 md:text-sm',
    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]', 'aria-invalid:border-destructive', className)} {...props} />;
}
export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn('placeholder:text-muted-foreground dark:bg-input/30 border-input flex min-h-9 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm resize-none', className)} {...props} />;
}
export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium leading-none select-none', className)} {...props} />;
}
