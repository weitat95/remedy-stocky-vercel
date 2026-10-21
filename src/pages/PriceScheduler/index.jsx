import React, { useMemo, useState } from 'react';
import {
  Page, Card, IndexTable, Text, Badge, Button, Banner, Tabs, Select, TextField, InlineStack, BlockStack,
  Modal, Toast, Pagination, Box,
} from '@shopify/polaris';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { downloadCSVFile } from '../../utils/csv.js';
import {
  getPriceSchedules, getPriceSchedulesSummary, setPriceSchedulerPaused, getPriceScheduleBatches,
  getPriceScheduleEvents, getPriceScheduleBatchEvents, getPriceScheduleBatchOriginals,
  priceScheduleRowAction, priceScheduleBatchAction,
} from '../../api/priceSchedules.js';
import Import from './Import.jsx';

const TABS = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'attention', label: 'Failed / Cancelled' },
];

const STATUS_TONE = {
  pending: 'info', applying: 'attention', active: 'success', restoring: 'attention',
  completed: undefined, failed: 'critical', cancelled: undefined,
};

const errMsg = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';

function PriceCell({ r }) {
  if (r.newPrice == null && !r.clearCompareAt && r.newCompareAt == null) return '—';
  return (
    <BlockStack gap="050">
      {r.newPrice != null && (
        <Text as="span">{r.newPrice}{r.originalPrice != null && <Text as="span" tone="subdued"> (was {r.originalPrice})</Text>}</Text>
      )}
      {(r.newCompareAt != null || r.clearCompareAt) && (
        <Text as="span" tone="subdued">
          compare-at {r.clearCompareAt ? 'cleared' : r.newCompareAt}
          {r.originalsCapturedAt && <> (was {r.originalCompareAt ?? 'empty'})</>}
        </Text>
      )}
    </BlockStack>
  );
}

function detailsText(e) {
  const d = e.details || {};
  const parts = [];
  if (d.before) parts.push(`before ${d.before.price ?? '—'} / ${d.before.compareAt ?? 'no compare-at'}`);
  if (d.original) parts.push(`original ${d.original.price ?? '—'} / ${d.original.compareAt ?? 'no compare-at'}`);
  if (d.wrote) parts.push(`wrote ${d.wrote.price ?? 'unchanged'} / ${d.wrote.compareAt === undefined ? 'unchanged' : d.wrote.compareAt ?? 'cleared'}`);
  if (d.readBack) parts.push(`read back ${d.readBack.price ?? '—'} / ${d.readBack.compareAt ?? 'no compare-at'}`);
  if (d.newPrice !== undefined && e.event === 'created') parts.push(`price ${d.newPrice ?? 'unchanged'}, compare-at ${d.clearCompareAt ? 'clear' : d.newCompareAt ?? 'unchanged'}`);
  if (d.lateMs) parts.push(`ran ${Math.round(d.lateMs / 60000)} min late`);
  if (d.code) parts.push(`${d.code}: ${d.message || ''}`);
  if (d.note) parts.push(d.note);
  if (d.reason) parts.push(d.reason);
  if (d.acknowledgedLarge) parts.push('large changes acknowledged');
  if (d.overrodeHardBlocks) parts.push('hard blocks overridden');
  return parts.join(' · ');
}

function HistoryModal({ target, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['price-schedule-events', target?.kind, target?.id],
    queryFn: () => (target.kind === 'batch' ? getPriceScheduleBatchEvents(target.id) : getPriceScheduleEvents(target.id)),
    enabled: !!target,
  });
  const exportCsv = () => downloadCSVFile(`price_schedule_history_${target.id}.csv`, [
    ['time (KL)', 'sku', 'event', 'from', 'to', 'actor', 'trigger', 'details'],
    ...(data || []).map((e) => [e.atLocal, e.sku ?? '', e.event, e.fromStatus ?? '', e.toStatus ?? '', e.actorName ? `${e.actor} (${e.actorName})` : e.actor, e.trigger, detailsText(e)]),
  ]);
  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={target ? `History: ${target.label}` : ''}
      size="large"
      primaryAction={{ content: 'Close', onAction: onClose }}
      secondaryActions={target?.kind === 'batch' ? [{ content: 'Export history CSV', onAction: exportCsv, disabled: !data?.length }] : []}
    >
      <Modal.Section>
        {isLoading ? <Text tone="subdued">Loading…</Text> : (
          <IndexTable
            selectable={false}
            resourceName={{ singular: 'event', plural: 'events' }}
            itemCount={data?.length || 0}
            headings={[{ title: 'Time (KL)' }, ...(target?.kind === 'batch' ? [{ title: 'SKU' }] : []), { title: 'Event' }, { title: 'Status' }, { title: 'By' }, { title: 'Details' }]}
          >
            {(data || []).map((e, i) => (
              <IndexTable.Row id={e.id} key={e.id} position={i}>
                <IndexTable.Cell>{e.atLocal}</IndexTable.Cell>
                {target?.kind === 'batch' && <IndexTable.Cell>{e.sku}</IndexTable.Cell>}
                <IndexTable.Cell><Badge tone={e.event === 'failed' ? 'critical' : undefined}>{e.event.replace(/_/g, ' ')}</Badge></IndexTable.Cell>
                <IndexTable.Cell>{e.fromStatus || e.toStatus ? `${e.fromStatus ?? '—'} → ${e.toStatus ?? '—'}` : ''}</IndexTable.Cell>
                <IndexTable.Cell>{e.actor === 'user' ? `user${e.actorName ? ` (${e.actorName})` : ''}` : `system · ${e.trigger}`}</IndexTable.Cell>
                <IndexTable.Cell><Text as="span" variant="bodySm">{detailsText(e)}</Text></IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        )}
      </Modal.Section>
    </Modal>
  );
}

export default function PriceScheduler() {
  const qc = useQueryClient();
  const [mode, setMode] = useState('list'); // 'list' | 'import'
  const [tabIdx, setTabIdx] = useState(0);
  const [batchId, setBatchId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null); // { title, body, label, destructive, run }
  const [history, setHistory] = useState(null);
  const [recheck, setRecheck] = useState(null);
  const tab = TABS[tabIdx].id;

  const { data: summary } = useQuery({ queryKey: ['price-schedules', 'summary'], queryFn: getPriceSchedulesSummary, refetchInterval: 30_000 });
  const { data: batches = [] } = useQuery({ queryKey: ['price-schedules', 'batches'], queryFn: getPriceScheduleBatches });
  const { data, isLoading } = useQuery({
    queryKey: ['price-schedules', 'list', tab, batchId, search, page],
    queryFn: () => getPriceSchedules({ tab, batchId: batchId || undefined, q: search || undefined, page }),
    refetchInterval: 30_000,
    keepPreviousData: true,
  });
  const rows = data?.rows || [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const refresh = () => qc.invalidateQueries({ queryKey: ['price-schedules'] });
  const notify = (message, error = false) => setToast({ message, error });

  const act = useMutation({
    mutationFn: ({ fn }) => fn(),
    onSuccess: (res, { success }) => { notify(success(res)); refresh(); },
    onError: (e) => { notify(errMsg(e), true); refresh(); },
  });

  const rowAction = (r, action, label) => {
    act.mutate({ fn: () => priceScheduleRowAction(r.id, action), success: () => `${label}: ${r.sku}` });
  };
  const askConfirm = (cfg) => setConfirm(cfg);
  const runConfirm = () => { confirm.run(); setConfirm(null); };

  const pauseMutation = useMutation({
    mutationFn: (paused) => setPriceSchedulerPaused(paused),
    onSuccess: (res) => { notify(res.paused ? 'Scheduler paused' : 'Scheduler resumed'); refresh(); },
    onError: (e) => notify(errMsg(e), true),
  });

  const tabs = TABS.map((t, i) => ({
    id: t.id, content: summary ? `${t.label} (${summary.counts[t.id] ?? 0})` : t.label, panelID: `${t.id}-panel`, index: i,
  }));

  const batchOptions = useMemo(() => [
    { label: 'All batches', value: '' },
    ...batches.map((b) => ({ label: `${b.createdLocal} · ${b.name || b.fileName || 'Upload'} (${b.rowCount})`, value: b.id })),
  ], [batches]);
  const selectedBatch = batches.find((b) => b.id === batchId);

  const exportOriginals = async () => {
    const orig = await getPriceScheduleBatchOriginals(batchId);
    if (!orig.length) { notify('No originals captured yet for this batch', true); return; }
    // Re-uploadable as a recovery schedule: fill in start (and end) before uploading.
    downloadCSVFile(`price_originals_${batchId}.csv`, [
      ['sku', 'price', 'compare_at_price', 'start', 'end'],
      ...orig.map((o) => [o.sku, o.touchesPrice ? o.originalPrice : '', o.touchesCompareAt ? (o.originalCompareAt ?? 'clear') : '', '', '']),
    ]);
  };

  if (mode === 'import') {
    return (
      <Page title="Price Scheduler" subtitle="Upload a CSV of scheduled price / compare-at changes" backAction={{ content: 'Schedules', onAction: () => setMode('list') }}>
        <Import
          showToast={(t) => notify(t.message)}
          onCancel={() => setMode('list')}
          onDone={(id) => { setMode('list'); setBatchId(id); setTabIdx(0); setPage(1); refresh(); }}
        />
        {toast && <Toast content={toast.message} error={toast.error} onDismiss={() => setToast(null)} />}
      </Page>
    );
  }

  const sub = summary
    ? `Next start: ${summary.nextStart ?? 'none'} · Next end: ${summary.nextEnd ?? 'none'} (Kuala Lumpur time)`
    : undefined;

  const rowMarkup = rows.map((r, i) => (
    <IndexTable.Row id={r.id} key={r.id} position={i}>
      <IndexTable.Cell><Text fontWeight="semibold" as="span">{r.sku}</Text></IndexTable.Cell>
      <IndexTable.Cell>
        {r.productTitle}{r.variantTitle && r.variantTitle !== 'Default Title' ? ` — ${r.variantTitle}` : ''}
      </IndexTable.Cell>
      <IndexTable.Cell><PriceCell r={r} /></IndexTable.Cell>
      <IndexTable.Cell>{r.startLocal}</IndexTable.Cell>
      <IndexTable.Cell>{r.endLocal || <Badge tone="attention">Permanent</Badge>}</IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="050">
          <span><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge></span>
          {r.startLateMin != null && <Text as="span" variant="bodySm" tone="caution">Started {r.startLateMin} min late</Text>}
          {r.endLateMin != null && <Text as="span" variant="bodySm" tone="caution">Restored {r.endLateMin} min late</Text>}
          {r.status === 'failed' && (
            <Text as="span" variant="bodySm" tone="critical">{r.errorCode}: {r.error}</Text>
          )}
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>{r.batch?.name || r.batch?.fileName || '—'}</IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="100" wrap={false}>
          {r.status === 'pending' && <Button size="slim" onClick={() => rowAction(r, 'cancel', 'Cancelled')}>Cancel</Button>}
          {r.status === 'active' && (
            <Button size="slim" onClick={() => askConfirm({
              title: `Restore ${r.sku} now?`,
              body: `Writes the original price${r.originalPrice != null ? ` (${r.originalPrice})` : ''} back to Shopify immediately, ahead of the scheduled end.`,
              label: 'Restore now', run: () => rowAction(r, 'restore-now', 'Restored'),
            })}>Restore now</Button>
          )}
          {r.status === 'failed' && !(r.failedPhase === 'restore' && r.errorCode === 'EXTERNAL_CHANGE') && (
            <Button size="slim" onClick={() => rowAction(r, 'retry', 'Retried')}>Retry</Button>
          )}
          {r.status === 'failed' && r.failedPhase === 'restore' && (
            <Button size="slim" tone="critical" onClick={() => askConfirm({
              title: `Restore ${r.sku} anyway?`,
              body: `${r.error}\n\nThis overwrites whatever is in Shopify now with the original values (${r.originalPrice ?? '—'} / ${r.originalCompareAt ?? 'no compare-at'}).`,
              label: 'Restore anyway', destructive: true, run: () => rowAction(r, 'restore-anyway', 'Restored'),
            })}>Restore anyway</Button>
          )}
          {r.status === 'failed' && (
            <Button size="slim" onClick={() => askConfirm({
              title: `Dismiss ${r.sku}?`,
              body: r.failedPhase === 'restore'
                ? 'Leaves the price in Shopify as it is now, with no write, and closes this row as completed. The audit trail records it.'
                : 'Closes this row as cancelled. Nothing was applied in Shopify by this schedule.',
              label: 'Dismiss', run: () => rowAction(r, 'dismiss', 'Dismissed'),
            })}>Dismiss</Button>
          )}
          <Button size="slim" variant="plain" onClick={() => setHistory({ kind: 'row', id: r.id, label: r.sku })}>History</Button>
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      fullWidth
      title="Price Scheduler"
      subtitle={sub}
      primaryAction={{ content: 'Upload CSV', onAction: () => setMode('import') }}
      secondaryActions={[
        {
          content: summary?.paused ? 'Resume scheduler' : 'Pause scheduler',
          destructive: !summary?.paused,
          onAction: () => (summary?.paused
            ? pauseMutation.mutate(false)
            : askConfirm({ title: 'Pause the scheduler?', body: 'No price will be applied or restored while paused. Overdue rows run (marked late) once you resume.', label: 'Pause', destructive: true, run: () => pauseMutation.mutate(true) })),
        },
      ]}
    >
      <BlockStack gap="400">
        {summary?.paused && (
          <Banner tone="warning" title="Scheduler is paused">Nothing is being applied or restored. Resume to run overdue rows (they will be marked late).</Banner>
        )}
        {summary?.stale && !summary?.paused && (
          <Banner tone="critical" title="Scheduler has not ticked recently">
            Last tick: {summary.lastTickAt ? new Date(summary.lastTickAt).toLocaleString() : 'never'}. Scheduled changes will not run until the backend is up. Check pm2 logs.
          </Banner>
        )}
        {summary?.writeAccess === false && (
          <Banner tone="warning" title="Shopify write access missing">
            The app token doesn&apos;t carry <b>write_products</b>, so applying a price will fail. Release the app version, approve &quot;Update access&quot; in Shopify Admin, then restart the backend.
          </Banner>
        )}
        {recheck && (
          <Banner tone={recheck.some((x) => x.issues.length) ? 'warning' : 'success'} title="Re-check against live Shopify data" onDismiss={() => setRecheck(null)}>
            {recheck.some((x) => x.issues.length)
              ? <ul>{recheck.filter((x) => x.issues.length).map((x) => <li key={x.id}><b>{x.sku}</b>: {x.issues.join('; ')}</li>)}</ul>
              : 'No issues found in the pending rows of this batch.'}
          </Banner>
        )}

        <Card padding="0">
          <Tabs tabs={tabs} selected={tabIdx} onSelect={(i) => { setTabIdx(i); setPage(1); }} />
          <Box padding="300">
            <InlineStack gap="300" blockAlign="end" wrap>
              <div style={{ minWidth: 320 }}>
                <Select label="Batch" options={batchOptions} value={batchId} onChange={(v) => { setBatchId(v); setPage(1); }} />
              </div>
              <div style={{ minWidth: 240 }}>
                <TextField label="Search" value={search} onChange={(v) => { setSearch(v); setPage(1); }} autoComplete="off" placeholder="SKU or product" clearButton onClearButtonClick={() => setSearch('')} />
              </div>
              {selectedBatch && (
                <InlineStack gap="200">
                  <Button onClick={() => askConfirm({ title: 'Cancel pending rows in this batch?', body: 'Active rows are not affected (use Restore now for those).', label: 'Cancel pending', destructive: true, run: () => act.mutate({ fn: () => priceScheduleBatchAction(batchId, 'cancel'), success: (r) => `Cancelled ${r.cancelled}${r.notPending ? `, skipped ${r.notPending} not pending` : ''}` }) })}>Cancel pending</Button>
                  <Button onClick={() => askConfirm({ title: 'Restore all active rows in this batch now?', body: 'Writes the original prices back to Shopify immediately.', label: 'Restore active now', destructive: true, run: () => act.mutate({ fn: () => priceScheduleBatchAction(batchId, 'restore-now'), success: (r) => `Restored ${r.restored}${r.failed ? `, ${r.failed} failed` : ''}` }) })}>Restore active now</Button>
                  <Button onClick={() => act.mutate({ fn: () => priceScheduleBatchAction(batchId, 'retry-failed'), success: (r) => `Retried: ${r.applied} applied, ${r.restored} restored, ${r.failed} failed${r.needsDecision ? `, ${r.needsDecision} need a decision (Restore anyway / Dismiss)` : ''}` })}>Retry failed</Button>
                  <Button onClick={async () => { try { setRecheck(await priceScheduleBatchAction(batchId, 'recheck')); } catch (e) { notify(errMsg(e), true); } }}>Re-check pending</Button>
                  <Button variant="plain" onClick={() => setHistory({ kind: 'batch', id: batchId, label: selectedBatch.name || selectedBatch.fileName || 'batch' })}>Batch history</Button>
                  <Button variant="plain" onClick={exportOriginals}>Export originals CSV</Button>
                </InlineStack>
              )}
            </InlineStack>
          </Box>
          <IndexTable
            selectable={false}
            loading={isLoading}
            resourceName={{ singular: 'schedule', plural: 'schedules' }}
            itemCount={rows.length}
            emptyState={<Box padding="400"><Text tone="subdued" alignment="center">No schedules here.</Text></Box>}
            headings={[
              { title: 'SKU' }, { title: 'Product' }, { title: 'New / original' }, { title: 'Start' }, { title: 'End' },
              { title: 'Status' }, { title: 'Batch' }, { title: 'Actions' },
            ]}
          >
            {rowMarkup}
          </IndexTable>
          {totalPages > 1 && (
            <Box padding="300">
              <InlineStack align="center">
                <Pagination hasPrevious={page > 1} hasNext={page < totalPages} onPrevious={() => setPage(page - 1)} onNext={() => setPage(page + 1)} label={`Page ${page} of ${totalPages}`} />
              </InlineStack>
            </Box>
          )}
        </Card>
      </BlockStack>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.title || ''}
        primaryAction={{ content: confirm?.label || 'Confirm', destructive: confirm?.destructive, onAction: runConfirm }}
        secondaryActions={[{ content: 'Back', onAction: () => setConfirm(null) }]}
      >
        <Modal.Section><Text as="p" breakWord>{confirm?.body}</Text></Modal.Section>
      </Modal>
      <HistoryModal target={history} onClose={() => setHistory(null)} />
      {toast && <Toast content={toast.message} error={toast.error} onDismiss={() => setToast(null)} duration={4000} />}
    </Page>
  );
}
