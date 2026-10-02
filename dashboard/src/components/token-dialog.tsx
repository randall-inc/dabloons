import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

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
        <div className='flex gap-2'>
          <Input readOnly value={token ?? ''} className='font-mono' />
          <Button onClick={copy}>Copy</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
