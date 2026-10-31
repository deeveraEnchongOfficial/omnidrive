import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function DummyModal({ open, title, description, children, onClose, className }: { open: boolean; title: string; description: string; children: ReactNode; onClose: () => void; className?: string }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm" aria-label="Close modal" onClick={onClose} />
      <div className={cn('relative max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-t-3xl border border-border bg-card dark:bg-zinc-900 dark:border-zinc-800 p-5 shadow-2xl shadow-zinc-950/20 sm:max-w-md sm:rounded-xl', className)}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <Button variant="outline" size="icon" aria-label="Close modal" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  )
}
