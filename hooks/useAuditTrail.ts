'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { auditTrailService } from '@/services/auditTrailService';
import type { AuditTrailEvent, AuditTrailSortOrder } from '@/types/auditTrail';

const COPIED_RESET_MS = 2000;

export const auditTrailKeys = {
  delivery: (deliveryId: string) => ['auditTrail', deliveryId] as const,
};

export interface UseAuditTrailResult {
  /** Events ordered by {@link sortOrder}. */
  events: AuditTrailEvent[];
  sortOrder: AuditTrailSortOrder;
  setSortOrder: (_order: AuditTrailSortOrder) => void;
  toggleSortOrder: () => void;
  isLoading: boolean;
  isRefetching: boolean;
  error: string | null;
  retry: () => void;
  /** Event ID most recently copied, cleared after a short delay. */
  copiedEventId: string | null;
  copyEventId: (_eventId: string) => Promise<void>;
}

/** Unparseable timestamps sort after every valid event in both directions. */
function timeOf(event: AuditTrailEvent): number | null {
  const ms = Date.parse(event.timestamp);
  return Number.isNaN(ms) ? null : ms;
}

export function sortAuditEvents(
  events: AuditTrailEvent[],
  order: AuditTrailSortOrder,
): AuditTrailEvent[] {
  return [...events].sort((a, b) => {
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (ta === null || tb === null) return ta === tb ? 0 : ta === null ? 1 : -1;
    return order === 'newest' ? tb - ta : ta - tb;
  });
}

/**
 * useAuditTrail — immutable blockchain events for a delivery, in chronological order.
 *
 * Follows the Component → Hook → Service pattern:
 *   AuditTrailList → useAuditTrail → auditTrailService → /api/audit/delivery/{id}/events
 */
export function useAuditTrail(deliveryId: string | null): UseAuditTrailResult {
  const [sortOrder, setSortOrder] = useState<AuditTrailSortOrder>('newest');
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useQuery({
    queryKey: auditTrailKeys.delivery(deliveryId ?? ''),
    queryFn: ({ signal }) => auditTrailService.getDeliveryEvents(deliveryId as string, signal),
    enabled: !!deliveryId,
  });

  const events = useMemo(
    () => sortAuditEvents(query.data ?? [], sortOrder),
    [query.data, sortOrder],
  );

  const toggleSortOrder = useCallback(() => {
    setSortOrder((order) => (order === 'newest' ? 'oldest' : 'newest'));
  }, []);

  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const copyEventId = useCallback(async (eventId: string) => {
    try {
      await navigator.clipboard.writeText(eventId);
    } catch {
      toast.error('Could not copy the event ID');
      return;
    }
    setCopiedEventId(eventId);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopiedEventId(null), COPIED_RESET_MS);
  }, []);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  return {
    events,
    sortOrder,
    setSortOrder,
    toggleSortOrder,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error ? query.error.message : null,
    retry,
    copiedEventId,
    copyEventId,
  };
}
