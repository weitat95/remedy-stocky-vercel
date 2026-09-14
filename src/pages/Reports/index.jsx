import React, { useState, useCallback } from 'react';
import {
  Page, Card, Tabs, DataTable, Text, Badge, Spinner, Button, Checkbox,
  Banner, EmptyState, InlineStack, BlockStack, Select, TextField, Tooltip, Icon, Pagination, Box, InlineGrid,
} from '@shopify/polaris';
import { QuestionCircleIcon } from '@shopify/polaris-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useLocation, Routes, Route } from 'react-router-dom';
import { getSlowMoving, getReorderReport, getPOHistory, getStockOnHand, getLocationDailySales } from '../../api/reports.js';
import { getLocations } from '../../api/inventory.js';
import { downloadCSVFile } from '../../utils/csv.js';

const FOOT_TRAFFIC_PAGE_SIZE = 50;

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
  const [salesHighlight, setSalesHighlight] = useState('');
  const [conversionHighlight, setConversionHighlight] = useState('');
  const [showEmptyDays, setShowEmptyDays] = useState(false);
  const [viewMode, setViewMode] = useState('table');
  const [calendarMetric, setCalendarMetric] = useState('visitors');

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
      default: return <Placeholder title={TABS[activeTab]?.content} />;
    }
  };

  return (
    <Page title="Reports" fullWidth={TABS[activeTab]?.path === 'foot-traffic'}>
      <Card padding="0">
        <Tabs tabs={TABS} selected={activeTab} onSelect={handleTabChange}>
          <div style={{ padding: '1.25rem' }}>{content()}</div>
        </Tabs>
      </Card>
    </Page>
  );
}
