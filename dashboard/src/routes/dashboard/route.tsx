import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
} from '@tanstack/react-router'
import { session } from '@/lib/api'
import { PURCHASES_ENABLED } from '../../../../shared/pricing'
import { Logo } from '@/components/logo'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'

export const Route = createFileRoute('/dashboard')({
  beforeLoad: ({ location }) => {
    if (!session.get()) throw redirect({ to: '/login', search: { redirect: location.href } })
  },
  component: DashboardLayout,
})

const nav = [
  { title: 'Overview', to: '/dashboard' },
  { title: 'Agents', to: '/dashboard/agents' },
  { title: 'Bounties', to: '/dashboard/bounties' },
  { title: 'Activity', to: '/dashboard/activity' },
  { title: 'Projects', to: '/dashboard/projects' },
  ...(PURCHASES_ENABLED ? [{ title: 'Billing', to: '/dashboard/billing' } as const] : []),
  { title: 'Settings', to: '/dashboard/settings' },
] as const

function DashboardLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className='flex h-14 items-center px-4'>
          <SidebarTrigger />
        </header>
        <main className='mx-auto grid w-full max-w-5xl gap-8 px-6 pb-12'>
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function AppSidebar() {
  const pathname = useLocation({ select: (l) => l.pathname })
  const { setOpenMobile } = useSidebar()
  const isActive = (to: string) =>
    to === '/dashboard' ? pathname === to : pathname.startsWith(to)
  return (
    <Sidebar>
      <SidebarHeader className='px-4 py-3'>
        <Logo to='/dashboard' />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {nav.map((item) => (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton asChild isActive={isActive(item.to)}>
                  <Link to={item.to} onClick={() => setOpenMobile(false)}>
                    {item.title}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
