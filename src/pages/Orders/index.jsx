import React, { useState, useCallback, useMemo } from 'react';
import {
  Page, Layout, Card, IndexTable, Text, Badge, Button,
  InlineStack, BlockStack, Banner, Spinner, Pagination,
  TextField, Modal, ResourceList, ResourceItem, Box,
} from '@shopify/polaris';
import { SearchIcon } from '@shopify/polaris-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getOrders, linkPO, unlinkPO } from '../../api/orders.js';
import { getPurchaseOrders } from '../../api/purchaseOrders.js';

function numericId(gid) {
  return gid.replace('gid://shopify/Order/', '');
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusTone(status) {
  switch (status) {
    case 'received': return 'success';
    case 'sent': return 'info';
    case 'partially_received': return 'attention';
    case 'cancelled': return 'critical';
    default: return undefined;
  }
}

export default function Orders() {
  const queryClient = useQueryClient();

  // ── Pagination state (cursor stack) ──────────────────────────────────────
  const [cursorStack, setCursorStack] = useState([]); // cursors to go back
  const [cursor, setCursor] = useState(null);         // current page cursor
  const pageNum = cursorStack.length + 1;

  // ── Search ────────────────────────────────────────────────────────────────
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');

  const handleSearch = useCallback(() => {
    setCursorStack([]);
    setCursor(null);
    setSearch(searchDraft.trim());
  }, [searchDraft]);

  const handleSearchClear = useCallback(() => {
    setSearchDraft('');
    setSearch('');
    setCursorStack([]);
    setCursor(null);
  }, []);

  // ── Link PO modal state ───────────────────────────────────────────────────
  const [linkModal, setLinkModal] = useState(null); // { orderId (GID), orderName, linkedPOs }

  // ── Queries ───────────────────────────────────────────────────────────────
  const queryKey = ['orders', cursor, search];
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => getOrders({ after: cursor || undefined, search: search || undefined }),
  });

  const { data: allPOs = [] } = useQuery({
    queryKey: ['purchase-orders', false],
    queryFn: () => getPurchaseOrders(),
    enabled: !!linkModal,
  });

  const orders = data?.orders ?? [];
  const pageInfo = data?.pageInfo ?? {};
  const createOrderUrl = data?.createOrderUrl;

  // ── Mutations ─────────────────────────────────────────────────────────────
  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: ['orders'] }), [queryClient]);

  const linkMutation = useMutation({
    mutationFn: ({ orderId, poId }) => linkPO(numericId(orderId), poId),
    onSuccess: (_data, vars) => {
      invalidate();
      // Update modal state immediately
      setLinkModal((prev) => {
        if (!prev || prev.orderId !== vars.orderId) return prev;
        const po = allPOs.find((p) => p.id === vars.poId);
        return {
          ...prev,
          linkedPOs: [...prev.linkedPOs, {
            purchaseOrderId: vars.poId,
            poNumber: po?.poNumber,
            supplierName: po?.supplier?.name || '—',
            status: po?.status,
          }],
        };
      });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: ({ orderId, poId }) => unlinkPO(numericId(orderId), poId),
    onSuccess: (_data, vars) => {
      invalidate();
      setLinkModal((prev) => {
        if (!prev || prev.orderId !== vars.orderId) return prev;
        return { ...prev, linkedPOs: prev.linkedPOs.filter((p) => p.purchaseOrderId !== vars.poId) };
      });
    },
  });

  // ── Pagination handlers ───────────────────────────────────────────────────
  const handleNext = useCallback(() => {
    setCursorStack((prev) => [...prev, cursor]);
    setCursor(pageInfo.endCursor);
  }, [cursor, pageInfo.endCursor]);

  const handlePrev = useCallback(() => {
    setCursorStack((prev) => {
      const next = [...prev];
      setCursor(next.pop() ?? null);
      return next;
    });
  }, []);

  // ── Link modal helpers ────────────────────────────────────────────────────
  const openLinkModal = useCallback((order) => {
    setLinkModal({
      orderId: order.id,
      orderName: order.name,
      linkedPOs: [...order.linkedPOs],
    });
  }, []);

  const linkedPoIds = useMemo(() => new Set(linkModal?.linkedPOs?.map((p) => p.purchaseOrderId)), [linkModal]);
  const unlinkdPOs = useMemo(
    () => allPOs.filter((po) => !linkedPoIds.has(po.id)),
    [allPOs, linkedPoIds]
  );

  // ── Table ─────────────────────────────────────────────────────────────────
  const headings = [
    { title: 'Order No.' },
    { title: 'Date' },
    { title: 'Linked POs' },
    { title: 'Total (MYR)', alignment: 'end' },
  ];

  return (
    <Page
      title="Orders"
      subtitle="Read-only mirror of Shopify orders"
      primaryAction={createOrderUrl ? {
        content: 'Create order',
        url: createOrderUrl,
        external: true,
      } : undefined}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical">{error.message}</Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            {/* Search bar */}
            <Box padding="300" borderBlockEndWidth="025" borderColor="border">
              <InlineStack gap="200" blockAlign="center">
                <div style={{ flex: 1 }}>
                  <TextField
                    value={searchDraft}
                    onChange={setSearchDraft}
                    placeholder="Search by order number"
                    prefix={<SearchIcon />}
                    clearButton
                    onClearButtonClick={handleSearchClear}
                    autoComplete="off"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  />
                </div>
                <Button onClick={handleSearch}>Search</Button>
              </InlineStack>
            </Box>

            {isLoading ? (
              <Box padding="800">
                <InlineStack align="center"><Spinner /></InlineStack>
              </Box>
            ) : (
              <IndexTable
                resourceName={{ singular: 'order', plural: 'orders' }}
                itemCount={orders.length}
                headings={headings}
                selectable={false}
              >
                {orders.map((order, index) => (
                  <IndexTable.Row id={order.id} key={order.id} position={index}>
                    <IndexTable.Cell>
                      <Text variant="bodyMd" fontWeight="semibold">{order.name}</Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Text tone="subdued">{fmtDate(order.createdAt)}</Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <InlineStack gap="100" blockAlign="center" wrap>
                        {order.linkedPOs.map((po) => (
                          <Badge key={po.purchaseOrderId} tone={statusTone(po.status)}>
                            #{po.poNumber} {po.supplierName}
                          </Badge>
                        ))}
                        <Button
                          size="micro"
                          onClick={() => openLinkModal(order)}
                        >
                          {order.linkedPOs.length > 0 ? 'Edit' : '+ Link PO'}
                        </Button>
                      </InlineStack>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Text alignment="end">
                        {order.total != null
                          ? `${order.currency} ${parseFloat(order.total).toFixed(2)}`
                          : '—'}
                      </Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}

            {/* Pagination */}
            <Box padding="300" borderBlockStartWidth="025" borderColor="border">
              <InlineStack align="center">
                <Pagination
                  hasPrevious={cursorStack.length > 0}
                  onPrevious={handlePrev}
                  hasNext={!!pageInfo.hasNextPage}
                  onNext={handleNext}
                  label={`Page ${pageNum}`}
                />
              </InlineStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>

      {/* ── Link PO modal ──────────────────────────────────────────────── */}
      <Modal
        open={!!linkModal}
        onClose={() => setLinkModal(null)}
        title={`Linked POs — ${linkModal?.orderName}`}
        secondaryActions={[{ content: 'Done', onAction: () => setLinkModal(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {/* Currently linked */}
            {linkModal?.linkedPOs.length > 0 && (
              <BlockStack gap="200">
                <Text variant="headingSm">Linked</Text>
                {linkModal.linkedPOs.map((po) => (
                  <InlineStack key={po.purchaseOrderId} align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={statusTone(po.status)}>
                        #{po.poNumber}
                      </Badge>
                      <Text>{po.supplierName}</Text>
                    </InlineStack>
                    <Button
                      size="micro"
                      tone="critical"
                      loading={unlinkMutation.isPending && unlinkMutation.variables?.poId === po.purchaseOrderId}
                      onClick={() => unlinkMutation.mutate({ orderId: linkModal.orderId, poId: po.purchaseOrderId })}
                    >
                      Remove
                    </Button>
                  </InlineStack>
                ))}
              </BlockStack>
            )}

            {/* Add a PO */}
            {unlinkdPOs.length > 0 && (
              <BlockStack gap="200">
                <Text variant="headingSm">Add PO</Text>
                <ResourceList
                  resourceName={{ singular: 'order', plural: 'orders' }}
                  items={unlinkdPOs.slice(0, 20)}
                  renderItem={(po) => (
                    <ResourceItem
                      id={po.id}
                      onClick={() => linkMutation.mutate({ orderId: linkModal.orderId, poId: po.id })}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="050">
                          <Text fontWeight="semibold">#{po.poNumber} — {po.supplier?.name}</Text>
                          <Text tone="subdued" variant="bodySm">{po.status.replace(/_/g, ' ')}</Text>
                        </BlockStack>
                        <Button
                          size="micro"
                          loading={linkMutation.isPending && linkMutation.variables?.poId === po.id}
                        >
                          Link
                        </Button>
                      </InlineStack>
                    </ResourceItem>
                  )}
                />
              </BlockStack>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
