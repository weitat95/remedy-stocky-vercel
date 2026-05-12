import React, { useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Page, Layout, Card, IndexTable, Text, Badge, Button, Link,
  InlineStack, BlockStack, Banner, Spinner, Divider,
  Box, InlineGrid, TextField, Icon, Toast, Frame,
} from '@shopify/polaris';
import { AttachmentIcon, DeleteIcon } from '@shopify/polaris-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPODetail,
  clonePurchaseOrder,
  archivePurchaseOrder,
  undoReceivePO,
  updatePurchaseOrder,
  sendPOEmail,
} from '../../api/purchaseOrders.js';
import { getTaxRates } from '../../api/taxRates.js';
import { getPOAttachments, uploadPOAttachment, deletePOAttachment } from '../../api/poAttachments.js';
import { downloadPOPdf, getPOPdfBase64 } from '../../utils/generatePOPdf.js';
import POForm from './POForm.jsx';
import POReceive from './POReceive.jsx';

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
  const lineItems = po.lineItems || [];
  const subtotal = lineItems.reduce(
    (s, li) => s + (parseFloat(li.costPrice || 0) * li.quantity),
    0
  );
  const tax = lineItems.reduce((s, li) => {
    const lineCost = parseFloat(li.costPrice || 0) * li.quantity;
    return s + lineCost * (parseFloat(li.taxRate || 0) / 100);
  }, 0);
  const adjustments = parseFloat(po.adjustments || 0);
  const shipping = parseFloat(po.shippingCost || 0);
  const total = subtotal + tax + adjustments + shipping;
  return { subtotal, tax, adjustments, shipping, total };
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
  const [receiveMode, setReceiveMode] = useState(false);
  const [notes, setNotes] = useState(null); // { poNotes, supplierNotes } — null = not dirty
  const [toast, setToast] = useState(null); // { message, error? }

  const { data: taxRates = [] } = useQuery({ queryKey: ['tax-rates'], queryFn: getTaxRates });
  const taxNameMap = Object.fromEntries(
    taxRates.map((t) => [String(parseFloat(t.rate)), t.name])
  );

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
  const sendMutation = useMutation({
    mutationFn: (pdfBase64) => sendPOEmail(id, pdfBase64),
    onSuccess: (data) => setToast({ message: `Sent to ${data.to}` }),
    onError: (err) => setToast({ message: err.message || 'Failed to send', error: true }),
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

  if (receiveMode && po) {
    return (
      <POReceive
        po={po}
        onClose={() => setReceiveMode(false)}
        onSuccess={() => {
          setReceiveMode(false);
          setToast({ message: 'Items received and synced to Shopify' });
        }}
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
  const isReceivable = ['sent', 'partially_received'].includes(po.status);
  const hasUnreceived = po.lineItems?.some((li) => li.quantityReceived < li.quantity);
  const notesDirty = notes !== null && (
    (notes.poNotes || '') !== (po.poNotes || '') ||
    (notes.supplierNotes || '') !== (po.supplierNotes || '')
  );

  const itemsTableHeadings = [
    { title: 'Product' }, { title: 'SKU' }, { title: 'Supplier Code' }, { title: 'Text 1' },
    { title: 'Status' }, { title: 'Received' }, { title: 'Retail' }, { title: 'Cost' },
    { title: 'Tax %' }, { title: 'Available' }, { title: 'Qty' },
  ];

  return (
    <Frame>
    {toast && (
      <Toast
        content={toast.message}
        error={toast.error}
        onDismiss={() => setToast(null)}
      />
    )}
    <Page
      title={`#${po.poNumber}`}
      titleMetadata={<Badge tone={statusTone(po.status)}>{statusLabel(po.status)}</Badge>}
      subtitle={`${po.supplier?.name || ''}${po.receiveLocationName ? ` → ${po.receiveLocationName}` : ''}`}
      backAction={{ content: 'Purchase Orders', onAction: () => navigate('/purchase-orders') }}
      primaryAction={
        isReceivable && hasUnreceived
          ? { content: 'Receive', onAction: () => setReceiveMode(true) }
          : { content: 'Edit', onAction: () => setEditMode(true) }
      }
      secondaryActions={[
        { content: 'Download PDF', onAction: () => downloadPOPdf(po) },
        { content: 'Download CSV', onAction: () => downloadCSV(po) },
        {
          content: sendMutation.isPending ? 'Sending…' : 'Send',
          disabled: !po.supplier?.email || sendMutation.isPending,
          helpText: !po.supplier?.email ? 'Supplier has no email address' : undefined,
          onAction: () => sendMutation.mutate(getPOPdfBase64(po)),
        },
      ]}
      actionGroups={[
        {
          title: 'More',
          actions: [
            ...(isReceivable && hasUnreceived ? [{ content: 'Edit', onAction: () => setEditMode(true) }] : []),
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
                      <Text tone="subdued">
                        {li.taxRate != null && li.taxRate !== 0
                          ? (taxNameMap[String(parseFloat(li.taxRate))] ?? `${li.taxRate}%`)
                          : '—'}
                      </Text>
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

          {/* Files */}
          <Box paddingBlockStart="400">
            <POAttachments poId={id} />
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
                {totals.tax > 0 && (
                  <SideRow label="Tax" value={fmtMoney(totals.tax)} />
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
    </Frame>
  );
}

function POAttachments({ poId }) {
  const fileInputRef = useRef(null);
  const queryClient = useQueryClient();

  const { data: { attachments = [], r2Configured = true } = {}, isLoading } = useQuery({
    queryKey: ['po-attachments', poId],
    queryFn: () => getPOAttachments(poId),
  });

  const uploadMutation = useMutation({
    mutationFn: (file) => uploadPOAttachment(poId, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['po-attachments', poId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (attachmentId) => deletePOAttachment(poId, attachmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['po-attachments', poId] }),
  });

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    e.target.value = '';
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingMd" as="h2">Files</Text>
          {r2Configured && (
            <Button
              size="slim"
              icon={AttachmentIcon}
              loading={uploadMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              Attach file
            </Button>
          )}
        </InlineStack>

        {r2Configured && (
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        )}

        {uploadMutation.isError && (
          <Banner tone="critical">{uploadMutation.error?.message || 'Upload failed'}</Banner>
        )}

        {isLoading ? (
          <InlineStack align="center"><Spinner size="small" /></InlineStack>
        ) : attachments.length === 0 ? (
          <Box
            padding="400"
            borderWidth="025"
            borderColor="border"
            borderRadius="200"
            background="bg-surface-secondary"
          >
            <InlineStack align="center">
              <Text tone="subdued">No files attached</Text>
            </InlineStack>
          </Box>
        ) : (
          <BlockStack gap="200">
            {attachments.map((a) => (
              <Box
                key={a.id}
                padding="300"
                borderWidth="025"
                borderColor="border"
                borderRadius="200"
                background="bg-surface-secondary"
              >
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={AttachmentIcon} tone="subdued" />
                    <BlockStack gap="050">
                      <Link url={a.url} external>
                        {a.fileName}
                      </Link>
                      <Text variant="bodySm" tone="subdued">
                        {fmtSize(a.fileSize)} · {new Date(a.uploadedAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <Button
                    size="slim"
                    tone="critical"
                    icon={DeleteIcon}
                    loading={deleteMutation.isPending && deleteMutation.variables === a.id}
                    onClick={() => deleteMutation.mutate(a.id)}
                    accessibilityLabel="Delete attachment"
                  />
                </InlineStack>
              </Box>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
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
