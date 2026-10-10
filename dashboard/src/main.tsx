import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ApiError, session } from '@/lib/api'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from './context/theme-provider'
import { routeTree } from './routeTree.gen'
import './styles/index.css'

function onError(error: Error) {
  if (error instanceof ApiError && error.status === 401) {
    session.clear()
    router.navigate({ to: '/login' })
    return
  }
  toast(error.message)
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 10 * 1000 } },
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
})

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
)
