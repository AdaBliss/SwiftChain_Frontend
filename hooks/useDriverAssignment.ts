/**
 * useDriverAssignment Hook
 * Manages fetching pending shipments and available drivers, and
 * assigning shipments to drivers (single or bulk).
 */

'use client';

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { driverAssignmentService } from '@/services/driverAssignmentService';
import type { AssignmentResult, Driver, PendingShipment } from '@/types/fleet';

export const pendingShipmentsQueryKey = ['fleet', 'shipments', 'pending'] as const;
export const availableDriversQueryKey = ['fleet', 'drivers', 'available'] as const;

interface UseDriverAssignmentReturn {
  shipments: PendingShipment[];
  drivers: Driver[];
  isLoading: boolean;
  isError: boolean;
  error: string | null;
  /** Assign a single shipment to a driver. Resolves to a success flag. */
  assignShipment: (driverId: string, shipmentId: string) => Promise<boolean>;
  isAssigning: boolean;
  /** Assign multiple shipments; failures don't block other assignments. */
  assignBulk: (
    assignments: { driverId: string; shipmentId: string }[]
  ) => Promise<AssignmentResult[]>;
  isBulkAssigning: boolean;
  refetch: () => Promise<void>;
}

/**
 * Hook for managing shipment-to-driver assignment.
 *
 * Strict layered architecture:
 *   Component (DriverAssignmentPanel) -> Hook (useDriverAssignment) ->
 *   Service (driverAssignmentService)
 *
 * Bulk assignment uses Promise.allSettled (not Promise.all / sequential)
 * so that one failing assignment never blocks the rest of the batch —
 * the caller gets a per-item success/failure report back instead of a
 * single rejection that discards the outcome of the assignments that
 * did succeed.
 */
export function useDriverAssignment(): UseDriverAssignmentReturn {
  const queryClient = useQueryClient();
  const [bulkError, setBulkError] = useState<string | null>(null);

  const shipmentsQuery = useQuery({
    queryKey: pendingShipmentsQueryKey,
    queryFn: ({ signal }) => driverAssignmentService.getPendingShipments(signal),
    staleTime: 10000,
    retry: 1,
  });

  const driversQuery = useQuery({
    queryKey: availableDriversQueryKey,
    queryFn: ({ signal }) => driverAssignmentService.getAvailableDrivers(signal),
    staleTime: 10000,
    retry: 1,
  });

  const invalidateAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: pendingShipmentsQueryKey }),
      queryClient.invalidateQueries({ queryKey: availableDriversQueryKey }),
    ]);
  }, [queryClient]);

  const assignMutation = useMutation({
    mutationFn: ({ driverId, shipmentId }: { driverId: string; shipmentId: string }) =>
      driverAssignmentService.assignShipment(driverId, shipmentId),
    onSuccess: () => {
      void invalidateAll();
    },
  });

  const assignShipment = useCallback(
    async (driverId: string, shipmentId: string): Promise<boolean> => {
      try {
        const response = await assignMutation.mutateAsync({ driverId, shipmentId });
        return response.success;
      } catch {
        return false;
      }
    },
    [assignMutation]
  );

  const [isBulkAssigning, setIsBulkAssigning] = useState(false);

  const assignBulk = useCallback(
    async (
      assignments: { driverId: string; shipmentId: string }[]
    ): Promise<AssignmentResult[]> => {
      setIsBulkAssigning(true);
      setBulkError(null);

      try {
        const settled = await Promise.allSettled(
          assignments.map(({ driverId, shipmentId }) =>
            driverAssignmentService
              .assignShipment(driverId, shipmentId)
              .then((response) => ({ driverId, shipmentId, response }))
          )
        );

        const results: AssignmentResult[] = settled.map((outcome, index) => {
          const { driverId, shipmentId } = assignments[index];
          if (outcome.status === 'fulfilled') {
            return {
              driverId,
              shipmentId,
              success: outcome.value.response.success,
              error: outcome.value.response.success
                ? undefined
                : outcome.value.response.message,
            };
          }
          const reason = outcome.reason;
          const message =
            reason instanceof Error ? reason.message : 'Failed to assign shipment';
          return { driverId, shipmentId, success: false, error: message };
        });

        const anyFailed = results.some((r) => !r.success);
        if (anyFailed) {
          setBulkError('One or more assignments failed. See results for details.');
        }

        await invalidateAll();
        return results;
      } finally {
        setIsBulkAssigning(false);
      }
    },
    [invalidateAll]
  );

  const refetch = useCallback(async () => {
    await invalidateAll();
  }, [invalidateAll]);

  const queryError =
    (shipmentsQuery.error instanceof Error ? shipmentsQuery.error.message : null) ||
    (driversQuery.error instanceof Error ? driversQuery.error.message : null);

  const assignErrorMessage =
    assignMutation.error instanceof Error ? assignMutation.error.message : null;

  const combinedError = queryError || assignErrorMessage || bulkError;

  return {
    shipments: shipmentsQuery.data ?? [],
    drivers: driversQuery.data ?? [],
    isLoading: shipmentsQuery.isLoading || driversQuery.isLoading,
    isError: shipmentsQuery.isError || driversQuery.isError || Boolean(combinedError),
    error: combinedError,
    assignShipment,
    isAssigning: assignMutation.isPending,
    assignBulk,
    isBulkAssigning,
    refetch,
  };
}
