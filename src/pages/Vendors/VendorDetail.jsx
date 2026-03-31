import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Page,
  Layout,
  Card,
  DataTable,
  Text,
  Badge,
  Spinner,
  Banner,
  BlockStack,
  InlineStack,
  EmptyState,
} from '@shopify/polaris';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { getVendorUsage } from '../../api/vendors.js';

function gradeTone(grade) {
  if (grade === 'A') return 'success';
  if (grade === 'B') return 'attention';
  return undefined;
}

function fmt(n, decimals = 0) {
  if (n == null) return '—';
  return Number(n).toFixed(decimals);
}

function fmtMoney(n) {
  if (n == null) return '—';
  return `RM${Number(n).toFixed(2)}`;
}

function shortWeek(isoDate) {
  // e.g. "2025-12-30" → "Dec 30"
  const d = new Date(isoDate + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function VendorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['vendor-usage', id],
    queryFn: () => getVendorUsage(id),
  });

  const vendor = data?.vendor;
  const weeklyChart = data?.weeklyChart ?? [];
  const rows = data?.rows ?? [];

  const chartData = weeklyChart.map((w) => ({
    week: shortWeek(w.weekStart),
    units: w.units,
  }));

  const tableRows = rows.map((row) => [
    <Badge key={row.variantId} tone={gradeTone(row.grade)}>{row.grade}</Badge>,
    <Text key={`pt-${row.variantId}`} variant="bodyMd">{row.productTitle}</Text>,
    <Text key={`vt-${row.variantId}`} tone="subdued">
      {row.variantTitle === 'Default Title' ? '—' : row.variantTitle}
    </Text>,
    row.sku || '—',
    fmtMoney(row.costPrice),
    `${fmtMoney(row.revenuePerDay)}/day`,
    `${row.elt}d`,
    fmt(row.estimatedDemand),
    row.daysToDepletion != null ? `${row.daysToDepletion}d` : '—',
    `${row.available} avail`,
    `${row.onOrder} ord`,
    `${row.needed} needed`,
  ]);

  return (
    <Page
      title={vendor?.name ?? 'Vendor'}
      subtitle={`ID: ${id}`}
      backAction={{ content: 'Vendors', onAction: () => navigate('/vendors') }}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical">{error.message}</Banner>
          </Layout.Section>
        )}

        {isLoading ? (
          <Layout.Section>
            <InlineStack align="center"><Spinner /></InlineStack>
          </Layout.Section>
        ) : (
          <>
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">Sales — units/week (last 4 months)</Text>
                  {chartData.every((d) => d.units === 0) ? (
                    <Text tone="subdued">No sales in the last 4 months.</Text>
                  ) : (
                    <div style={{ width: '100%', height: 200 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis
                            dataKey="week"
                            tick={{ fontSize: 11 }}
                            interval={1}
                          />
                          <YAxis
                            allowDecimals={false}
                            tick={{ fontSize: 11 }}
                            width={32}
                          />
                          <Tooltip />
                          <Bar dataKey="units" fill="#008060" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card padding="0">
                {rows.length === 0 ? (
                  <EmptyState heading="No products found for this vendor" image="">
                    <p>Sync vendors from the Vendors list to populate products.</p>
                  </EmptyState>
                ) : (
                  <DataTable
                    columnContentTypes={[
                      'text', 'text', 'text', 'text', 'numeric',
                      'numeric', 'text', 'numeric', 'text',
                      'text', 'text', 'text',
                    ]}
                    headings={[
                      'Grade', 'Product', 'Variant', 'SKU', 'Cost Price',
                      'Revenue/Day', 'ELT', 'Est.', 'Dep.',
                      'Available', 'Ord.', 'Need',
                    ]}
                    rows={tableRows}
                    truncate
                  />
                )}
              </Card>
            </Layout.Section>
          </>
        )}
      </Layout>
    </Page>
  );
}
