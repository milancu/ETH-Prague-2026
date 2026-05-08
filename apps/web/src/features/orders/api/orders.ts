import { apiClient } from "@/utils/api-client";
import type {
  CreateOrderPayload,
  Order,
  OrderFilters,
} from "@/features/orders/types";

function toParams(filters?: OrderFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (filters?.marketId !== undefined)
    p.set("market_id", String(filters.marketId));
  if (filters?.maker) p.set("maker", filters.maker);
  return p;
}

export async function fetchOrders(filters?: OrderFilters): Promise<Order[]> {
  const { data } = await apiClient.get<Order[]>("/orders", {
    params: toParams(filters),
  });
  return data;
}

export async function fetchOrder(id: string): Promise<Order> {
  const { data } = await apiClient.get<Order>(`/orders/${id}`);
  return data;
}

export async function postOrder(payload: CreateOrderPayload): Promise<Order> {
  const { data } = await apiClient.post<Order>("/orders", payload);
  return data;
}

export async function deleteOrder(id: string): Promise<void> {
  await apiClient.delete(`/orders/${id}`);
}
