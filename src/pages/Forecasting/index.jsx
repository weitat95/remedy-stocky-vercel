import React, { useState, useCallback } from 'react';
import {
  Page,
  Layout,
  Card,
  DataTable,
  Text,
  Select,
  InlineStack,
  Badge,
  Spinner,
  Banner,
  EmptyState,
  BlockStack,
} from '@shopify/polaris';
import { useQuery } from '@tanstack/react-query';
import { getForecasting } from '../../api/inventory.js';

const DAYS_OPTIONS = [
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 60 days', value: '60' },
  { label: 'Last 90 days', value: '90' },
];

function daysRemainingTone(days) {
  if (days === null || days === undefined) return undefined;
  if (days <= 7) return 'critical';
  if (days <= 14) return 'attention';
  if (days <= 30) return 'info';
  return 'success';
}

export default function Forecasting() {
  const [days, setDays] = useState('30');

  const { data: forecasts = [], isLoading, error } = useQuery({
    queryKey: ['forecasting', days],
    queryFn: () => getForecasting({ days: Number(days) }),
  });

  const handleDaysChange = useCallback((value) => setDays(value), []);

  const rows = forecasts.map((item) => [
    <BlockStack gap="100" key={item.variantId}>
      <Text variant="bodyMd" fontWeight="semibold">
        {item.productTitle || '—'}
      </Text>
      <Text variant="bodySm" tone="subdued">
        {item.variantTitle !== 'Default Title' ? item.variantTitle : ''}
        {item.sku ? ` · SKU: ${item.sku}` : ''}
      </Text>
    </BlockStack>,
    item.availableQuantity ?? '—',
    item.unitsSold ?? '—',
    item.velocity != null ? item.velocity.toFixed(2) : '—',
    item.daysOfStockRemaining != null ? (
      <Badge tone={daysRemainingTone(item.daysOfStockRemaining)}>
        {item.daysOfStockRemaining} days
      </Badge>
    ) : (
      <Badge>No sales data</Badge>
    ),
  ]);

  return (
    <Page
      title="Inventory Forecasting"
      subtitle="Sales velocity and estimated days of stock remaining"
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Failed to load forecasting data">
              <p>{error.message}</p>
            </Banner>
          </Layout.Section>
        )}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h2">
                  Velocity Report
                </Text>
                <Select
                  label="Look-back period"
                  labelInline
                  options={DAYS_OPTIONS}
                  value={days}
                  onChange={handleDaysChange}
                />
              </InlineStack>

              {isLoading ? (
                <InlineStack align="center">
                  <Spinner />
                </InlineStack>
              ) : forecasts.length === 0 ? (
                <EmptyState heading="No forecasting data available" image="">
                  <p>
                    Make sure your Shopify store has products with inventory levels
                    configured.
                  </p>
                </EmptyState>
              ) : (
                <DataTable
                  columnContentTypes={['text', 'numeric', 'numeric', 'numeric', 'text']}
                  headings={[
                    'Product / Variant',
                    'In Stock',
                    `Units Sold (${days}d)`,
                    'Velocity (units/day)',
                    'Days Remaining',
                  ]}
                  rows={rows}
                  sortable={[false, true, true, true, false]}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
