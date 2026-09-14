import React, { useState, useCallback } from 'react';
import {
  Page, Card, Tabs, DataTable, Text, Badge, Spinner, Button,
  Banner, EmptyState, InlineStack, BlockStack, Select, TextField, Tooltip, Icon, Pagination, Box,
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
  'date', 'locationName', 'peopleIn', 'peopleOut', 'net', 'visitors', 'netSales', 'orderCount', 'conversionRate',
];

function compareFootTrafficRows(a, b, field) {
  const av = a[field];
  const bv = b[field];
  if (av == null && bv == null) return 0;
  if (av == null) return -1; // nulls (e.g. no matching device) sort first
  if (bv == null) return 1;
  if (typeof av === 'string') return av.localeCompare(bv);
  return av - bv;
}

function FootTrafficReport() {
  const [from, setFrom] = useState(() => isoDaysAgo(30));
  const [to, setTo] = useState(() => isoDaysAgo(0));
  const [locationId, setLocationId] = useState('all');
  const [page, setPage] = useState(0);
  const [sortIndex, setSortIndex] = useState(0); // Date
  const [sortDirection, setSortDirection] = useState('descending');

  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', 'location-daily-sales', from, to],
    queryFn: () => getLocationDailySales({ from, to }),
  });
  const { data: locationsData } = useQuery({ queryKey: ['locations'], queryFn: getLocations });

  const allRows = data?.data || [];
  const locationOptions = [
    { label: 'All locations', value: 'all' },
    ...(locationsData?.data || []).map((l) => ({ label: l.name, value: l.id })),
  ];
  const filteredRows = locationId === 'all' ? allRows : allRows.filter((r) => r.locationId === locationId);

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

  const toRow = (r) => [
    r.date,
    r.locationName || '—',
    r.peopleIn ?? '—',
    r.peopleOut ?? '—',
    r.net ?? '—',
    r.visitors ?? '—',
    `RM ${Number(r.netSales).toFixed(2)}`,
    r.orderCount,
    r.conversionRate != null ? `${(r.conversionRate * 100).toFixed(1)}%` : '—',
  ];
  const rows = pagedRows.map(toRow);
  const headings = ['Date', 'Location', 'People In', 'People Out', 'Net', 'Visitors', 'Net Sales', 'Orders', 'Conversion Rate'];

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
      [headings, ...sortedRows.map(toRow)]
    );
  }, [sortedRows, from, to, locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center">
        <Text variant="headingMd">Foot Traffic</Text>
        <InlineStack gap="200">
          <TextField label="From" labelInline type="date" value={from} onChange={(v) => { setFrom(v); setPage(0); }} autoComplete="off" />
          <TextField label="To" labelInline type="date" value={to} onChange={(v) => { setTo(v); setPage(0); }} autoComplete="off" />
          <Select label="Location" labelInline options={locationOptions} value={locationId} onChange={(v) => { setLocationId(v); setPage(0); }} />
          <Button onClick={handleExport} disabled={filteredRows.length === 0}>Export CSV</Button>
        </InlineStack>
      </InlineStack>
      {error && <Banner tone="critical">{error.message}</Banner>}
      {isLoading ? <Spinner /> : rows.length === 0
        ? <EmptyState heading="No foot traffic data for this range" image="" />
        : (
          <BlockStack gap="200">
            <DataTable
              columnContentTypes={['text', 'text', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric']}
              headings={['Date', 'Location', 'People In', 'People Out', 'Net', visitorsHeading, 'Net Sales', 'Orders', conversionRateHeading]}
              rows={rows}
              sortable={[true, true, true, true, true, true, true, true, true]}
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
    <Page title="Reports">
      <Card padding="0">
        <Tabs tabs={TABS} selected={activeTab} onSelect={handleTabChange}>
          <div style={{ padding: '1.25rem' }}>{content()}</div>
        </Tabs>
      </Card>
    </Page>
  );
}
