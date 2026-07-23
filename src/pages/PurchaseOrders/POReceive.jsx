import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Page, Layout, Card, IndexTable, Text, Button, Select,
  InlineStack, BlockStack, Banner, Spinner, Divider, Box,
  Checkbox, TextField, Badge,
} from '@shopify/polaris';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { receivePO } from '../../api/purchaseOrders.js';

const DEFAULT_LOC_KEY = 'defaultReceiveLocationId';

export default function POReceive({ po, onClose, onSuccess }) {
  const queryClient = useQueryClient();

  const receivableItems = useMemo(
    () => (po.lineItems || []).filter((li) => li.quantityReceived < li.quantity),
    [po.lineItems]
  );

  const savedDefault = localStorage.getItem(DEFAULT_LOC_KEY);
  const initialLocation = po.receiveLocationId || savedDefault || po.locations?.[0]?.id || '';

  const [locationId, setLocationId] = useState(initialLocation);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [rows, setRows] = useState(() =>
    receivableItems.map((li) => ({
      id: li.id,
      inventoryItemId: li.inventoryItemId,
      productTitle: li.productTitle,
      variantTitle: li.variantTitle,
      sku: li.sku,
      quantity: li.quantity,
      quantityReceived: li.quantityReceived,
      remaining: li.quantity - li.quantityReceived,
      toReceive: li.quantity - li.quantityReceived,
      checked: true,
    }))
  );

  // After a failed receive, some items in the batch may have already been applied
  // (the backend fails fast and persists each item as it succeeds). Once the
  // po-detail refetch below lands, resync rows from the corrected server state so a
  // retry only resends what's actually still outstanding — never the same quantity
  // twice against Shopify.
  const needsResyncRef = useRef(false);
  useEffect(() => {
    if (!needsResyncRef.current) return;
    needsResyncRef.current = false;
    setRows(
      receivableItems.map((li) => ({
        id: li.id,
        inventoryItemId: li.inventoryItemId,
        productTitle: li.productTitle,
        variantTitle: li.variantTitle,
        sku: li.sku,
        quantity: li.quantity,
        quantityReceived: li.quantityReceived,
        remaining: li.quantity - li.quantityReceived,
        toReceive: li.quantity - li.quantityReceived,
        checked: true,
      }))
    );
  }, [receivableItems]);

  const locationOptions = (po.locations || []).map((l) => ({ label: l.name, value: l.id }));

  const allChecked = rows.every((r) => r.checked);
  const someChecked = rows.some((r) => r.checked);
  const selectedCount = rows.filter((r) => r.checked && r.toReceive > 0).length;

  function toggleAll() {
    const next = !allChecked;
    setRows((prev) => prev.map((r) => ({ ...r, checked: next })));
  }

  function toggleRow(id) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, checked: !r.checked } : r)));
  }

  function setQty(id, val) {
    const n = Math.max(0, parseInt(val, 10) || 0);
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, toReceive: Math.min(n, r.remaining), checked: n > 0 } : r
      )
    );
  }

  const receiveMutation = useMutation({
    mutationFn: (payload) => receivePO(po.id, payload),
    onSuccess: () => {
      if (saveAsDefault && locationId) {
        localStorage.setItem(DEFAULT_LOC_KEY, locationId);
      }
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['po-detail', po.id] });
      onSuccess?.();
    },
    onError: () => {
      needsResyncRef.current = true;
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['po-detail', po.id] });
    },
  });

  const handleReceive = useCallback(() => {
    const items = rows
      .filter((r) => r.checked && r.toReceive > 0)
      .map((r) => ({
        lineItemId: r.id,
        quantityReceived: r.toReceive,
        inventoryItemId: r.inventoryItemId,
      }));
    if (!items.length) return;
    receiveMutation.mutate({ locationId, items });
  }, [rows, locationId, receiveMutation]);

  const headings = [
    { title: '' },
    { title: 'Product' },
    { title: 'SKU' },
    { title: 'Ordered', alignment: 'end' },
    { title: 'Received', alignment: 'end' },
    { title: 'Remaining', alignment: 'end' },
    { title: 'To Receive', alignment: 'end' },
  ];

  return (
    <Page
      title={`Receive PO #${po.poNumber}`}
      subtitle={po.supplier?.name}
      backAction={{ content: 'Back to PO', onAction: onClose }}
      primaryAction={{
        content: `Receive ${selectedCount > 0 ? `${selectedCount} item${selectedCount > 1 ? 's' : ''}` : ''}`,
        disabled: selectedCount === 0 || !locationId || receiveMutation.isPending,
        loading: receiveMutation.isPending,
        onAction: handleReceive,
      }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose }]}
    >
      <Layout>
        <Layout.Section>
          {receiveMutation.isError && (
            <Box paddingBlockEnd="400">
              <Banner tone="critical">{receiveMutation.error?.message || 'Receive failed'}</Banner>
            </Box>
          )}

          {receivableItems.length === 0 ? (
            <Card>
              <Text tone="subdued">All items have already been received.</Text>
            </Card>
          ) : (
            <Card padding="0">
              <IndexTable
                resourceName={{ singular: 'item', plural: 'items' }}
                itemCount={rows.length}
                headings={headings}
                selectable={false}
              >
                {/* Select-all header row */}
                <IndexTable.Row id="header-toggle" position={-1} key="header-toggle">
                  <IndexTable.Cell>
                    <Checkbox
                      label=""
                      labelHidden
                      checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                      onChange={toggleAll}
                    />
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text variant="bodySm" tone="subdued">Select all</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell /><IndexTable.Cell /><IndexTable.Cell /><IndexTable.Cell />
                  <IndexTable.Cell />
                </IndexTable.Row>

                {rows.map((row, index) => {
                  const variantName = row.variantTitle && row.variantTitle !== 'Default Title' ? row.variantTitle : null;
                  return (
                    <IndexTable.Row id={row.id} key={row.id} position={index} selected={row.checked}>
                      <IndexTable.Cell>
                        <Checkbox
                          label=""
                          labelHidden
                          checked={row.checked}
                          onChange={() => toggleRow(row.id)}
                        />
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <BlockStack gap="050">
                          <Text variant="bodyMd" fontWeight="semibold">
                            {row.productTitle || row.id}
                          </Text>
                          {variantName && <Text variant="bodySm" tone="subdued">{variantName}</Text>}
                        </BlockStack>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text tone="subdued">{row.sku || '—'}</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text alignment="end">{row.quantity}</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text alignment="end" tone="subdued">{row.quantityReceived}</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text alignment="end">{row.remaining}</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Box maxWidth="80px">
                          <TextField
                            label=""
                            labelHidden
                            type="number"
                            value={String(row.toReceive)}
                            min={0}
                            max={row.remaining}
                            onChange={(v) => setQty(row.id, v)}
                            autoComplete="off"
                          />
                        </Box>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>
            </Card>
          )}
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Receive into</Text>
              <Divider />
              {locationOptions.length > 0 ? (
                <Select
                  label="Location"
                  options={locationOptions}
                  value={locationId}
                  onChange={setLocationId}
                />
              ) : (
                <Text tone="subdued">No locations available</Text>
              )}
              <Checkbox
                label="Save as default location"
                checked={saveAsDefault}
                onChange={setSaveAsDefault}
              />
            </BlockStack>
          </Card>

          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Summary</Text>
                <Divider />
                <InlineStack align="space-between">
                  <Text tone="subdued" variant="bodySm">Selected items</Text>
                  <Text variant="bodySm">{selectedCount}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text tone="subdued" variant="bodySm">Total to receive</Text>
                  <Text variant="bodySm">
                    {rows.filter((r) => r.checked).reduce((s, r) => s + r.toReceive, 0)}
                  </Text>
                </InlineStack>
              </BlockStack>
            </Card>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
