import axios from 'axios';
import type { Driver, PendingShipment } from '@/types/fleet';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export interface AssignShipmentResponse {
  success: boolean;
  message?: string;
}

/**
 * driverAssignmentService — all shipment-to-driver assignment API
 * communication (Strict Layered Architecture: Component -> Hook ->
 * Service). Hooks call this; components never call it directly.
 */
export const driverAssignmentService = {
  async getPendingShipments(signal?: AbortSignal): Promise<PendingShipment[]> {
    const { data } = await axios.get<PendingShipment[]>(
      `${API_BASE_URL}/api/fleet/shipments/pending`,
      { signal },
    );
    return data;
  },

  async getAvailableDrivers(signal?: AbortSignal): Promise<Driver[]> {
    const { data } = await axios.get<Driver[]>(
      `${API_BASE_URL}/api/fleet/drivers`,
      { signal },
    );
    return data;
  },

  async assignShipment(
    driverId: string,
    shipmentId: string,
  ): Promise<AssignShipmentResponse> {
    const { data } = await axios.post<AssignShipmentResponse>(
      `${API_BASE_URL}/api/fleet/shipments/${shipmentId}/assign`,
      { driverId },
    );
    return data;
  },
};
