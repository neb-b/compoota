import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { useMemo } from 'react'

export function AppQueryProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
    [],
  )

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
