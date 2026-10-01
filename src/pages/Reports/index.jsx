import React, { useState, useCallback, useEffect } from 'react';
import {
  Page, Card, Tabs, DataTable, Text, Badge, Spinner, Button, Checkbox,
  Banner, EmptyState, InlineStack, BlockStack, Select, TextField, Tooltip, Icon, Pagination, Box, InlineGrid, Toast,
  Modal, Link,
} from '@shopify/polaris';
import { QuestionCircleIcon } from '@shopify/polaris-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation, Routes, Route } from 'react-router-dom';
import {
  getSlowMoving, getReorderReport, getPOHistory, getStockOnHand, getLocationDailySales,
  getReplenishmentReports, getReplenishmentReport, runReplenishmentReport,
  getReplenishmentSettings, updateReplenishmentSettings,
} from '../../api/reports.js';
import { getLocations } from '../../api/inventory.js';
import { getVendors } from '../../api/vendors.js';
import { downloadCSVFile } from '../../utils/csv.js';

const FOOT_TRAFFIC_PAGE_SIZE = 50;
const HIGHLIGHT_DEFAULTS_KEY = 'footTrafficHighlightDefaults';

function loadHighlightDefaults() {
  try {
    const saved = JSON.parse(localStorage.getItem(HIGHLIGHT_DEFAULTS_KEY) || '{}');
    return { salesHighlight: saved.salesHighlight ?? '', conversionHighlight: saved.conversionHighlight ?? '' };
  } catch {
    return { salesHighlight: '', conversionHighlight: '' };
  }
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function SlowMovingReport() {
  const [days, setDays] = useState('90');
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', 'slow-moving', days],
    queryFn: () => getSlowMoving({ days: Number(days) }),
  });
  const rows = (data?.data || []).map((item) => [
    item.productTitle, item.variantTitle || '—', item.sku || '—', `${item.noSalesDays}d`,
  ]);
  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center">
        <Text variant="headingMd">Slow-Moving Stock</Text>
        <Select label="No sales in" labelInline options={[
          { label: '30 days', value: '30' }, { label: '60 days', value: '60' },
          { label: '90 days', value: '90' }, { label: '180 days', value: '180' },
        ]} value={days} onChange={setDays} />
      </InlineStack>
      {error && <Banner tone="critical">{error.message}</Banner>}
      {isLoading ? <Spinner /> : rows.length === 0
        ? <EmptyState heading="No slow-moving products" image="" />
        : <DataTable columnContentTypes={['text','text','text','text']} headings={['Product','Variant','SKU','No Sales']} rows={rows} />
      }
    </BlockStack>
  );
}

function ReorderReport() {
  const [threshold, setThreshold] = useState('10');
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', 'reorder', threshold],
    queryFn: () => getReorderReport({ threshold: Number(threshold) }),
  });
  const rows = (data?.data || []).map((item) => [
    item.productTitle || '—', item.variantTitle || '—', item.sku || '—',
    <Badge tone="critical" key={item.variantId}>{String(item.available)}</Badge>,
    item.reorderThreshold,
  ]);
  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center">
        <Text variant="headingMd">Reorder Report</Text>
        <TextField label="Threshold" labelInline type="number" value={threshold} onChange={setThreshold} autoComplete="off" />
      </InlineStack>
      {error && <Banner tone="critical">{error.message}</Banner>}
      {isLoading ? <Spinner /> : rows.length === 0
        ? <EmptyState heading="All products above threshold" image="" />
        : <DataTable columnContentTypes={['text','text','text','text','numeric']} headings={['Product','Variant','SKU','Available','Threshold']} rows={rows} />
      }
    </BlockStack>
  );
}

function StockOnHandReport() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', 'stock-on-hand'],
    queryFn: getStockOnHand,
  });
  const rows = (data?.data || []).map((item) => [
    item.productTitle || '—', item.variantTitle || '—', item.sku || '—',
    item.locationName || '—', item.available ?? 0,
  ]);
  return (
    <BlockStack gap="400">
      <Text variant="headingMd">Stock on Hand</Text>
      {error && <Banner tone="critical">{error.message}</Banner>}
      {isLoading ? <Spinner /> : rows.length === 0
        ? <EmptyState heading="No inventory data" image="" />
        : <DataTable columnContentTypes={['text','text','text','text','numeric']} headings={['Product','Variant','SKU','Location','Available']} rows={rows} />
      }
    </BlockStack>
  );
}

function POHistoryReport() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', 'po-history'],
    queryFn: getPOHistory,
  });
  const summary = data?.data?.supplierSummary || [];
  const orders = data?.data?.orders || [];
  const summaryRows = summary.map((s) => [s.supplierName, s.totalOrders, `$${Number(s.totalSpend).toFixed(2)}`]);
  const orderRows = orders.map((po) => [
    po.supplier?.name || '—', po.status.replace(/_/g, ' '),
    po.lineItems?.length || 0, new Date(po.createdAt).toLocaleDateString(),
  ]);
  return (
    <BlockStack gap="500">
      {error && <Banner tone="critical">{error.message}</Banner>}
      {isLoading ? <Spinner /> : (
        <>
          <BlockStack gap="300">
            <Text variant="headingMd">Spend by Supplier</Text>
            {summary.length === 0
              ? <EmptyState heading="No supplier spend yet" image="" />
              : <DataTable columnContentTypes={['text','numeric','text']} headings={['Supplier','POs','Total Spend']} rows={summaryRows} />
            }
          </BlockStack>
          <BlockStack gap="300">
            <Text variant="headingMd">All Purchase Orders</Text>
            {orders.length === 0
              ? <EmptyState heading="No purchase orders" image="" />
              : <DataTable columnContentTypes={['text','text','numeric','text']} headings={['Supplier','Status','Items','Created']} rows={orderRows} />
            }
          </BlockStack>
        </>
      )}
    </BlockStack>
  );
}

// index into a foot-traffic row — order matches the DataTable headings/columns
const FOOT_TRAFFIC_SORT_FIELDS = [
  'date', 'dayName', 'locationName', 'peopleIn', 'peopleOut', 'net', 'visitors', 'netSales', 'orderCount', 'conversionRate',
];

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' });
// r.date is a YYYY-MM-DD store-local calendar date (see storeLocalDate in the backend) —
// parsed as UTC midnight and formatted back out in UTC so the weekday matches that
// calendar date regardless of the viewer's browser timezone.
function weekdayName(dateStr) {
  return WEEKDAY_FORMATTER.format(new Date(`${dateStr}T00:00:00Z`));
}

function compareFootTrafficRows(a, b, field) {
  const av = a[field];
  const bv = b[field];
  if (av == null && bv == null) return 0;
  if (av == null) return -1; // nulls (e.g. no matching device) sort first
  if (bv == null) return 1;
  if (typeof av === 'string') return av.localeCompare(bv);
  return av - bv;
}

// Metric options for the Calendar view's day-cell heatmap.
const CALENDAR_METRICS = [
  { value: 'visitors', label: 'Visitors', format: (v) => (v != null ? String(v) : '—') },
  { value: 'netSales', label: 'Net Sales', format: (v) => `RM ${Number(v).toFixed(0)}` },
  { value: 'orderCount', label: 'Orders', format: (v) => (v != null ? String(v) : '—') },
  { value: 'conversionRate', label: 'Conversion Rate', format: (v) => (v != null ? `${(v * 100).toFixed(1)}%` : '—') },
  { value: 'peopleIn', label: 'People In', format: (v) => (v != null ? String(v) : '—') },
  { value: 'peopleOut', label: 'People Out', format: (v) => (v != null ? String(v) : '—') },
];

const MAX_CALENDAR_MONTHS = 12;

// Collapse rows (one per location per date) down to one aggregate row per date —
// the Calendar view always shows every day regardless of location filter, so with
// "All locations" selected this sums across locations for the day (visitors is
// re-derived as min(peopleIn, peopleOut) on the summed totals, same rule the
// backend applies per device, not averaged from each location's own rate).
function groupRowsByDate(rows) {
  const byDate = {};
  for (const r of rows) {
    const agg = (byDate[r.date] ||= {
      date: r.date, orderCount: 0, netSales: 0, peopleIn: 0, peopleOut: 0, net: 0, hasTraffic: false,
    });
    agg.orderCount += r.orderCount;
    agg.netSales += r.netSales;
    if (r.peopleIn != null) agg.hasTraffic = true;
    agg.peopleIn += r.peopleIn ?? 0;
    agg.peopleOut += r.peopleOut ?? 0;
    agg.net += r.net ?? 0;
  }
  return Object.fromEntries(Object.values(byDate).map((agg) => {
    const visitors = agg.hasTraffic ? Math.min(agg.peopleIn, agg.peopleOut) : null;
    return [agg.date, {
      date: agg.date,
      orderCount: agg.orderCount,
      netSales: agg.netSales,
      peopleIn: agg.hasTraffic ? agg.peopleIn : null,
      peopleOut: agg.hasTraffic ? agg.peopleOut : null,
      net: agg.hasTraffic ? agg.net : null,
      visitors,
      conversionRate: visitors ? Number((agg.orderCount / visitors).toFixed(4)) : null,
    }];
  }));
}

// [{ year, month (0-indexed) }] spanning from..to (both YYYY-MM-DD), capped at
// MAX_CALENDAR_MONTHS so an accidentally huge range can't render forever.
function monthsBetween(fromStr, toStr) {
  const start = new Date(`${fromStr}T00:00:00Z`);
  const end = new Date(`${toStr}T00:00:00Z`);
  const months = [];
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const endMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cur <= endMonth && months.length < MAX_CALENDAR_MONTHS) {
    months.push({ year: cur.getUTCFullYear(), month: cur.getUTCMonth() });
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return months;
}

// Leading `null`s for alignment (week starts Sunday) + one YYYY-MM-DD string per
// day of the month.
function calendarCells(year, month) {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = new Array(firstWeekday).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return cells;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function heatBackground(value, max) {
  if (value == null || !(max > 0) || value <= 0) return 'transparent';
  const alpha = Math.min(1, value / max);
  return `rgba(0, 128, 96, ${(0.1 + alpha * 0.45).toFixed(2)})`;
}

function FootTrafficReport() {
  const [from, setFrom] = useState(() => isoDaysAgo(30));
  const [to, setTo] = useState(() => isoDaysAgo(0));
  const [locationId, setLocationId] = useState('all');
  const [page, setPage] = useState(0);
  const [sortIndex, setSortIndex] = useState(0); // Date
  const [sortDirection, setSortDirection] = useState('descending');
  const [{ salesHighlight, conversionHighlight }, setHighlights] = useState(loadHighlightDefaults);
  const setSalesHighlight = (v) => setHighlights((h) => ({ ...h, salesHighlight: v }));
  const setConversionHighlight = (v) => setHighlights((h) => ({ ...h, conversionHighlight: v }));
  const [showEmptyDays, setShowEmptyDays] = useState(false);
  const [viewMode, setViewMode] = useState('table');
  const [calendarMetric, setCalendarMetric] = useState('visitors');
  const [toast, setToast] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', 'location-daily-sales', from, to],
    queryFn: () => getLocationDailySales({ from, to }),
  });
  const { data: locationsData } = useQuery({ queryKey: ['locations'], queryFn: getLocations });

  const allRows = (data?.data || []).map((r) => ({ ...r, dayName: weekdayName(r.date) }));
  const locationOptions = [
    { label: 'All locations', value: 'all' },
    ...(locationsData?.data || []).map((l) => ({ label: l.name, value: l.id })),
  ];
  const locationFilteredRows = locationId === 'all' ? allRows : allRows.filter((r) => r.locationId === locationId);
  // "Empty" = the backend zero-filled this date/location (see GET /reports/location-daily-sales)
  // because there were no orders and no foot traffic that day — hidden by default so a quiet
  // range doesn't drown out days that actually had activity.
  const isEmptyRow = (r) => r.orderCount === 0 && (r.peopleIn ?? 0) === 0 && (r.peopleOut ?? 0) === 0;
  const filteredRows = showEmptyDays ? locationFilteredRows : locationFilteredRows.filter((r) => !isEmptyRow(r));

  // Calendar view always shows every day (that's the point of it) regardless of the
  // "Show empty days" table toggle, so it's built off locationFilteredRows directly.
  const dateAgg = groupRowsByDate(locationFilteredRows);
  const calendarMonths = monthsBetween(from, to);
  const calendarMetricConfig = CALENDAR_METRICS.find((m) => m.value === calendarMetric);
  const calendarMax = Math.max(
    0,
    ...Object.values(dateAgg)
      .filter((r) => r.date >= from && r.date <= to)
      .map((r) => r[calendarMetric])
      .filter((v) => v != null)
  );

  const sortedRows = [...filteredRows].sort((a, b) => {
    const dir = sortDirection === 'descending' ? -1 : 1;
    return compareFootTrafficRows(a, b, FOOT_TRAFFIC_SORT_FIELDS[sortIndex]) * dir;
  });

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / FOOT_TRAFFIC_PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pagedRows = sortedRows.slice(
    clampedPage * FOOT_TRAFFIC_PAGE_SIZE,
    clampedPage * FOOT_TRAFFIC_PAGE_SIZE + FOOT_TRAFFIC_PAGE_SIZE
  );

  // Plain-text row — used for CSV export and as the base for the on-screen row.
  const toCsvRow = (r) => [
    r.date,
    r.dayName,
    r.locationName || '—',
    r.peopleIn ?? '—',
    r.peopleOut ?? '—',
    r.net ?? '—',
    r.visitors ?? '—',
    `RM ${Number(r.netSales).toFixed(2)}`,
    r.orderCount,
    r.conversionRate != null ? `${(r.conversionRate * 100).toFixed(1)}%` : '—',
  ];
  const headings = ['Date', 'Day', 'Location', 'People In', 'People Out', 'Net', 'Visitors', 'Net Sales', 'Orders', 'Conversion Rate'];

  const salesThreshold = salesHighlight !== '' ? Number(salesHighlight) : null;
  const conversionThreshold = conversionHighlight !== '' ? Number(conversionHighlight) : null;

  // On-screen row — same cells as toCsvRow, but Net Sales / Conversion Rate
  // swap in a success Badge when they clear the user-set highlight threshold.
  const toDisplayRow = (r) => {
    const cells = toCsvRow(r);
    if (salesThreshold != null && Number.isFinite(salesThreshold) && Number(r.netSales) >= salesThreshold) {
      cells[7] = <Badge tone="success">{cells[7]}</Badge>;
    }
    if (
      conversionThreshold != null && Number.isFinite(conversionThreshold) &&
      r.conversionRate != null && r.conversionRate * 100 >= conversionThreshold
    ) {
      cells[9] = <Badge tone="success">{cells[9]}</Badge>;
    }
    return cells;
  };
  const rows = pagedRows.map(toDisplayRow);

  const visitorsHeading = (
    <Tooltip content="min(People In, People Out) per device — a miscount in one direction shouldn't skew the count">
      <InlineStack gap="100" blockAlign="center" wrap={false}>
        <Text as="span">Visitors</Text>
        <Icon source={QuestionCircleIcon} tone="subdued" />
      </InlineStack>
    </Tooltip>
  );
  const conversionRateHeading = (
    <Tooltip content="Orders ÷ Visitors, where Visitors = min(People In, People Out) per device">
      <InlineStack gap="100" blockAlign="center" wrap={false}>
        <Text as="span">Conversion Rate</Text>
        <Icon source={QuestionCircleIcon} tone="subdued" />
      </InlineStack>
    </Tooltip>
  );

  const handleSort = useCallback((index, direction) => {
    setSortIndex(index);
    setSortDirection(direction);
    setPage(0);
  }, []);

  const handleExport = useCallback(() => {
    // Exports every row matching the current date range + location filter,
    // in the current sort order — not just the page on screen.
    const locationLabel = locationOptions.find((o) => o.value === locationId)?.label || 'all';
    downloadCSVFile(
      `foot-traffic_${from}_to_${to}_${locationLabel.toLowerCase().replace(/\s+/g, '-')}.csv`,
      [headings, ...sortedRows.map(toCsvRow)]
    );
  }, [sortedRows, from, to, locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveHighlightDefaults = useCallback(() => {
    localStorage.setItem(HIGHLIGHT_DEFAULTS_KEY, JSON.stringify({ salesHighlight, conversionHighlight }));
    setToast({ message: 'Saved as default highlight thresholds' });
  }, [salesHighlight, conversionHighlight]);

  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center">
        <Text variant="headingMd">Foot Traffic</Text>
        <InlineStack gap="200" blockAlign="center">
          <InlineStack gap="100" blockAlign="center" wrap={false}>
            <Text as="span" tone="subdued">From</Text>
            <TextField labelHidden label="From" type="date" value={from} onChange={(v) => { setFrom(v); setPage(0); }} autoComplete="off" />
          </InlineStack>
          <InlineStack gap="100" blockAlign="center" wrap={false}>
            <Text as="span" tone="subdued">To</Text>
            <TextField labelHidden label="To" type="date" value={to} onChange={(v) => { setTo(v); setPage(0); }} autoComplete="off" />
          </InlineStack>
          <Select label="Location" labelInline options={locationOptions} value={locationId} onChange={(v) => { setLocationId(v); setPage(0); }} />
          <Select
            label="View" labelInline
            options={[{ label: 'Table', value: 'table' }, { label: 'Calendar', value: 'calendar' }]}
            value={viewMode} onChange={setViewMode}
          />
          {viewMode === 'calendar' ? (
            <Select
              label="Metric" labelInline
              options={CALENDAR_METRICS.map((m) => ({ label: m.label, value: m.value }))}
              value={calendarMetric} onChange={setCalendarMetric}
            />
          ) : (
            <Checkbox
              label="Show empty days (0 in/out)"
              checked={showEmptyDays}
              onChange={(checked) => { setShowEmptyDays(checked); setPage(0); }}
            />
          )}
          <Button onClick={handleExport} disabled={filteredRows.length === 0}>Export CSV</Button>
        </InlineStack>
      </InlineStack>
      {viewMode === 'table' && (
        <InlineStack align="end" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" tone="subdued">Highlight</Text>
            <InlineStack gap="100" blockAlign="center" wrap={false}>
              <Text as="span" tone="subdued">Net Sales ≥ RM</Text>
              <TextField
                labelHidden label="Highlight Net Sales above"
                type="number" value={salesHighlight}
                onChange={(v) => setSalesHighlight(v)}
                autoComplete="off" placeholder="e.g. 500"
              />
            </InlineStack>
            <InlineStack gap="100" blockAlign="center" wrap={false}>
              <Text as="span" tone="subdued">Conversion Rate ≥</Text>
              <TextField
                labelHidden label="Highlight conversion rate above"
                type="number" value={conversionHighlight}
                onChange={(v) => setConversionHighlight(v)}
                autoComplete="off" placeholder="e.g. 10" suffix="%"
              />
            </InlineStack>
            <Button onClick={handleSaveHighlightDefaults} variant="plain">Save as default</Button>
          </InlineStack>
        </InlineStack>
      )}
      {error && <Banner tone="critical">{error.message}</Banner>}
      {isLoading ? <Spinner /> : viewMode === 'calendar' ? (
        allRows.length === 0
          ? <EmptyState heading="No foot traffic data for this range" image="" />
          : (
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" tone="subdued">Darker = higher {calendarMetricConfig.label.toLowerCase()}</Text>
              </InlineStack>
              {calendarMonths.map(({ year, month }) => (
                <Card key={`${year}-${month}`}>
                  <BlockStack gap="300">
                    <Text variant="headingSm">{MONTH_FORMATTER.format(new Date(Date.UTC(year, month, 1)))}</Text>
                    <InlineGrid columns={7} gap="100">
                      {WEEKDAY_LABELS.map((w) => (
                        <Text key={w} as="span" tone="subdued" alignment="center">{w}</Text>
                      ))}
                      {calendarCells(year, month).map((dateStr, i) => {
                        if (!dateStr) return <div key={`blank-${i}`} />;
                        const inRange = dateStr >= from && dateStr <= to;
                        const value = inRange ? dateAgg[dateStr]?.[calendarMetric] ?? null : null;
                        return (
                          <div
                            key={dateStr}
                            style={{
                              minHeight: 60,
                              borderRadius: 6,
                              border: '1px solid var(--p-color-border-secondary, #e3e3e3)',
                              padding: '6px',
                              opacity: inRange ? 1 : 0.35,
                              background: inRange ? heatBackground(value, calendarMax) : 'transparent',
                            }}
                          >
                            <Text as="span" tone="subdued">{Number(dateStr.slice(8, 10))}</Text>
                            {inRange && (
                              <Text as="p" fontWeight="semibold">{calendarMetricConfig.format(value)}</Text>
                            )}
                          </div>
                        );
                      })}
                    </InlineGrid>
                  </BlockStack>
                </Card>
              ))}
            </BlockStack>
          )
      ) : rows.length === 0
        ? <EmptyState heading="No foot traffic data for this range" image="" />
        : (
          <BlockStack gap="200">
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric']}
              headings={['Date', 'Day', 'Location', 'People In', 'People Out', 'Net', visitorsHeading, 'Net Sales', 'Orders', conversionRateHeading]}
              rows={rows}
              sortable={[true, true, true, true, true, true, true, true, true, true]}
              defaultSortDirection="descending"
              initialSortColumnIndex={sortIndex}
              onSort={handleSort}
            />
            {pageCount > 1 && (
              <Box paddingBlockStart="200">
                <InlineStack align="center">
                  <Pagination
                    hasPrevious={clampedPage > 0}
                    onPrevious={() => setPage(clampedPage - 1)}
                    hasNext={clampedPage < pageCount - 1}
                    onNext={() => setPage(clampedPage + 1)}
                    label={`Page ${clampedPage + 1} of ${pageCount}`}
                  />
                </InlineStack>
              </Box>
            )}
          </BlockStack>
        )
      }
      {toast && <Toast content={toast.message} onDismiss={() => setToast(null)} duration={2500} />}
    </BlockStack>
  );
}

// index into a replenishment line item — order matches the DataTable headings/columns
const REPL_SORT_FIELDS = [
  'vendor', 'productType', 'sku', 'productTitle', 'variantTitle', 'maxStock', 'soldQty', 'sourceQty', 'destQty', 'replQty',
];
const REPL_PAGE_SIZE = 50;

// Shopify's order.sourceName values this app labels explicitly — matches
// KNOWN_SALES_CHANNELS in backend/src/services/replenishmentReport.js. Anything
// else (a custom sales channel app) falls under "Other".
const SALES_CHANNEL_OPTIONS = [
  { label: 'All channels', value: '' },
  { label: 'Online Store', value: 'web' },
  { label: 'POS', value: 'pos' },
  { label: 'Draft Orders', value: 'shopify_draft_order' },
  { label: 'Other', value: 'other' },
];

// Filesystem/URL-safe stamp for filenames — e.g. "2026-09-29_0300".
function compactTimestamp(iso) {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}

function replQtyCell(replQty) {
  if (replQty == null) return '—';
  if (replQty > 0) return <Badge tone="attention">{String(replQty)}</Badge>;
  if (replQty < 0) return <Badge tone="critical">{String(replQty)}</Badge>;
  return '0';
}

// Friendly label for an individual order's sourceName, for the Sold Qty
// drill-down modal — unlike the aggregate SALES_CHANNEL_OPTIONS filter (which
// groups anything unrecognized under "Other"), an unrecognized value is shown
// as-is here since it's more informative per-order than a generic bucket.
const KNOWN_CHANNEL_LABELS = { web: 'Online Store', pos: 'POS', shopify_draft_order: 'Draft Order' };
function channelLabel(sourceName) {
  if (!sourceName) return '—';
  return KNOWN_CHANNEL_LABELS[sourceName] || sourceName;
}

// GID -> trailing numeric id, e.g. "gid://shopify/Order/123" -> "123" — for
// linking out to Shopify admin, which uses numeric ids in its own URLs.
function gidToNumericId(gid) {
  return gid ? gid.split('/').pop() : '';
}

function ReplenishmentReport() {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(() => isoDaysAgo(7));
  const [to, setTo] = useState(() => isoDaysAgo(0));
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destLocationId, setDestLocationId] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [productTypeFilter, setProductTypeFilter] = useState('');
  const [salesChannelFilter, setSalesChannelFilter] = useState('');
  const [posLocationFilter, setPosLocationFilter] = useState('');
  const [seededFromSettings, setSeededFromSettings] = useState(false);
  const [activeReportId, setActiveReportId] = useState(null);
  const [seededFromHistory, setSeededFromHistory] = useState(false);
  const [onlyNeeding, setOnlyNeeding] = useState(false);
  const [page, setPage] = useState(0);
  const [sortIndex, setSortIndex] = useState(9); // REPL QTY
  const [sortDirection, setSortDirection] = useState('descending');
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState(null);
  const [toast, setToast] = useState(null);
  const [salesDetailItem, setSalesDetailItem] = useState(null); // line item whose Sold Qty was clicked

  const { data: locationsData } = useQuery({ queryKey: ['locations'], queryFn: getLocations });
  const { data: vendorsData } = useQuery({ queryKey: ['vendors', { includeHidden: true }], queryFn: () => getVendors({ includeHidden: true }) });
  const { data: settingsData } = useQuery({
    queryKey: ['reports', 'replenishment-settings'],
    queryFn: getReplenishmentSettings,
  });
  const { data: historyData } = useQuery({
    queryKey: ['reports', 'replenishment-history'],
    queryFn: () => getReplenishmentReports({ limit: 30 }),
  });
  const { data: detailData, isLoading: detailLoading, error: detailError } = useQuery({
    queryKey: ['reports', 'replenishment-detail', activeReportId],
    queryFn: () => getReplenishmentReport(activeReportId),
    enabled: !!activeReportId,
  });

  const locations = locationsData?.data || [];
  const locationOptions = locations.map((l) => ({ label: l.name, value: l.id }));
  const posLocationOptions = [{ label: 'All locations', value: '' }, ...locationOptions];
  const locationsById = Object.fromEntries(locations.map((l) => [l.id, l.name]));
  const vendorOptions = [
    { label: 'All vendors', value: '' },
    ...(vendorsData || []).map((v) => ({ label: v.name, value: v.name })),
  ];
  const history = historyData?.data || [];

  // Seed the From/To location pickers from the saved schedule once, so a manual
  // run doesn't start from blank every time the settings already say which
  // locations this store uses. Only runs once — doesn't fight the user's own pick.
  useEffect(() => {
    if (seededFromSettings || !settingsData?.data) return;
    const s = settingsData.data;
    if (!s.sourceLocationId && !s.destLocationId) return;
    setSourceLocationId((cur) => cur || s.sourceLocationId || '');
    setDestLocationId((cur) => cur || s.destLocationId || '');
    setSeededFromSettings(true);
  }, [seededFromSettings, settingsData]);

  // Land on the most recently generated report on first load, if any exist.
  useEffect(() => {
    if (seededFromHistory || !history.length) return;
    setActiveReportId(history[0].id);
    setSeededFromHistory(true);
  }, [seededFromHistory, history]);

  const runMutation = useMutation({
    mutationFn: runReplenishmentReport,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['reports', 'replenishment-history'] });
      setActiveReportId(result.data.id);
      setPage(0);
      setToast({ message: 'Replenishment report generated' });
    },
  });

  const settingsMutation = useMutation({
    mutationFn: updateReplenishmentSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports', 'replenishment-settings'] });
      setScheduleModalOpen(false);
      setToast({ message: 'Schedule saved' });
    },
  });

  const openScheduleModal = useCallback(() => {
    const s = settingsData?.data || { enabled: false, periodDays: 7, sourceLocationId: '', destLocationId: '' };
    setScheduleForm({
      enabled: !!s.enabled,
      periodDays: String(s.periodDays ?? 7),
      sourceLocationId: s.sourceLocationId || '',
      destLocationId: s.destLocationId || '',
    });
    setScheduleModalOpen(true);
  }, [settingsData]);

  const handleRun = useCallback(() => {
    runMutation.mutate({
      from, to, sourceLocationId, destLocationId,
      vendor: vendorFilter || undefined,
      productType: productTypeFilter.trim() || undefined,
      salesChannel: salesChannelFilter || undefined,
      posLocationId: posLocationFilter || undefined,
    });
  }, [runMutation, from, to, sourceLocationId, destLocationId, vendorFilter, productTypeFilter, salesChannelFilter, posLocationFilter]);

  const handleSaveSchedule = useCallback(() => {
    settingsMutation.mutate(scheduleForm);
  }, [settingsMutation, scheduleForm]);

  const report = detailData?.data || null;
  const allLineItems = report?.lineItems || [];
  const filteredLineItems = onlyNeeding ? allLineItems.filter((li) => li.replQty > 0) : allLineItems;
  const sortedLineItems = [...filteredLineItems].sort((a, b) => {
    const dir = sortDirection === 'descending' ? -1 : 1;
    return compareFootTrafficRows(a, b, REPL_SORT_FIELDS[sortIndex]) * dir;
  });
  const pageCount = Math.max(1, Math.ceil(sortedLineItems.length / REPL_PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pagedLineItems = sortedLineItems.slice(clampedPage * REPL_PAGE_SIZE, clampedPage * REPL_PAGE_SIZE + REPL_PAGE_SIZE);

  const toCsvRow = (li) => [
    li.vendor || '—', li.productType || '—', li.sku || '—', li.productTitle || '—', li.variantTitle || '—',
    li.maxStock ?? '—', li.soldQty, li.sourceQty ?? '—', li.destQty ?? '—', li.replQty ?? '—',
  ];
  const headings = ['Vendor', 'Product Type', 'SKU', 'Product', 'Variant', 'Max Qty', 'Sold Qty', 'Source Qty', 'Dest Qty', 'REPL QTY'];
  const rows = pagedLineItems.map((li) => {
    const cells = toCsvRow(li);
    // Sold Qty is clickable when it has at least one contributing order to show.
    cells[6] = li.salesDetail?.length
      ? <Button variant="plain" onClick={() => setSalesDetailItem(li)}>{li.soldQty}</Button>
      : li.soldQty;
    cells[9] = replQtyCell(li.replQty);
    return cells;
  });

  const handleSort = useCallback((index, direction) => {
    setSortIndex(index);
    setSortDirection(direction);
    setPage(0);
  }, []);

  const handleExportCsv = useCallback(() => {
    if (!report) return;
    const stamp = compactTimestamp(report.generatedAt);
    downloadCSVFile(
      `replenishment_${report.fromDate.slice(0, 10)}_to_${report.toDate.slice(0, 10)}_generated-${stamp}.csv`,
      [
        ['Generated at', new Date(report.generatedAt).toLocaleString()],
        ['Source location', locationsById[report.sourceLocationId] || report.sourceLocationId],
        ['Destination location', locationsById[report.destLocationId] || report.destLocationId],
        ...(report.vendor ? [['Vendor filter', report.vendor]] : []),
        ...(report.productType ? [['Product Type filter', report.productType]] : []),
        ...(report.salesChannel ? [['Sales Channel filter', SALES_CHANNEL_OPTIONS.find((o) => o.value === report.salesChannel)?.label || report.salesChannel]] : []),
        ...(report.posLocationId ? [['POS Location filter', locationsById[report.posLocationId] || report.posLocationId]] : []),
        [],
        headings,
        ...sortedLineItems.map(toCsvRow),
      ]
    );
  }, [report, sortedLineItems, locationsById]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExportTransferCsv = useCallback(() => {
    if (!report) return;
    const stamp = compactTimestamp(report.generatedAt);
    const transferRows = sortedLineItems.filter((li) => li.replQty > 0 && li.sku);
    downloadCSVFile(
      `replenishment-transfer_${report.fromDate.slice(0, 10)}_to_${report.toDate.slice(0, 10)}_generated-${stamp}.csv`,
      [['sku', 'quantity'], ...transferRows.map((li) => [li.sku, li.replQty])]
    );
  }, [report, sortedLineItems]);

  const historyOptions = history.map((h) => ({
    label: `${h.fromDate.slice(0, 10)} → ${h.toDate.slice(0, 10)} · generated ${new Date(h.generatedAt).toLocaleString()} (${h.triggeredBy})`,
    value: h.id,
  }));

  const canRun = from && to && sourceLocationId && destLocationId && !runMutation.isPending;

  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center" wrap>
        <Text variant="headingMd">Replenishment</Text>
        <InlineStack gap="200" blockAlign="center" wrap>
          <InlineStack gap="100" blockAlign="center" wrap={false}>
            <Text as="span" tone="subdued">From</Text>
            <TextField labelHidden label="From" type="date" value={from} onChange={setFrom} autoComplete="off" />
          </InlineStack>
          <InlineStack gap="100" blockAlign="center" wrap={false}>
            <Text as="span" tone="subdued">To</Text>
            <TextField labelHidden label="To" type="date" value={to} onChange={setTo} autoComplete="off" />
          </InlineStack>
          <Select
            label="Source" labelInline placeholder="Pull from…"
            options={locationOptions} value={sourceLocationId} onChange={setSourceLocationId}
          />
          <Select
            label="Destination" labelInline placeholder="Top up…"
            options={locationOptions} value={destLocationId} onChange={setDestLocationId}
          />
          <Button onClick={handleRun} disabled={!canRun} loading={runMutation.isPending} variant="primary">
            Run report
          </Button>
          <Button onClick={openScheduleModal}>Schedule…</Button>
        </InlineStack>
      </InlineStack>

      <InlineStack gap="200" blockAlign="center" wrap>
        <Text as="span" tone="subdued">Filters</Text>
        <Select label="Vendor" labelInline options={vendorOptions} value={vendorFilter} onChange={setVendorFilter} />
        <TextField
          label="Product Type" labelHidden placeholder="Product Type"
          value={productTypeFilter} onChange={setProductTypeFilter} autoComplete="off"
        />
        <Select
          label="Sales Channel" labelInline options={SALES_CHANNEL_OPTIONS}
          value={salesChannelFilter} onChange={setSalesChannelFilter}
        />
        <Select
          label="POS Location" labelInline options={posLocationOptions}
          value={posLocationFilter} onChange={setPosLocationFilter}
        />
      </InlineStack>
      <Text as="span" tone="subdued">
        Vendor and Product Type narrow which rows appear. Sales Channel and POS Location narrow Sold Qty only (and, like the date range, which variants qualify for a row at all).
      </Text>

      {runMutation.error && <Banner tone="critical">{runMutation.error.message}</Banner>}

      {historyOptions.length > 0 && (
        <Select
          label="View report" labelInline
          options={historyOptions}
          value={activeReportId || ''}
          onChange={(v) => { setActiveReportId(v); setPage(0); }}
        />
      )}

      {detailError && <Banner tone="critical">{detailError.message}</Banner>}

      {!activeReportId ? (
        <EmptyState heading="No replenishment report yet" image="">
          <p>Pick a date range and locations, then click "Run report".</p>
        </EmptyState>
      ) : detailLoading ? (
        <Spinner />
      ) : report && (
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center" wrap>
            <BlockStack gap="050">
              <Text as="span" tone="subdued">
                Sales {report.fromDate.slice(0, 10)} – {report.toDate.slice(0, 10)} · Generated {new Date(report.generatedAt).toLocaleString()}
                {report.triggeredBy === 'cron' ? ' (scheduled)' : ' (manual)'}
              </Text>
              <Text as="span" tone="subdued">
                {locationsById[report.sourceLocationId] || report.sourceLocationId} → {locationsById[report.destLocationId] || report.destLocationId}
              </Text>
              {(report.vendor || report.productType || report.salesChannel || report.posLocationId) && (
                <Text as="span" tone="subdued">
                  Filters:{' '}
                  {[
                    report.vendor && `Vendor: ${report.vendor}`,
                    report.productType && `Product Type: ${report.productType}`,
                    report.salesChannel && `Channel: ${SALES_CHANNEL_OPTIONS.find((o) => o.value === report.salesChannel)?.label || report.salesChannel}`,
                    report.posLocationId && `POS Location: ${locationsById[report.posLocationId] || report.posLocationId}`,
                  ].filter(Boolean).join(' · ')}
                </Text>
              )}
            </BlockStack>
            <InlineStack gap="200" blockAlign="center">
              <Checkbox
                label="Only rows needing replenishment"
                checked={onlyNeeding}
                onChange={(checked) => { setOnlyNeeding(checked); setPage(0); }}
              />
              <Button onClick={handleExportCsv} disabled={allLineItems.length === 0}>Export CSV</Button>
              <Button onClick={handleExportTransferCsv} disabled={!allLineItems.some((li) => li.replQty > 0)}>
                Export Transfer CSV
              </Button>
            </InlineStack>
          </InlineStack>
          {rows.length === 0 ? (
            <EmptyState heading="No line items match" image="" />
          ) : (
            <BlockStack gap="200">
              <DataTable
                columnContentTypes={['text', 'text', 'text', 'text', 'text', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric']}
                headings={headings}
                rows={rows}
                sortable={[true, true, true, true, true, true, true, true, true, true]}
                defaultSortDirection="descending"
                initialSortColumnIndex={sortIndex}
                onSort={handleSort}
              />
              {pageCount > 1 && (
                <Box paddingBlockStart="200">
                  <InlineStack align="center">
                    <Pagination
                      hasPrevious={clampedPage > 0}
                      onPrevious={() => setPage(clampedPage - 1)}
                      hasNext={clampedPage < pageCount - 1}
                      onNext={() => setPage(clampedPage + 1)}
                      label={`Page ${clampedPage + 1} of ${pageCount}`}
                    />
                  </InlineStack>
                </Box>
              )}
            </BlockStack>
          )}
        </BlockStack>
      )}

      {scheduleModalOpen && scheduleForm && (
        <Modal
          open
          onClose={() => setScheduleModalOpen(false)}
          title="Weekly replenishment schedule"
          primaryAction={{ content: 'Save', onAction: handleSaveSchedule, loading: settingsMutation.isPending }}
          secondaryActions={[{ content: 'Cancel', onAction: () => setScheduleModalOpen(false) }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {settingsMutation.error && <Banner tone="critical">{settingsMutation.error.message}</Banner>}
              <Checkbox
                label="Automatically generate this report every Monday (03:00, store time)"
                checked={scheduleForm.enabled}
                onChange={(checked) => setScheduleForm((f) => ({ ...f, enabled: checked }))}
              />
              <TextField
                label="Sales period length (days)" type="number" autoComplete="off"
                value={scheduleForm.periodDays}
                onChange={(v) => setScheduleForm((f) => ({ ...f, periodDays: v }))}
                helpText="Each scheduled run covers this many days up to yesterday (store time)."
              />
              <Select
                label="Source location (pull from)" placeholder="Select a location"
                options={locationOptions} value={scheduleForm.sourceLocationId}
                onChange={(v) => setScheduleForm((f) => ({ ...f, sourceLocationId: v }))}
              />
              <Select
                label="Destination location (top up to Max Qty)" placeholder="Select a location"
                options={locationOptions} value={scheduleForm.destLocationId}
                onChange={(v) => setScheduleForm((f) => ({ ...f, destLocationId: v }))}
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {salesDetailItem && (
        <Modal
          open
          onClose={() => setSalesDetailItem(null)}
          title={`Sold Qty detail — ${salesDetailItem.sku || salesDetailItem.productTitle}`}
          primaryAction={{ content: 'Close', onAction: () => setSalesDetailItem(null) }}
        >
          <Modal.Section>
            <DataTable
              columnContentTypes={['text', 'text', 'numeric', 'text', 'text']}
              headings={['Order', 'Date', 'Quantity', 'Sales Channel', 'POS Location']}
              rows={(salesDetailItem.salesDetail || []).map((d) => [
                report?.shopifyAdminBase
                  ? <Link url={`${report.shopifyAdminBase}/orders/${gidToNumericId(d.orderId)}`} external>{d.orderName}</Link>
                  : d.orderName,
                new Date(d.createdAt).toLocaleString(),
                d.quantity,
                channelLabel(d.sourceName),
                d.locationName || 'Online',
              ])}
            />
          </Modal.Section>
        </Modal>
      )}

      {toast && <Toast content={toast.message} onDismiss={() => setToast(null)} duration={2500} />}
    </BlockStack>
  );
}

function Placeholder({ title }) {
  return <EmptyState heading={`${title} coming soon`} image=""><p>This report is not yet implemented.</p></EmptyState>;
}

const TABS = [
  { id: 'low-stock', content: 'Low Stock', path: 'low-stock' },
  { id: 'reorder', content: 'Reorder', path: 'reorder' },
  { id: 'stock-on-hand', content: 'Stock on Hand', path: 'stock-on-hand' },
  { id: 'purchase-orders', content: 'Purchase Orders', path: 'purchase-orders' },
  { id: 'foot-traffic', content: 'Foot Traffic', path: 'foot-traffic' },
  { id: 'replenishment', content: 'Replenishment', path: 'replenishment' },
  { id: 'abc', content: 'ABC Analysis', path: 'abc' },
  { id: 'best-sellers', content: 'Best Sellers', path: 'best-sellers' },
  { id: 'orders', content: 'Orders', path: 'orders' },
  { id: 'profit', content: 'Profit', path: 'profit' },
];

export default function Reports() {
  const navigate = useNavigate();
  const location = useLocation();

  const pathSegment = location.pathname.split('/').pop();
  const activeTab = Math.max(TABS.findIndex((t) => t.path === pathSegment), 0);

  const handleTabChange = useCallback((i) => {
    navigate(`/reports/${TABS[i].path}`);
  }, [navigate]);

  const content = () => {
    switch (TABS[activeTab]?.path) {
      case 'low-stock': return <SlowMovingReport />;
      case 'reorder': return <ReorderReport />;
      case 'stock-on-hand': return <StockOnHandReport />;
      case 'purchase-orders': return <POHistoryReport />;
      case 'foot-traffic': return <FootTrafficReport />;
      case 'replenishment': return <ReplenishmentReport />;
      default: return <Placeholder title={TABS[activeTab]?.content} />;
    }
  };

  return (
    <Page title="Reports" fullWidth={['foot-traffic', 'replenishment'].includes(TABS[activeTab]?.path)}>
      <Card padding="0">
        <Tabs tabs={TABS} selected={activeTab} onSelect={handleTabChange}>
          <div style={{ padding: '1.25rem' }}>{content()}</div>
        </Tabs>
      </Card>
    </Page>
  );
}
