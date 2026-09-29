import api from '@/lib/api';

export interface AuditEvent {
  eventId: string;
  eventType: string;
  description: string;
  timestamp: string;
  actorId: string;
  actorAddress: string;
  /** On-chain confirmation status of the event's transaction */
  status?: AuditEventStatus;
  metadata?: Record<string, unknown>;
}

export type AuditEventStatus = 'confirmed' | 'pending' | 'failed';

export interface AuditEventsQuery {
  /** Opaque cursor returned by the previous page; omit for the first page */
  cursor?: string | null;
  limit: number;
}

export interface AuditEventsPage {
  events: AuditEvent[];
  /** Cursor for the next page, or null when this is the last page */
  nextCursor: string | null;
  totalCount: number;
}

export interface AuditTimelineResponse {
  success: boolean;
  message?: string;
  data?: {
    deliveryId: string;
    events: AuditEvent[];
    totalCount: number;
  };
}

/**
 * auditService — fetches chronological audit events for deliveries and contracts.
 * Provides enterprise-grade activity tracking for fleet managers.
 */
export const auditService = {
  /**
   * Fetches audit timeline for a specific delivery.
   * @param deliveryId - The delivery ID to fetch timeline for
   */
  async getDeliveryAuditTimeline(deliveryId: string): Promise<AuditTimelineResponse> {
    try {
      const { data } = await api.get<AuditTimelineResponse>(`/api/audit/delivery/${deliveryId}`);
      return data;
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch audit timeline',
      };
    }
  },

  /**
   * Fetches audit timeline for a smart contract.
   * @param contractId - The contract ID to fetch timeline for
   */
  async getContractAuditTimeline(contractId: string): Promise<AuditTimelineResponse> {
    try {
      const { data } = await api.get<AuditTimelineResponse>(`/api/audit/contract/${contractId}`);
      return data;
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch contract timeline',
      };
    }
  },

  /**
   * Fetches one cursor-paginated page of blockchain audit events across all contracts.
   * Errors propagate so the calling hook can surface them.
   */
  async getAuditEvents({ cursor, limit }: AuditEventsQuery): Promise<AuditEventsPage> {
    const { data } = await api.get<AuditEventsPage>('/api/audit/events', {
      params: { limit, ...(cursor ? { cursor } : {}) },
    });
    return data;
  },

  /**
   * Maps event type to display icon and color.
   */
  getEventIcon(eventType: string): { icon: string; color: string } {
    const iconMap: Record<string, { icon: string; color: string }> = {
      'contract-created': { icon: '✓', color: 'bg-blue-500' },
      'driver-assigned': { icon: '👤', color: 'bg-purple-500' },
      'escrow-funded': { icon: '💰', color: 'bg-green-500' },
      'in-transit': { icon: '🚗', color: 'bg-yellow-500' },
      'delivered': { icon: '✓', color: 'bg-green-600' },
      'dispute-raised': { icon: '⚠️', color: 'bg-red-500' },
      'dispute-resolved': { icon: '✓', color: 'bg-green-500' },
      'escrow-released': { icon: '💵', color: 'bg-emerald-500' },
    };

    return iconMap[eventType] ?? { icon: '•', color: 'bg-gray-500' };
  },
};
