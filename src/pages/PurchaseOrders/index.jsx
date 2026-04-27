import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  Button,
  InlineStack,
  BlockStack,
  Banner,
  Spinner,
  EmptyState,
  InlineGrid,
  Box,
  Modal,
  TextField,
  FormLayout,
  ResourceList,
  ResourceItem,
} from '@shopify/polaris';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPurchaseOrders,
  deletePurchaseOrder,
  confirmPurchaseOrder,
  clonePurchaseOrder,
  archivePurchaseOrder,
} from '../../api/purchaseOrders.js';
import { getTaxRates, createTaxRate, updateTaxRate, deleteTaxRate } from '../../api/taxRates.js';
import POForm from './POForm.jsx';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: '2-digit' });
}

function poValue(po) {
  return (po.lineItems || []).reduce(
    (s, li) => s + (parseFloat(li.costPrice || 0) * li.quantity),
    0
  );
}

function receivedLabel(po) {
  const total = (po.lineItems || []).reduce((s, li) => s + li.quantity, 0);
  const received = (po.lineItems || []).reduce((s, li) => s + li.quantityReceived, 0);
  if (total === 0) return '—';
  return `${received} of ${total}`;
}

function receivedTone(po) {
  const total = (po.lineItems || []).reduce((s, li) => s + li.quantity, 0);
  const received = (po.lineItems || []).reduce((s, li) => s + li.quantityReceived, 0);
  if (total === 0) return undefined;
  if (received >= total) return 'success';
  if (received > 0) return 'attention';
  return undefined;
}

function statusTone(status) {
  switch (status) {
    case 'received': return 'success';
    case 'cancelled': return 'critical';
    case 'sent': return 'info';
    case 'partially_received': return 'attention';
    default: return undefined;
  }
}

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingPO, setEditingPO] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const { data: orders = [], isLoading, error } = useQuery({
    queryKey: ['purchase-orders', showArchived],
    queryFn: () => getPurchaseOrders(showArchived ? { includeArchived: 'true' } : {}),
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }),
    [queryClient]
  );

  const deleteMutation = useMutation({ mutationFn: deletePurchaseOrder, onSuccess: invalidate });
  const confirmMutation = useMutation({ mutationFn: confirmPurchaseOrder, onSuccess: invalidate });
  const cloneMutation = useMutation({ mutationFn: clonePurchaseOrder, onSuccess: invalidate });
  const archiveMutation = useMutation({ mutationFn: archivePurchaseOrder, onSuccess: invalidate });

  // ── Manage taxes modal ────────────────────────────────────────────────────
  const [taxesOpen, setTaxesOpen] = useState(false);
  const [newTaxName, setNewTaxName] = useState('');
  const [newTaxRate, setNewTaxRate] = useState('');
  const [editingTaxId, setEditingTaxId] = useState(null);
  const [editingTaxName, setEditingTaxName] = useState('');
  const [editingTaxRate, setEditingTaxRate] = useState('');

  const { data: taxRates = [] } = useQuery({
    queryKey: ['tax-rates'],
    queryFn: getTaxRates,
    enabled: taxesOpen,
  });

  const createTaxMutation = useMutation({
    mutationFn: () => createTaxRate({ name: newTaxName.trim(), rate: Number(newTaxRate) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-rates'] });
      setNewTaxName('');
      setNewTaxRate('');
    },
  });

  const updateTaxMutation = useMutation({
    mutationFn: ({ id, name, rate }) => updateTaxRate(id, { name, rate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-rates'] });
      setEditingTaxId(null);
    },
  });

  const deleteTaxMutation = useMutation({
    mutationFn: deleteTaxRate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tax-rates'] }),
  });

  const startEditTax = useCallback((t) => {
    setEditingTaxId(t.id);
    setEditingTaxName(t.name);
    setEditingTaxRate(String(t.rate));
  }, []);

  const cancelEditTax = useCallback(() => setEditingTaxId(null), []);

  const handleCreate = useCallback(() => { setEditingPO(null); setShowForm(true); }, []);
  const handleEdit = useCallback((po) => navigate(`/purchase-orders/${po.id}`), [navigate]);
  const handleFormClose = useCallback(() => {
    setShowForm(false);
    setEditingPO(null);
    invalidate();
  }, [invalidate]);

  const today = useMemo(() => new Date(), []);

  // Stats
  const stats = useMemo(() => {
    const active = orders.filter((o) => !o.archived);
    const draft = active.filter((o) => o.status === 'draft');
    const awaiting = active.filter(
      (o) => !o.paid && !['draft', 'cancelled'].includes(o.status) &&
        (!o.paymentDue || new Date(o.paymentDue) >= today)
    );
    const overdue = active.filter(
      (o) => !o.paid && !['draft', 'cancelled'].includes(o.status) &&
        o.paymentDue && new Date(o.paymentDue) < today
    );
    return {
      draft: { count: draft.length, value: draft.reduce((s, o) => s + poValue(o), 0) },
      awaiting: { count: awaiting.length, value: awaiting.reduce((s, o) => s + poValue(o), 0) },
      overdue: { count: overdue.length, value: overdue.reduce((s, o) => s + poValue(o), 0) },
    };
  }, [orders, today]);

  // Upcoming payments chart
  const chartData = useMemo(() => {
    const map = {};
    for (const o of orders) {
      if (o.paid || o.archived || ['draft', 'cancelled'].includes(o.status) || !o.paymentDue) continue;
      const date = o.paymentDue.split('T')[0];
      map[date] = (map[date] || 0) + poValue(o);
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date: fmtDate(date), value: parseFloat(value.toFixed(2)) }));
  }, [orders]);

  if (showForm) {
    return <POForm onClose={handleFormClose} existingPO={editingPO} />;
  }

  const headings = [
    { title: '#' },
    { title: 'Vendor' },
    { title: 'Invoice No.' },
    { title: 'Order No.' },
    { title: 'Generated' },
    { title: 'Ordered' },
    { title: 'Expected' },
    { title: 'Paid' },
    { title: 'Payment Due' },
    { title: 'Received' },
    { title: 'Actions' },
  ];

  return (
    <Page
      title="Purchase Orders"
      primaryAction={{ content: 'Create PO', onAction: handleCreate }}
      secondaryActions={[
        { content: showArchived ? 'Hide archived' : 'Show archived', onAction: () => setShowArchived((v) => !v) },
        { content: 'Manage taxes', onAction: () => setTaxesOpen(true) },
      ]}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical">{error.message}</Banner>
          </Layout.Section>
        )}

        {/* Stats */}
        <Layout.Section>
          <InlineGrid columns={3} gap="400">
            <StatCard
              title="Draft"
              count={stats.draft.count}
              value={stats.draft.value}
              tone={undefined}
            />
            <StatCard
              title="Awaiting Payment"
              count={stats.awaiting.count}
              value={stats.awaiting.value}
              tone="attention"
            />
            <StatCard
              title="Overdue"
              count={stats.overdue.count}
              value={stats.overdue.value}
              tone={stats.overdue.count > 0 ? 'critical' : undefined}
            />
          </InlineGrid>
        </Layout.Section>

        {/* Upcoming payments chart */}
        {chartData.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Upcoming payments</Text>
                <div style={{ width: '100%', height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} width={48} />
                      <Tooltip formatter={(v) => `RM${v.toFixed(2)}`} />
                      <Bar dataKey="value" fill="#008060" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Table */}
        <Layout.Section>
          <Card padding="0">
            {isLoading ? (
              <Box padding="400"><InlineStack align="center"><Spinner /></InlineStack></Box>
            ) : orders.length === 0 ? (
              <EmptyState heading="No purchase orders" action={{ content: 'Create PO', onAction: handleCreate }} image="">
                <p>Create a purchase order to track incoming inventory.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: 'order', plural: 'orders' }}
                itemCount={orders.length}
                headings={headings}
                selectable={false}
              >
                {orders.map((po, index) => {
                  const isDraft = po.status === 'draft';
                  const canDelete = isDraft || po.archived;
                  const total = (po.lineItems || []).reduce((s, li) => s + li.quantity, 0);
                  const received = (po.lineItems || []).reduce((s, li) => s + li.quantityReceived, 0);

                  return (
                    <IndexTable.Row id={po.id} key={po.id} position={index}>
                      <IndexTable.Cell>
                        <Text variant="bodyMd" fontWeight="semibold">
                          #{po.poNumber || po.id.slice(-4).toUpperCase()}
                        </Text>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <Button variant="plain" onClick={() => handleEdit(po)}>
                          {po.supplier?.name || '—'}
                        </Button>
                        <Box paddingBlockStart="050">
                          <Badge tone={statusTone(po.status)}>
                            {po.status.replace(/_/g, ' ')}
                          </Badge>
                        </Box>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <Text tone="subdued">{po.invoiceNo || '—'}</Text>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <Text tone="subdued">{po.orderNo || '—'}</Text>
                      </IndexTable.Cell>

                      <IndexTable.Cell>{fmtDate(po.createdAt)}</IndexTable.Cell>

                      <IndexTable.Cell>
                        {po.orderedAt ? fmtDate(po.orderedAt) : <Text tone="subdued">—</Text>}
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        {po.expectedAt ? fmtDate(po.expectedAt) : <Text tone="subdued">—</Text>}
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        {po.paid ? (
                          <Badge tone="success">✓ {po.paidAt ? fmtDate(po.paidAt) : 'Paid'}</Badge>
                        ) : (
                          <Text tone="subdued">✗</Text>
                        )}
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        {po.paymentDue ? (
                          <Text tone={!po.paid && new Date(po.paymentDue) < today ? 'critical' : undefined}>
                            {fmtDate(po.paymentDue)}
                          </Text>
                        ) : (
                          <Text tone="subdued">—</Text>
                        )}
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        {total > 0 ? (
                          <Badge tone={receivedTone(po)}>
                            {received} of {total}
                          </Badge>
                        ) : '—'}
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <InlineStack gap="100" wrap={false}>
                          {isDraft && (
                            <Button
                              size="micro"
                              tone="success"
                              loading={confirmMutation.isPending && confirmMutation.variables === po.id}
                              onClick={() => confirmMutation.mutate(po.id)}
                            >
                              Confirm
                            </Button>
                          )}
                          <Button
                            size="micro"
                            loading={cloneMutation.isPending && cloneMutation.variables === po.id}
                            onClick={() => cloneMutation.mutate(po.id)}
                          >
                            Clone
                          </Button>
                          {!po.archived && (
                            <Button
                              size="micro"
                              loading={archiveMutation.isPending && archiveMutation.variables === po.id}
                              onClick={() => archiveMutation.mutate(po.id)}
                            >
                              Archive
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              size="micro"
                              tone="critical"
                              loading={deleteMutation.isPending && deleteMutation.variables === po.id}
                              onClick={() => deleteMutation.mutate(po.id)}
                            >
                              Delete
                            </Button>
                          )}
                        </InlineStack>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>

      {/* ── Manage taxes modal ─────────────────────────────────────────── */}
      <Modal
        open={taxesOpen}
        onClose={() => setTaxesOpen(false)}
        title="Manage tax rates"
        secondaryActions={[{ content: 'Close', onAction: () => setTaxesOpen(false) }]}
      >
        <Modal.Section>
          <FormLayout>
            <FormLayout.Group>
              <TextField
                label="Name"
                value={newTaxName}
                onChange={setNewTaxName}
                autoComplete="off"
                placeholder="e.g. SST Sales 6%"
              />
              <TextField
                label="Rate (%)"
                type="number"
                value={newTaxRate}
                onChange={setNewTaxRate}
                autoComplete="off"
                suffix="%"
                placeholder="0"
              />
            </FormLayout.Group>
            <Button
              variant="primary"
              onClick={() => createTaxMutation.mutate()}
              loading={createTaxMutation.isPending}
              disabled={!newTaxName.trim() || newTaxRate === ''}
            >
              Add tax rate
            </Button>
          </FormLayout>
        </Modal.Section>

        <Modal.Section flush>
          <ResourceList
            resourceName={{ singular: 'tax rate', plural: 'tax rates' }}
            items={taxRates}
            renderItem={(t) => (
              <ResourceItem
                id={t.id}
                shortcutActions={
                  editingTaxId !== t.id
                    ? [
                        { content: 'Edit', onAction: () => startEditTax(t) },
                        { content: 'Delete', destructive: true, onAction: () => deleteTaxMutation.mutate(t.id) },
                      ]
                    : []
                }
              >
                {editingTaxId === t.id ? (
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{ flex: 2 }}>
                      <TextField
                        value={editingTaxName}
                        onChange={setEditingTaxName}
                        autoComplete="off"
                        onKeyDown={(e) => e.key === 'Escape' && cancelEditTax()}
                      />
                    </div>
                    <div style={{ width: 90 }}>
                      <TextField
                        type="number"
                        value={editingTaxRate}
                        onChange={setEditingTaxRate}
                        autoComplete="off"
                        suffix="%"
                      />
                    </div>
                    <Button
                      size="slim"
                      variant="primary"
                      loading={updateTaxMutation.isPending}
                      disabled={!editingTaxName.trim() || editingTaxRate === ''}
                      onClick={() => updateTaxMutation.mutate({ id: t.id, name: editingTaxName, rate: Number(editingTaxRate) })}
                    >
                      Save
                    </Button>
                    <Button size="slim" onClick={cancelEditTax}>Cancel</Button>
                  </InlineStack>
                ) : (
                  <InlineStack gap="400">
                    <Text variant="bodyMd" fontWeight="semibold">{t.name}</Text>
                    <Text tone="subdued">{t.rate}%</Text>
                  </InlineStack>
                )}
              </ResourceItem>
            )}
          />
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function StatCard({ title, count, value, tone }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text variant="bodySm" tone="subdued">{title}</Text>
        <Text variant="headingLg" tone={tone}>{count}</Text>
        {value > 0 && (
          <Text variant="bodySm" tone="subdued">RM {value.toFixed(2)}</Text>
        )}
      </BlockStack>
    </Card>
  );
}
