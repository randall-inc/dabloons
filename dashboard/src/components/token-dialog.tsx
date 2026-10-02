import { toast } from '@/components/ui/8bit/toast'
import { Button } from '@/components/ui/8bit/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/8bit/dialog'
import { Input } from '@/components/ui/8bit/input'

/** Shows a freshly issued agent API token. The server never shows it again. */
export function TokenDialog({
  token,
  onClose,
}: {
  token: string | null
  onClose: () => void
}) {
  const copy = async () => {
    await navigator.clipboard.writeText(token ?? '')
    toast('Copied')
  }
  return (
    <Dialog open={token !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Save this token</DialogTitle>
        </DialogHeader>
        <div className='flex items-center gap-4'>
          <Input readOnly value={token ?? ''} className='flex-1 font-mono' />
          <Button onClick={copy}>Copy</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
