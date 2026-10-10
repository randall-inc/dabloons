import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { type Project, api, useProjects } from '@/lib/api'
import { formatNumber } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type Column, DataTable, column } from '@/components/data-table'

const projectColumns: Column<Project>[] = [
  column('repo', 'Repo', (p) => p.repo),
  column('balance', 'Allowance', (p) => p.balance, {
    render: (p) => formatNumber(p.balance),
    align: 'right',
  }),
]

export const Route = createFileRoute('/dashboard/projects')({
  component: Projects,
})

function Projects() {
  const { data: projects } = useProjects()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [repo, setRepo] = useState('')

  const claim = useMutation({
    mutationFn: () => api('/humans/projects', { repo: repo.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setOpen(false)
      setRepo('')
    },
  })

  const verified = projects?.filter((p) => p.verified) ?? []
  const pending = projects?.filter((p) => !p.verified) ?? []

  return (
    <>
      <div className='flex items-center justify-between gap-4'>
        <h1>Projects</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Add project</Button>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>Add project</DialogTitle>
            </DialogHeader>
            <form
              className='grid gap-4'
              onSubmit={(e) => {
                e.preventDefault()
                claim.mutate()
              }}
            >
              <div className='grid gap-2'>
                <Label htmlFor='repo'>GitHub repo</Label>
                <Input
                  id='repo'
                  required
                  placeholder='owner/name'
                  autoComplete='off'
                  spellCheck={false}
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                />
              </div>
              <Button type='submit' disabled={claim.isPending}>
                Add
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {projects && (
        <DataTable
          columns={projectColumns}
          data={verified}
          getRowId={(p) => String(p.id)}
          emptyMessage='No verified projects'
        />
      )}

      {pending.map((p) => (
        <PendingProject key={p.id} project={p} />
      ))}
    </>
  )
}

function PendingProject({ project }: { project: Project }) {
  const queryClient = useQueryClient()
  const verify = useMutation({
    mutationFn: () => api(`/humans/projects/${project.id}/verify`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      toast('Verified')
    },
  })
  const code = project.verify_code ?? ''
  return (
    <section className='grid max-w-xl gap-2'>
      <h2>{project.repo}</h2>
      <p>
        Add a file named <code>.dabloons</code> to the root of the default
        branch containing this code, then verify.
      </p>
      <div className='flex items-center gap-4'>
        <Input readOnly value={code} aria-label='Verify code' className='flex-1' />
        <Button
          variant='outline'
          onClick={async () => {
            await navigator.clipboard.writeText(code)
            toast('Copied')
          }}
        >
          Copy
        </Button>
        <Button onClick={() => verify.mutate()} disabled={verify.isPending}>
          Verify
        </Button>
      </div>
    </section>
  )
}
