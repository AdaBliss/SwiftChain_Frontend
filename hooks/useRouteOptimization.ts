/**
 * useRouteOptimization Hook
 * Reorders a list of waypoints into a shorter route using a
 * nearest-neighbor heuristic, and exposes the resulting distance/time
 * estimates plus a manual reorder function.
 */

'use client';

import { useCallback, useMemo, useState } from 'react';
import { calculateDistanceKm } from '@/services/geofenceService';
import type { OptimizerWaypoint } from '@/types/routeOptimizer';

/** Average assumed travel speed used to derive an ETA from distance. */
const AVERAGE_SPEED_KMH = 40;

interface UseRouteOptimizationReturn {
  /** Waypoints in their original (unoptimized) order, as provided. */
  waypoints: OptimizerWaypoint[];
  /** Waypoints reordered by the nearest-neighbor heuristic. */
  optimizedRoute: OptimizerWaypoint[];
  /** Total distance of the optimized route, in kilometers. */
  totalDistance: number;
  /** Estimated travel time for the optimized route, in minutes. */
  estimatedTime: number;
  /** Move a waypoint in the optimized route from one index to another. */
  reorder: (fromIndex: number, toIndex: number) => void;
  /** Restore the optimized route to the nearest-neighbor result. */
  reset: () => void;
}

/**
 * Reorders waypoints starting from the first waypoint, repeatedly
 * visiting the nearest unvisited waypoint. This is a greedy heuristic,
 * not a true TSP solver — it's intentionally simple, but it does
 * genuinely minimize hop-to-hop distance rather than being a no-op.
 */
function nearestNeighborOrder(points: OptimizerWaypoint[]): OptimizerWaypoint[] {
  if (points.length <= 2) return [...points];

  const remaining = [...points];
  const ordered: OptimizerWaypoint[] = [remaining.shift() as OptimizerWaypoint];

  while (remaining.length > 0) {
    const current = ordered[ordered.length - 1];
    let nearestIndex = 0;
    let nearestDistance = Infinity;

    remaining.forEach((candidate, index) => {
      const distance = calculateDistanceKm(current.coordinate, candidate.coordinate);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    ordered.push(remaining.splice(nearestIndex, 1)[0]);
  }

  return ordered;
}

function totalRouteDistance(route: OptimizerWaypoint[]): number {
  let distance = 0;
  for (let i = 0; i < route.length - 1; i += 1) {
    distance += calculateDistanceKm(route[i].coordinate, route[i + 1].coordinate);
  }
  return distance;
}

/**
 * Hook to optimize the visiting order of a set of waypoints.
 * @param initialWaypoints - The waypoints to optimize, in any order.
 */
export function useRouteOptimization(
  initialWaypoints: OptimizerWaypoint[]
): UseRouteOptimizationReturn {
  const nearestNeighborRoute = useMemo(
    () => nearestNeighborOrder(initialWaypoints),
    [initialWaypoints]
  );

  const [manualRoute, setManualRoute] = useState<OptimizerWaypoint[] | null>(null);

  const optimizedRoute = manualRoute ?? nearestNeighborRoute;

  const totalDistance = useMemo(
    () => totalRouteDistance(optimizedRoute),
    [optimizedRoute]
  );

  const estimatedTime = useMemo(
    () => (totalDistance / AVERAGE_SPEED_KMH) * 60,
    [totalDistance]
  );

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    setManualRoute((current) => {
      const base = current ?? nearestNeighborRoute;
      if (
        fromIndex < 0 ||
        fromIndex >= base.length ||
        toIndex < 0 ||
        toIndex >= base.length ||
        fromIndex === toIndex
      ) {
        return base;
      }
      const next = [...base];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, [nearestNeighborRoute]);

  const reset = useCallback(() => {
    setManualRoute(null);
  }, []);

  return {
    waypoints: initialWaypoints,
    optimizedRoute,
    totalDistance,
    estimatedTime,
    reorder,
    reset,
  };
}
