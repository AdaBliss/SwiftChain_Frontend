/**
 * DriverAssignmentPanel Component
 * Assigns pending shipments to available drivers, with capacity /
 * load-balancing awareness: a load badge and color-coding per driver,
 * a confirmation modal when assigning to a near-capacity driver, and a
 * vehicle-type match indicator per shipment/driver pairing.
 *
 * dnd-kit is not a dependency of this repo, so this panel uses a
 * click-to-assign flow (select a shipment, then click "Assign" on a
 * driver) instead of literal drag-and-drop.
 */

'use client';

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useDriverAssignment } from '@/hooks/useDriverAssignment';
import type { Driver, PendingShipment } from '@/types/fleet';

/**
 * Load-level color thresholds, as a fraction of capacity:
 *   - green:  load / capacity < 0.75  (comfortably under capacity)
 *   - yellow: 0.75 <= load / capacity < 1  (near capacity)
 *   - red:    load / capacity >= 1  (at or over capacity)
 */
const NEAR_CAPACITY_THRESHOLD = 0.75;

const SORT_ORDER_STORAGE_KEY = 'swiftchain:driver-assignment-sort-order';

type SortOrder = 'availability' | 'capacity';

function readStoredSortOrder(): SortOrder {
  if (typeof window === 'undefined') return 'availability';
  try {
    const stored = window.localStorage.getItem(SORT_ORDER_STORAGE_KEY);
    return stored === 'capacity' ? 'capacity' : 'availability';
  } catch {
    return 'availability';
  }
}

function persistSortOrder(order: SortOrder): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SORT_ORDER_STORAGE_KEY, order);
  } catch {
    // localStorage may be unavailable (private browsing, quota); the
    // sort order simply won't persist across sessions in that case.
  }
}

function loadRatio(driver: Driver): number {
  if (!driver.capacity || driver.capacity <= 0) return 0;
  return (driver.currentLoad ?? 0) / driver.capacity;
}

function loadLevel(driver: Driver): 'green' | 'yellow' | 'red' {
  const ratio = loadRatio(driver);
  if (ratio >= 1) return 'red';
  if (ratio >= NEAR_CAPACITY_THRESHOLD) return 'yellow';
  return 'green';
}

const LOAD_BADGE_CLASSES: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-emerald-100 text-emerald-700',
  yellow: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
};

function isAvailable(driver: Driver): boolean {
  return driver.status === 'active' || driver.status === 'idle';
}

function vehicleMatches(shipment: PendingShipment, driver: Driver): boolean | null {
  if (!shipment.requiredVehicleType) return null;
  return shipment.requiredVehicleType === driver.vehicleType;
}

function sortDrivers(drivers: Driver[], order: SortOrder): Driver[] {
  return [...drivers].sort((a, b) => {
    const availabilityDelta = Number(isAvailable(b)) - Number(isAvailable(a));
    if (availabilityDelta !== 0) return availabilityDelta;

    if (order === 'capacity') {
      return loadRatio(a) - loadRatio(b);
    }
    // 'availability' order: after availability, fall back to load ratio
    // as a secondary tiebreaker so equally-available drivers are still
    // ordered sensibly.
    return loadRatio(a) - loadRatio(b);
  });
}

interface DriverAssignmentPanelProps {
  className?: string;
}

export function DriverAssignmentPanel({
  className = '',
}: DriverAssignmentPanelProps): React.ReactElement {
  const {
    shipments,
    drivers,
    isLoading,
    isError,
    error,
    assignShipment,
    isAssigning,
  } = useDriverAssignment();

  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(readStoredSortOrder);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    driver: Driver;
    shipment: PendingShipment;
  } | null>(null);

  const handleSortOrderChange = (order: SortOrder) => {
    setSortOrder(order);
    persistSortOrder(order);
  };

  const sortedDrivers = useMemo(() => sortDrivers(drivers, sortOrder), [drivers, sortOrder]);

  const selectedShipment = useMemo(
    () => shipments.find((s) => s.id === selectedShipmentId) ?? null,
    [shipments, selectedShipmentId]
  );

  const performAssign = async (driver: Driver, shipment: PendingShipment) => {
    const success = await assignShipment(driver.id, shipment.id);
    if (success) {
      toast.success(`${shipment.id} assigned to ${driver.name}`);
      setSelectedShipmentId(null);
    } else {
      toast.error(`Failed to assign ${shipment.id} to ${driver.name}`);
    }
  };

  const handleAssignClick = (driver: Driver) => {
    if (!selectedShipment) return;

    if (loadLevel(driver) !== 'green') {
      setPendingConfirmation({ driver, shipment: selectedShipment });
      return;
    }

    void performAssign(driver, selectedShipment);
  };

  const handleConfirmAssign = () => {
    if (!pendingConfirmation) return;
    const { driver, shipment } = pendingConfirmation;
    setPendingConfirmation(null);
    void performAssign(driver, shipment);
  };

  const handleCancelConfirm = () => {
    setPendingConfirmation(null);
  };

  if (isLoading) {
    return (
      <div className={`rounded-md border border-gray-200 bg-white p-6 text-center text-sm text-gray-500 ${className}`}>
        Loading assignment data...
      </div>
    );
  }

  if (isError) {
    return (
      <div className={`rounded-md border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700 ${className}`}>
        {error || 'Failed to load assignment data.'}
      </div>
    );
  }

  return (
    <section
      aria-label="Driver assignment panel"
      className={`rounded-md border border-gray-200 bg-white ${className}`}
    >
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
        {/* Pending shipments */}
        <div>
          <div className="flex items-center justify-between border-b border-gray-200 pb-2">
            <h2 className="text-base font-semibold text-gray-900">Pending Shipments</h2>
          </div>

          {shipments.length === 0 ? (
            <p
              role="status"
              className="py-6 text-center text-sm text-gray-500"
            >
              No pending shipments.
            </p>
          ) : (
            <ul role="list" className="divide-y divide-gray-100">
              {shipments.map((shipment) => (
                <li key={shipment.id}>
                  <button
                    type="button"
                    aria-pressed={selectedShipmentId === shipment.id}
                    onClick={() =>
                      setSelectedShipmentId((current) =>
                        current === shipment.id ? null : shipment.id
                      )
                    }
                    className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                      selectedShipmentId === shipment.id
                        ? 'bg-sky-50 ring-1 ring-sky-400'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <span className="font-medium text-gray-900">{shipment.id}</span>
                    <span className="block text-xs text-gray-500">
                      {shipment.origin} → {shipment.destination}
                      {shipment.requiredVehicleType
                        ? ` · needs ${shipment.requiredVehicleType}`
                        : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Drivers */}
        <div>
          <div className="flex items-center justify-between border-b border-gray-200 pb-2">
            <h2 className="text-base font-semibold text-gray-900">Drivers</h2>
            <label className="text-xs text-gray-500">
              Sort by{' '}
              <select
                aria-label="Sort drivers by"
                value={sortOrder}
                onChange={(e) => handleSortOrderChange(e.target.value as SortOrder)}
                className="ml-1 rounded border border-gray-200 text-xs"
              >
                <option value="availability">Availability</option>
                <option value="capacity">Capacity</option>
              </select>
            </label>
          </div>

          {sortedDrivers.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              No drivers in your fleet yet.
            </p>
          ) : (
            <ul role="list" className="divide-y divide-gray-100">
              {sortedDrivers.map((driver) => {
                const level = loadLevel(driver);
                const match = selectedShipment
                  ? vehicleMatches(selectedShipment, driver)
                  : null;

                return (
                  <li
                    key={driver.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-gray-900">{driver.name}</span>
                      <span className="text-xs text-gray-500">{driver.vehicleType}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      {match !== null && (
                        <span
                          data-testid={`vehicle-match-${driver.id}`}
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            match
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-gray-200 text-gray-600'
                          }`}
                        >
                          {match ? 'Vehicle match' : 'Vehicle mismatch'}
                        </span>
                      )}

                      <span
                        data-testid={`driver-load-${driver.id}`}
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${LOAD_BADGE_CLASSES[level]}`}
                      >
                        {driver.currentLoad ?? 0}/{driver.capacity ?? 0} deliveries
                      </span>

                      <button
                        type="button"
                        disabled={!selectedShipment || isAssigning}
                        onClick={() => handleAssignClick(driver)}
                        className="rounded-md bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-40"
                      >
                        Assign
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {pendingConfirmation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm near-capacity assignment"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
            <h3 className="text-sm font-semibold text-gray-900">
              Assign to a near-capacity driver?
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              {pendingConfirmation.driver.name} is at{' '}
              {pendingConfirmation.driver.currentLoad ?? 0}/
              {pendingConfirmation.driver.capacity ?? 0} deliveries. Assigning{' '}
              {pendingConfirmation.shipment.id} may push them over capacity.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelConfirm}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmAssign}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
              >
                Assign Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default DriverAssignmentPanel;
