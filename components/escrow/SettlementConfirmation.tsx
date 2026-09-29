'use client';

import React from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  Package,
  RotateCw,
  XCircle,
} from 'lucide-react';
import { useSettlementBreakdown } from '@/hooks/useSettlementBreakdown';
import { formatSettlementDate, truncateHash } from '@/lib/settlementFormatters';

interface SettlementConfirmationProps {
  escrowId: string;
  className?: string;
}

interface BreakdownRowProps {
  label: string;
  value: string;
  hint?: string | null;
  emphasis?: 'positive' | 'muted' | 'warning';
}

const EMPHASIS_CLASSES: Record<NonNullable<BreakdownRowProps['emphasis']>, string> = {
  positive: 'text-emerald-700',
  muted: 'text-gray-700',
  warning: 'text-amber-700',
};

function BreakdownRow({ label, value, hint, emphasis = 'muted' }: BreakdownRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="min-w-0">
        <span className="block text-sm text-gray-600">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-gray-500">{hint}</span>}
      </dt>
      <dd className={`shrink-0 text-right text-sm font-semibold tabular-nums ${EMPHASIS_CLASSES[emphasis]}`}>
        {value}
      </dd>
    </div>
  );
}

function LoadingState() {
  return (
    <div
      className="space-y-4"
      aria-busy="true"
      aria-label="Loading settlement details"
      data-testid="settlement-loading"
    >
      <div className="mx-auto h-16 w-16 animate-pulse rounded-full bg-gray-200" />
      <div className="mx-auto h-6 w-56 animate-pulse rounded bg-gray-200" />
      <div className="h-40 animate-pulse rounded-xl bg-gray-100" />
      <div className="h-28 animate-pulse rounded-xl bg-gray-100" />
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
        <div className="flex-1">
          <h2 className="font-semibold text-red-900">Unable to load settlement</h2>
          <p className="mt-1 text-sm text-red-700">{message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Success screen shown after escrow release. Displays how the escrowed funds
 * were distributed (driver payout, platform fee, withholdings, held amounts),
 * the settlement transaction and a summary of the completed delivery.
 */
export function SettlementConfirmation({ escrowId, className = '' }: SettlementConfirmationProps) {
  const { settlement, formatted, taxBreakdown, explorerUrl, isLoading, isFinalizing, error, refetch } =
    useSettlementBreakdown(escrowId);

  const wrapperClass = `mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 ${className}`.trim();

  if (isLoading) {
    return (
      <section className={wrapperClass}>
        <LoadingState />
      </section>
    );
  }

  if (!settlement || !formatted) {
    return (
      <section className={wrapperClass}>
        <ErrorState message={error ?? 'Settlement details are not available yet.'} onRetry={refetch} />
      </section>
    );
  }

  const isFailed = settlement.status === 'failed';
  const { delivery } = settlement;

  return (
    <section className={wrapperClass} aria-labelledby="settlement-heading">
      <header className="text-center">
        <div
          className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
            isFailed ? 'bg-red-100' : isFinalizing ? 'bg-blue-100' : 'bg-emerald-100'
          }`}
        >
          {isFailed ? (
            <XCircle className="h-9 w-9 text-red-600" aria-hidden="true" />
          ) : isFinalizing ? (
            <Loader2 className="h-9 w-9 animate-spin text-blue-600" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-9 w-9 text-emerald-600" aria-hidden="true" />
          )}
        </div>
        <h1 id="settlement-heading" className="mt-4 text-2xl font-bold text-gray-900 sm:text-3xl">
          {isFailed ? 'Settlement failed' : isFinalizing ? 'Finalizing settlement' : 'Settlement complete'}
        </h1>
        <p className="mt-2 text-sm text-gray-600 sm:text-base">
          {isFailed
            ? 'The release transaction was not confirmed on the Stellar network.'
            : isFinalizing
              ? 'Waiting for the release transaction to be confirmed on the Stellar network.'
              : `Funds for delivery ${delivery.trackingNumber} have been released.`}
        </p>
      </header>

      {isFinalizing && (
        <p
          role="status"
          aria-live="polite"
          className="mt-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
        >
          This page updates automatically once the transaction is confirmed.
        </p>
      )}

      {error && (
        <div className="mt-6">
          <ErrorState message={error} onRetry={refetch} />
        </div>
      )}

      <div className="mt-8 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-sm font-medium text-gray-600">
          {isFailed ? 'Driver payout (not released)' : 'Released to driver'}
        </p>
        <p
          className={`mt-1 text-3xl font-bold tabular-nums sm:text-4xl ${
            isFailed ? 'text-gray-400 line-through' : 'text-gray-900'
          }`}
          data-testid="driver-payout"
        >
          {formatted.driverPayout}
        </p>

        <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">Fund breakdown</h2>
        <dl className="mt-2 divide-y divide-gray-100">
          <BreakdownRow label="Total escrow amount" value={formatted.totalEscrowAmount} />
          <BreakdownRow
            label="Released to driver"
            value={formatted.driverPayout}
            emphasis={isFailed ? 'muted' : 'positive'}
          />
          <BreakdownRow
            label={`Platform commission (${formatted.platformFeeRate})`}
            value={formatted.platformFee}
          />
          {taxBreakdown.map((tax) => (
            <BreakdownRow
              key={tax.code}
              label={`${tax.label} (${tax.formattedRate})`}
              value={tax.formattedAmount}
            />
          ))}
          {settlement.heldAmount > 0 && (
            <BreakdownRow
              label="Pending / held"
              value={formatted.heldAmount}
              hint={settlement.heldReason}
              emphasis="warning"
            />
          )}
          <BreakdownRow label="Remaining balance" value={formatted.remainingBalance} />
        </dl>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Transaction</h2>
        {settlement.transactionHash && explorerUrl ? (
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <code
              className="break-all rounded bg-gray-100 px-2 py-1 font-mono text-sm text-gray-800"
              title={settlement.transactionHash}
            >
              {truncateHash(settlement.transactionHash, 10)}
            </code>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              View on Stellar Explorer
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        ) : (
          <p className="mt-3 text-sm text-gray-500">Transaction hash will appear once submitted.</p>
        )}
        {(settlement.ledger !== null || settlement.settledAt) && (
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {settlement.ledger !== null && (
              <div>
                <dt className="text-gray-500">Ledger</dt>
                <dd className="font-medium text-gray-900 tabular-nums">{settlement.ledger}</dd>
              </div>
            )}
            {settlement.settledAt && (
              <div>
                <dt className="text-gray-500">Settled at</dt>
                <dd className="font-medium text-gray-900">{formatSettlementDate(settlement.settledAt)}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Delivery summary</h2>
        <dl className="mt-3 space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
            <dt className="text-gray-500">Tracking number</dt>
            <dd className="ml-auto font-mono font-medium text-gray-900">{delivery.trackingNumber}</dd>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
            <dt className="flex items-center gap-2 text-gray-500">
              <MapPin className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
              Route
            </dt>
            <dd className="flex items-center gap-2 font-medium text-gray-900 sm:ml-auto">
              <span>{delivery.origin}</span>
              <ArrowRight className="h-4 w-4 text-gray-400" aria-label="to" />
              <span>{delivery.destination}</span>
            </dd>
          </div>
          {delivery.deliveredAt && (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
              <dt className="text-gray-500">Delivered</dt>
              <dd className="ml-auto font-medium text-gray-900">{formatSettlementDate(delivery.deliveredAt)}</dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}

export default SettlementConfirmation;
