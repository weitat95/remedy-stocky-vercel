import React, { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Page, Layout, Card, IndexTable, Text, Badge, Button,
  InlineStack, BlockStack, Banner, Spinner, Divider,
  Box, InlineGrid, TextField,
} from '@shopify/polaris';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPODetail,
  clonePurchaseOrder,
  archivePurchaseOrder,
  undoReceivePO,
  updatePurchaseOrder,
} from '../../api/purchaseOrders.js';
import POForm from './POForm.jsx';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDatetime(d) {
  if (!d) return null;
  return new Date(d).toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtMoney(n) {
  if (n == null) return '—';
  return `RM ${parseFloat(n).toFixed(2)}`;
}

function statusTone(status) {
  switch (status) {
    case 'received': return 'success';
    case 'partially_received': return 'attention';
    case 'sent': return 'info';
    case 'cancelled': return 'critical';
    default: return undefined;
  }
}

function statusLabel(status) {
  if (status === 'partially_received') return 'Partial';
  if (status === 'sent') return 'Ordered';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function lineItemStatus(li) {
  if (li.quantityReceived >= li.quantity) return { label: 'Received', tone: 'success' };
  if (li.quantityReceived > 0) return { label: 'Partial', tone: 'attention' };
  return { label: 'Pending', tone: undefined };
}

function computeTotals(po) {
  const subtotal = (po.lineItems || []).reduce(
    (s, li) => s + (parseFloat(li.costPrice || 0) * li.quantity),
    0
  );
  const adjustments = parseFloat(po.adjustments || 0);
  const shipping = parseFloat(po.shippingCost || 0);
  const taxRate = parseFloat(po.taxRate || 0);
  const taxable = subtotal + adjustments + shipping;
  const tax = taxable * (taxRate / 100);
  const total = taxable + tax;
  return { subtotal, adjustments, shipping, taxRate, tax, total };
}

// ── CSV export ────────────────────────────────────────────────────────────────

function downloadCSV(po) {
  const headers = ['Product', 'Variant', 'SKU', 'Supplier Code', 'Text', 'Qty', 'Received', 'Cost', 'Retail', 'Total Cost'];
  const rows = (po.lineItems || []).map((li) => [
    li.productTitle || li.shopifyProductId,
    li.variantTitle !== 'Default Title' ? (li.variantTitle || '') : '',
    li.sku || '',
    li.supplierCode || '',
    li.textNote || '',
    li.quantity,
    li.quantityReceived,
    li.costPrice != null ? li.costPrice : '',
    li.retailPrice != null ? li.retailPrice : '',
    li.costPrice != null ? (parseFloat(li.costPrice) * li.quantity).toFixed(2) : '',
  ]);
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `PO-${po.poNumber || po.id.slice(-6)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── SideRow helper ────────────────────────────────────────────────────────────

function SideRow({ label, value, tone }) {
  return (
    <InlineStack align="space-between" blockAlign="center">
      <Text tone="subdued" variant="bodySm">{label}</Text>
      <Text tone={tone} variant="bodySm" fontWeight={tone === 'critical' ? 'semibold' : undefined}>{value}</Text>
    </InlineStack>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PODetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [notes, setNotes] = useState(null); // { poNotes, supplierNotes } — null = not dirty

  const { data: po, isLoading, error, refetch } = useQuery({
    queryKey: ['po-detail', id],
    queryFn: () => getPODetail(id),
    onSuccess: (data) => {
      // Sync note state on first load
      if (notes === null) {
        setNotes({ poNotes: data.poNotes || '', supplierNotes: data.supplierNotes || '' });
      }
    },
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    queryClient.invalidateQueries({ queryKey: ['po-detail', id] });
  }, [queryClient, id]);

  const cloneMutation = useMutation({
    mutationFn: () => clonePurchaseOrder(id),
    onSuccess: (cloned) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      navigate(`/purchase-orders/${cloned.id}`);
    },
  });
  const archiveMutation = useMutation({
    mutationFn: () => archivePurchaseOrder(id),
    onSuccess: () => { invalidate(); navigate('/purchase-orders'); },
  });
  const undoMutation = useMutation({
    mutationFn: () => undoReceivePO(id),
    onSuccess: invalidate,
  });
  const saveNotesMutation = useMutation({
    mutationFn: (payload) => updatePurchaseOrder(id, payload),
    onSuccess: invalidate,
  });

  const handleSaveNotes = useCallback(() => {
    saveNotesMutation.mutate({
      poNotes: notes.poNotes || null,
      supplierNotes: notes.supplierNotes || null,
    });
  }, [notes, saveNotesMutation]);

  // Sync notes when po loads / changes
  React.useEffect(() => {
    if (po && notes === null) {
      setNotes({ poNotes: po.poNotes || '', supplierNotes: po.supplierNotes || '' });
    }
  }, [po]);

  if (editMode && po) {
    return (
      <POForm
        existingPO={po}
        onClose={() => { setEditMode(false); refetch(); setNotes(null); }}
      />
    );
  }

  if (isLoading) {
    return (
      <Page backAction={{ content: 'Purchase Orders', onAction: () => navigate('/purchase-orders') }} title="Loading…">
        <Layout><Layout.Section><InlineStack align="center"><Spinner /></InlineStack></Layout.Section></Layout>
      </Page>
    );
  }

  if (error || !po) {
    return (
      <Page backAction={{ content: 'Purchase Orders', onAction: () => navigate('/purchase-orders') }} title="Error">
        <Banner tone="critical">{error?.message || 'PO not found'}</Banner>
      </Page>
    );
  }

  const totals = computeTotals(po);
  const hasReceived = po.lineItems?.some((li) => li.quantityReceived > 0);
  const notesDirty = notes !== null && (
    (notes.poNotes || '') !== (po.poNotes || '') ||
    (notes.supplierNotes || '') !== (po.supplierNotes || '')
  );

  const itemsTableHeadings = [
    { title: 'Product' }, { title: 'SKU' }, { title: 'Supplier Code' }, { title: 'Text 1' },
    { title: 'Status' }, { title: 'Received' }, { title: 'Retail' }, { title: 'Cost' },
    { title: 'Available' }, { title: 'Qty' },
  ];

  return (
    <Page
      title={`#${po.poNumber}`}
      titleMetadata={<Badge tone={statusTone(po.status)}>{statusLabel(po.status)}</Badge>}
      subtitle={`${po.supplier?.name || ''}${po.receiveLocationName ? ` → ${po.receiveLocationName}` : ''}`}
      backAction={{ content: 'Purchase Orders', onAction: () => navigate('/purchase-orders') }}
      primaryAction={{ content: 'Edit', onAction: () => setEditMode(true) }}
      secondaryActions={[
        { content: 'Download CSV', onAction: () => downloadCSV(po) },
        { content: 'Send', onAction: () => {} },
      ]}
      actionGroups={[
        {
          title: 'More',
          actions: [
            { content: 'Clone', onAction: () => cloneMutation.mutate() },
            { content: 'Archive', disabled: po.archived, onAction: () => archiveMutation.mutate() },
            { content: 'Undo Receive', disabled: !hasReceived, onAction: () => undoMutation.mutate() },
          ],
        },
      ]}
    >
      <Layout>
        {/* ── Left: Items + Notes + Files ─────────────────────────── */}
        <Layout.Section>

          {/* Items table */}
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: 'item', plural: 'items' }}
              itemCount={po.lineItems?.length || 0}
              headings={itemsTableHeadings}
              selectable={false}
            >
              {(po.lineItems || []).map((li, index) => {
                const { label: liStatusLabel, tone: liStatusTone } = lineItemStatus(li);
                const productName = li.productTitle || li.shopifyVariantId;
                const variantName = li.variantTitle && li.variantTitle !== 'Default Title' ? li.variantTitle : null;
                return (
                  <IndexTable.Row id={li.id} key={li.id} position={index}>
                    <IndexTable.Cell>
                      <BlockStack gap="050">
                        <Text variant="bodyMd" fontWeight="semibold">{productName}</Text>
                        {variantName && <Text variant="bodySm" tone="subdued">{variantName}</Text>}
                      </BlockStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text tone="subdued">{li.sku || '—'}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text tone="subdued">{li.supplierCode || '—'}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text tone="subdued">{li.textNote || '—'}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={liStatusTone}>{liStatusLabel}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text variant="bodySm" tone="subdued">
                        {li.receivedAt ? fmtDatetime(li.receivedAt) : '—'}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {fmtMoney(li.retailPrice)}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {fmtMoney(li.costPrice)}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {li.available != null ? li.available : '—'}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text fontWeight="semibold">{li.quantityReceived} / {li.quantity}</Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                );
              })}
            </IndexTable>
          </Card>

          {/* Notes */}
          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">Notes</Text>
                  {notesDirty && (
                    <Button
                      size="slim"
                      loading={saveNotesMutation.isPending}
                      onClick={handleSaveNotes}
                    >
                      Save notes
                    </Button>
                  )}
                </InlineStack>
                <InlineGrid columns={2} gap="400">
                  <TextField
                    label="PO Notes (supplier visible)"
                    multiline={4}
                    value={notes?.poNotes || ''}
                    onChange={(v) => setNotes((n) => ({ ...n, poNotes: v }))}
                    autoComplete="off"
                  />
                  <TextField
                    label="Supplier Notes (internal)"
                    multiline={4}
                    value={notes?.supplierNotes || ''}
                    onChange={(v) => setNotes((n) => ({ ...n, supplierNotes: v }))}
                    autoComplete="off"
                  />
                </InlineGrid>
              </BlockStack>
            </Card>
          </Box>

          {/* Files placeholder */}
          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="200">
                <Text variant="headingMd" as="h2">Files</Text>
                <Box
                  padding="400"
                  borderWidth="025"
                  borderColor="border"
                  borderRadius="200"
                  background="bg-surface-secondary"
                >
                  <InlineStack align="center">
                    <Text tone="subdued">File attachments — coming soon</Text>
                  </InlineStack>
                </Box>
              </BlockStack>
            </Card>
          </Box>

        </Layout.Section>

        {/* ── Right: Summary sidebar ───────────────────────────────── */}
        <Layout.Section variant="oneThird">

          {/* Payment */}
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Payment</Text>
              <Divider />
              <SideRow label="Amount paid" value={po.paid ? fmtMoney(totals.total) : 'RM 0.00'} />
              <SideRow
                label="Owed"
                value={po.paid ? 'RM 0.00' : fmtMoney(totals.total)}
                tone={!po.paid && totals.total > 0 ? 'critical' : undefined}
              />
              <SideRow label="Due" value={fmtDate(po.paymentDue)} />
              <Divider />
              <SideRow
                label="Status"
                value={po.paid ? '✓ Paid' : '✗ Unpaid'}
                tone={po.paid ? 'success' : undefined}
              />
              {po.paidAt && <SideRow label="Paid on" value={fmtDate(po.paidAt)} />}
            </BlockStack>
          </Card>

          {/* Totals */}
          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Totals</Text>
                <Divider />
                <SideRow label="Subtotal" value={fmtMoney(totals.subtotal)} />
                {totals.adjustments !== 0 && (
                  <SideRow label="Adjustments" value={fmtMoney(totals.adjustments)} />
                )}
                {totals.shipping > 0 && (
                  <SideRow label="Shipping" value={fmtMoney(totals.shipping)} />
                )}
                {totals.taxRate > 0 && (
                  <SideRow label={`Tax (${totals.taxRate}%)`} value={fmtMoney(totals.tax)} />
                )}
                <Divider />
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd" fontWeight="semibold">Total</Text>
                  <Text variant="bodyMd" fontWeight="semibold">{fmtMoney(totals.total)}</Text>
                </InlineStack>
              </BlockStack>
            </Card>
          </Box>

          {/* Shipment */}
          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Shipment</Text>
                <Divider />
                <SideRow label="Receive location" value={po.receiveLocationName || '—'} />
                <SideRow label="Invoice no." value={po.invoiceNo || '—'} />
                <SideRow label="Supplier order no." value={po.orderNo || '—'} />
                {po.shippingAddress && (
                  <>
                    <Divider />
                    <BlockStack gap="100">
                      <Text tone="subdued" variant="bodySm">Shipping address</Text>
                      <Text variant="bodySm">{po.shippingAddress}</Text>
                    </BlockStack>
                  </>
                )}
              </BlockStack>
            </Card>
          </Box>

          {/* Dates */}
          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Dates</Text>
                <Divider />
                <SideRow label="PO date" value={fmtDate(po.createdAt)} />
                <SideRow label="Invoice date" value={fmtDate(po.invoiceDate)} />
                <SideRow label="Expected" value={fmtDate(po.expectedAt)} />
                <SideRow label="Ship" value={fmtDate(po.shipDate)} />
                <SideRow label="Cancel" value={fmtDate(po.cancelDate)} />
              </BlockStack>
            </Card>
          </Box>

          {/* History */}
          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">History</Text>
                <Divider />
                <HistoryStep
                  label="Generated"
                  datetime={po.createdAt}
                  done
                />
                <HistoryStep
                  label="Confirmed"
                  datetime={po.orderedAt}
                  done={!!po.orderedAt}
                />
                <HistoryStep
                  label="Last received"
                  datetime={po.lineItems?.reduce((latest, li) => {
                    if (!li.receivedAt) return latest;
                    return !latest || new Date(li.receivedAt) > new Date(latest) ? li.receivedAt : latest;
                  }, null)}
                  done={hasReceived}
                />
              </BlockStack>
            </Card>
          </Box>

        </Layout.Section>
      </Layout>
    </Page>
  );
}

function HistoryStep({ label, datetime, done }) {
  return (
    <InlineStack gap="200" blockAlign="start">
      <Box minWidth="16px">
        <Text tone={done ? 'success' : 'subdued'}>{done ? '●' : '○'}</Text>
      </Box>
      <BlockStack gap="050">
        <Text variant="bodySm" fontWeight={done ? 'semibold' : undefined} tone={done ? undefined : 'subdued'}>
          {label}
        </Text>
        {datetime && (
          <Text variant="bodySm" tone="subdued">
            {new Date(datetime).toLocaleString('en-MY', {
              day: 'numeric', month: 'short', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </Text>
        )}
      </BlockStack>
    </InlineStack>
  );
}
