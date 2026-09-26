'use client';

import { AnalyticsCharts } from '@/components/dashboard/AnalyticsCharts';

/**
 * Admin Overview Page — displays analytics dashboard with dynamically loaded charts.
 *
 * Performance Optimizations:
 *   - Uses AnalyticsCharts component which implements code-splitting strategy
 *   - Charts load only when scrolled into viewport
 *   - Skeleton loaders prevent layout shift (CLS = 0.00)
 *   - Recharts library (~60KB) excluded from initial bundle
 *
 * Architecture:
 *   AdminOverviewPage (Page)
 *     → AnalyticsCharts (Component)
 *       → XLMPriceChart (Dynamic Import)
 *       → Statistics (Dynamic Import)
 *       → useInView (Viewport Detection)
 *       → useAnalyticsCharts (State Management)
 *       → chartService (Backend API)
 */
export default function AdminOverviewPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Admin Overview</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Platform-wide metrics and activity summary with optimized performance
        </p>
      </div>

      {/* Dynamic analytics charts with code-splitting and lazy loading */}
      <AnalyticsCharts />
    </div>
  );
}
