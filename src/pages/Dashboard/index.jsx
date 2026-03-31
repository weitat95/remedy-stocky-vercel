import React from 'react';
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Divider,
  EmptyState,
} from '@shopify/polaris';
import { useQuery } from '@tanstack/react-query';
import { getPurchaseOrders } from '../../api/purchaseOrders.js';
import { getReorderReport } from '../../api/reports.js';

export default function Dashboard() {
  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => getPurchaseOrders(),
  });

  const { data: reorderData } = useQuery({
    queryKey: ['reports', 'reorder'],
    queryFn: () => getReorderReport(),
  });
  const reorderItems = reorderData?.data || [];

  const draftCount = purchaseOrders.filter((po) => po.status === 'draft').length;
  const sentCount = purchaseOrders.filter((po) => po.status === 'sent').length;
  const partialCount = purchaseOrders.filter(
    (po) => po.status === 'partially_received'
  ).length;

  return (
    <Page title="Dashboard">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">
              Overview
            </Text>
            <InlineStack gap="400" wrap>
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingSm" as="h3" tone="subdued">
                    Draft POs
                  </Text>
                  <Text variant="heading2xl" as="p">
                    {draftCount}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingSm" as="h3" tone="subdued">
                    Sent POs
                  </Text>
                  <Text variant="heading2xl" as="p">
                    {sentCount}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingSm" as="h3" tone="subdued">
                    Partially Received
                  </Text>
                  <Text variant="heading2xl" as="p">
                    {partialCount}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingSm" as="h3" tone="subdued">
                    Items to Reorder
                  </Text>
                  <Text variant="heading2xl" as="p" tone="critical">
                    {reorderItems.length}
                  </Text>
                </BlockStack>
              </Card>
            </InlineStack>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Recent Purchase Orders
              </Text>
              <Divider />
              {purchaseOrders.length === 0 ? (
                <EmptyState
                  heading="No purchase orders yet"
                  image=""
                >
                  <p>Create your first purchase order to get started.</p>
                </EmptyState>
              ) : (
                <BlockStack gap="300">
                  {purchaseOrders.slice(0, 5).map((po) => (
                    <InlineStack key={po.id} align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text variant="bodyMd" fontWeight="semibold">
                          {po.supplier?.name || 'Unknown Supplier'}
                        </Text>
                        <Text variant="bodySm" tone="subdued">
                          {new Date(po.createdAt).toLocaleDateString()}
                        </Text>
                      </BlockStack>
                      <Badge
                        tone={
                          po.status === 'received'
                            ? 'success'
                            : po.status === 'cancelled'
                            ? 'critical'
                            : po.status === 'sent'
                            ? 'info'
                            : 'attention'
                        }
                      >
                        {po.status.replace('_', ' ')}
                      </Badge>
                    </InlineStack>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {reorderItems.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2" tone="critical">
                  Reorder Alert
                </Text>
                <Divider />
                <BlockStack gap="200">
                  {reorderItems.slice(0, 5).map((item) => (
                    <InlineStack key={`${item.variantId}-${item.locationId}`} align="space-between">
                      <Text variant="bodyMd">{item.productTitle}</Text>
                      <Badge tone="critical">Qty: {item.available}</Badge>
                    </InlineStack>
                  ))}
                  {reorderItems.length > 5 && (
                    <Text variant="bodySm" tone="subdued">
                      +{reorderItems.length - 5} more items need reordering
                    </Text>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
