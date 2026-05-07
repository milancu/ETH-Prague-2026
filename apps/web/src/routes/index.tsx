import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/utils/api-client"

export const Route = createFileRoute("/")({
  component: Index,
})

function Index() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await apiClient.get<{ status: string }>("/health")
      return res.data
    },
  })

  return (
    <div className="flex min-h-svh p-6">
      <div className="flex max-w-md min-w-0 flex-col gap-4 text-sm leading-loose">
        <p>
          Backend:{" "}
          {isLoading && <span className="text-muted-foreground">checking…</span>}
          {isError && <span className="text-destructive">unreachable</span>}
          {data && <span className="text-green-600">{data.status}</span>}
        </p>
      </div>
    </div>
  )
}
