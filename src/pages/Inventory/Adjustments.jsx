import React, { useState, useCallback } from 'react';
import {
  Page, Layout, Card, IndexTable, Text, Button, Badge,
  InlineStack, BlockStack, Banner, Spinner, Pagination, Box, Tabs,
} from '@shopify/polaris';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdjustments, deleteAdjustment } from '../../api/adjustments.js';

const TABS = [
  { id: 'open', content: 'Open' },
  { id: 'archived', content: 'Archived' },
];

const REASON_LABELS = {
  correction: 'Stock Correction',
  shrinkage: 'Stock Write-Off',
  damaged: 'Damaged / Tester Use',
  received: 'Supplier Return',
  cycle_count_available: 'Cycle Count',
  other: 'Other',
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Adjustments() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const [selectedTab, setSelectedTab] = useState(0);
  const tab = TABS[selectedTab].id;

  // ── Pagination ────────────────────────────────────────────────────────────
  const [cursorStack, setCursorStack] = useState([]);
  const [cursor, setCursor] = useState(null);
  const pageNum = cursorStack.length + 1;

  const handleTabChange = useCallback((idx) => {
    setSelectedTab(idx);
    setCursorStack([]);
    setCursor(null);
  }, []);

  const handleNext = useCallback((endCursor) => {
    setCursorStack((prev) => [...prev, cursor]);
    setCursor(endCursor);
  }, [cursor]);

  const handlePrev = useCallback(() => {
    setCursorStack((prev) => {
      const next = [...prev];
      setCursor(next.pop() ?? null);
      return next;
    });
  }, []);

  // ── Query ─────────────────────────────────────────────────────────────────
  const queryKey = ['adjustments', tab, cursor];
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => getAdjustments({ tab, first: 50, after: cursor || undefined }),
  });

  const adjustments = data?.adjustments ?? [];
  const pageInfo = data?.pageInfo ?? {};

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: deleteAdjustment,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adjustments'] }),
  });

  // ── Table ─────────────────────────────────────────────────────────────────
  const headings = [
    { id: 'no', title: 'No.' },
    { id: 'reason', title: 'Reason' },
    { id: 'notes', title: 'Notes' },
    { id: 'adjustedBy', title: 'Adjusted by' },
    { id: 'adjustedAt', title: 'Adjusted at' },
    { id: 'variants', title: 'Variants' },
    { id: 'actions', title: '' },
  ];

  return (
    <Page
      title="Stock Adjustments"
      primaryAction={{
        content: 'New adjustment',
        onAction: () => navigate('/inventory/adjustments/new'),
      }}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical">{error.message}</Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            <Tabs tabs={TABS} selected={selectedTab} onSelect={handleTabChange} fitted />

            {isLoading ? (
              <Box padding="800">
                <InlineStack align="center"><Spinner /></InlineStack>
              </Box>
            ) : (
              <IndexTable
                resourceName={{ singular: 'adjustment', plural: 'adjustments' }}
                itemCount={adjustments.length}
                headings={headings}
                selectable={false}
              >
                {adjustments.map((adj, index) => (
                  <IndexTable.Row
                    id={adj.id}
                    key={adj.id}
                    position={index}
                    onClick={() => navigate(`/inventory/adjustments/${adj.id}`)}
                  >
                    <IndexTable.Cell>
                      <Text variant="bodyMd" fontWeight="semibold">#{adj.adjNumber}</Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Text>{REASON_LABELS[adj.reason] ?? adj.reason}</Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Text tone="subdued">{adj.notes || '—'}</Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Text tone="subdued">{adj.adjustedBy || '—'}</Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Text tone="subdued">{fmtDate(adj.appliedAt)}</Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Text tone="subdued">{adj.variantCount}</Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      {adj.status === 'open' && (
                        <Button
                          size="micro"
                          tone="critical"
                          loading={deleteMutation.isPending && deleteMutation.variables === adj.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMutation.mutate(adj.id);
                          }}
                        >
                          Delete
                        </Button>
                      )}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}

            <Box padding="300" borderBlockStartWidth="025" borderColor="border">
              <InlineStack align="center">
                <Pagination
                  hasPrevious={cursorStack.length > 0}
                  onPrevious={handlePrev}
                  hasNext={!!pageInfo.hasNextPage}
                  onNext={() => handleNext(pageInfo.endCursor)}
                  label={`Page ${pageNum}`}
                />
              </InlineStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
