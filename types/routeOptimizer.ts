import type { Coordinate } from '@/types/tracking';

/**
 * A stop the RouteOptimizer can reorder. Distinct from the tracking
 * `RouteWaypoint` (which describes a fixed, already-driven route) — an
 * optimizer waypoint is an input the user can freely reorder before a
 * route is calculated.
 */
export interface OptimizerWaypoint {
  id: string;
  coordinate: Coordinate;
  label: string;
  address?: string;
}

/** Exported shape written to the downloaded route JSON file. */
export interface OptimizedRouteExport {
  waypoints: OptimizerWaypoint[];
  route: OptimizerWaypoint[];
  totalDistanceKm: number;
  estimatedTimeMinutes: number;
  generatedAt: string;
}
