import React, { useState, useCallback } from 'react';
import {
  Page, Card, Tabs, DataTable, Text, Badge, Spinner,
  Banner, EmptyState, InlineStack, BlockStack, Select, TextField,
} from '@shopify/polaris';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useLocation, Routes, Route } from 'react-router-dom';
import { getSlowMoving, getReorderReport, getPOHistory, getStockOnHand } from '../../api/reports.js';

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

function Placeholder({ title }) {
  return <EmptyState heading={`${title} coming soon`} image=""><p>This report is not yet implemented.</p></EmptyState>;
}

const TABS = [
  { id: 'low-stock', content: 'Low Stock', path: 'low-stock' },
  { id: 'reorder', content: 'Reorder', path: 'reorder' },
  { id: 'stock-on-hand', content: 'Stock on Hand', path: 'stock-on-hand' },
  { id: 'purchase-orders', content: 'Purchase Orders', path: 'purchase-orders' },
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
