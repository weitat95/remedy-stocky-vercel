import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Page,
  Layout,
  Card,
  ResourceList,
  ResourceItem,
  Text,
  Badge,
  InlineStack,
  BlockStack,
  Button,
  Modal,
  FormLayout,
  TextField,
  Select,
  Autocomplete,
  Icon,
  Divider,
  EmptyState,
  Spinner,
  Banner,
  Box,
  Checkbox,
} from '@shopify/polaris';
import { ImportIcon, SearchIcon, DeleteIcon } from '@shopify/polaris-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getTransfers,
  createTransfer,
  confirmTransfer,
  deleteTransfer,
  reverseTransfer,
} from '../../api/transfers.js';
import { getLocations } from '../../api/inventory.js';
import { getProducts } from '../../api/products.js';
import { parseCSV, downloadCSVFile } from '../../utils/csv.js';
import SkuMatchModal from '../../components/SkuMatchModal.jsx';

function matchLabel(product, variant) {
  const name = product.variants.length === 1 ? product.title : `${product.title} — ${variant.title}`;
  return `${name} (SKU: ${variant.sku})`;
}

const TRANSFER_CSV_EXAMPLE = [
  ['sku', 'quantity'],
  ['SKU-001', '10'],
  ['SKU-002', '5'],
  ['SKU-003', '20'],
];

function statusTone(status) {
  switch (status) {
    case 'received': return 'success';
    case 'in_transit': return 'info';
    case 'pending': return 'attention';
    default: return undefined;
  }
}

// { shopifyVariantId, productTitle, variantTitle, sku, quantity }
const EMPTY_LINE_ITEM = { shopifyVariantId: '', productTitle: '', variantTitle: '', sku: '', quantity: '' };

export default function Transfers() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState(null);
  const [reversePreview, setReversePreview] = useState(null); // transfer being reversed

  // Form state
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [lineItems, setLineItems] = useState([{ ...EMPTY_LINE_ITEM }]);

  // CSV import
  const csvFileRef = useRef(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState(null); // { added, skipped, notFound }
  const [csvSkipArchived, setCsvSkipArchived] = useState(true);

  // Ambiguous SKU matches (duplicate SKU across active products)
  const [ambiguous, setAmbiguous] = useState([]); // [{ sku, quantity, matches: [{product, variant}] }]
  const [ambiguousSelections, setAmbiguousSelections] = useState({}); // { [sku]: variantId }

  const buildRowFromMatch = useCallback((product, variant, quantity) => ({
    shopifyVariantId: variant.id,
    productTitle: product.title,
    variantTitle: product.variants.length === 1 ? '' : variant.title,
    sku: variant.sku ?? '',
    quantity,
  }), []);

  const handleCsvFileSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setCsvImporting(true);
    setCsvResult(null);
    setFormError(null);
    try {
      const rows = parseCSV(await file.text());
      if (rows.length === 0) return;
      const firstRow = rows[0];
      const qtyKey = 'quantity' in firstRow ? 'quantity' : 'qty' in firstRow ? 'qty' : null;
      if (!('sku' in firstRow) || !qtyKey) {
        setFormError('CSV must have "sku" and "quantity" columns.');
        return;
      }
      const lookups = await Promise.all(
        rows.map(async (row) => {
          const sku = row.sku?.trim();
          if (!sku) return null;
          const quantity = row[qtyKey]?.trim() ?? '';
          // status: '-archived' excludes discontinued/archived lookalike SKUs
          // (e.g. "ABC123-DISCON" for a search on "ABC123") at the Shopify query
          // level, while still matching active/draft products. We still only
          // accept an exact SKU match among the results — never fall back to an
          // unrelated variant.
          const data = await getProducts({
            search: sku, searchBy: 'sku', first: 10,
            ...(csvSkipArchived ? { status: '-archived' } : {}),
          });
          const matches = [];
          for (const product of data.products) {
            for (const variant of product.variants) {
              if (variant.sku === sku) matches.push({ product, variant });
            }
          }
          if (matches.length === 0) return { sku, kind: 'not-found' };
          if (matches.length > 1) return { id: crypto.randomUUID(), sku, kind: 'ambiguous', quantity, matches };
          const { product, variant } = matches[0];
          return { sku, kind: 'resolved', row: buildRowFromMatch(product, variant, quantity) };
        })
      );
      let added = 0, skipped = 0;
      const notFound = [];
      const toAdd = [];
      const pendingAmbiguous = [];
      const existing = new Set(lineItems.map((li) => li.shopifyVariantId).filter(Boolean));
      for (const r of lookups) {
        if (!r) continue;
        if (r.kind === 'not-found') { notFound.push(r.sku); continue; }
        if (r.kind === 'ambiguous') { pendingAmbiguous.push(r); continue; }
        if (existing.has(r.row.shopifyVariantId)) { skipped++; continue; }
        existing.add(r.row.shopifyVariantId);
        toAdd.push(r.row);
        added++;
      }
      if (toAdd.length > 0) {
        setLineItems((prev) => {
          // drop the single empty placeholder if still pristine
          const cleaned = prev.filter((li) => li.shopifyVariantId || li.quantity);
          return [...cleaned, ...toAdd];
        });
      }
      setCsvResult({ added, skipped, notFound });
      if (pendingAmbiguous.length > 0) {
        setAmbiguous(pendingAmbiguous);
        setAmbiguousSelections({});
      }
    } catch (err) {
      setFormError('CSV import failed: ' + err.message);
    } finally {
      setCsvImporting(false);
    }
  }, [lineItems, buildRowFromMatch, csvSkipArchived]);

  const handleAmbiguousSelect = useCallback((id, variantId) => {
    setAmbiguousSelections((prev) => ({ ...prev, [id]: variantId }));
  }, []);

  const handleAmbiguousConfirm = useCallback(() => {
    const existing = new Set(lineItems.map((li) => li.shopifyVariantId).filter(Boolean));
    const toAdd = [];
    let added = 0, skipped = 0;
    for (const a of ambiguous) {
      const variantId = ambiguousSelections[a.id];
      const match = variantId && a.matches.find((m) => m.variant.id === variantId);
      if (!match) { skipped++; continue; }
      if (existing.has(match.variant.id)) { skipped++; continue; }
      existing.add(match.variant.id);
      toAdd.push(buildRowFromMatch(match.product, match.variant, a.quantity));
      added++;
    }
    if (toAdd.length > 0) {
      setLineItems((prev) => {
        const cleaned = prev.filter((li) => li.shopifyVariantId || li.quantity);
        return [...cleaned, ...toAdd];
      });
    }
    setCsvResult((prev) => prev
      ? { ...prev, added: prev.added + added, skipped: prev.skipped + skipped }
      : { added, skipped, notFound: [] });
    setAmbiguous([]);
    setAmbiguousSelections({});
  }, [ambiguous, ambiguousSelections, lineItems, buildRowFromMatch]);

  const handleAmbiguousCancel = useCallback(() => {
    setCsvResult((prev) => prev
      ? { ...prev, skipped: prev.skipped + ambiguous.length }
      : { added: 0, skipped: ambiguous.length, notFound: [] });
    setAmbiguous([]);
    setAmbiguousSelections({});
  }, [ambiguous]);

  // Variant search for manual line item entry
  const [variantSearch, setVariantSearch] = useState('');
  const [variantOptions, setVariantOptions] = useState([]);

  const { data: searchData, isFetching: searching } = useQuery({
    queryKey: ['transfer-variant-search', variantSearch],
    queryFn: () => getProducts({ search: variantSearch, searchBy: 'title', first: 10 }),
    enabled: variantSearch.length >= 2,
  });

  useEffect(() => {
    if (!searchData) return;
    const opts = [];
    for (const product of searchData.products) {
      for (const v of product.variants) {
        opts.push({
          value: v.id,
          label: product.variants.length === 1 ? product.title : `${product.title} — ${v.title}`,
          meta: {
            shopifyVariantId: v.id,
            productTitle: product.title,
            variantTitle: product.variants.length === 1 ? '' : v.title,
            sku: v.sku ?? '',
          },
        });
      }
    }
    setVariantOptions(opts);
  }, [searchData]);

  const handleSelectVariant = useCallback((selected) => {
    const opt = variantOptions.find((o) => o.value === selected[0]);
    if (!opt) return;
    setLineItems((prev) => {
      if (prev.some((li) => li.shopifyVariantId === opt.meta.shopifyVariantId)) return prev;
      const cleaned = prev.filter((li) => li.shopifyVariantId || li.quantity);
      return [...cleaned, { ...opt.meta, quantity: '' }];
    });
    setVariantSearch('');
    setVariantOptions([]);
  }, [variantOptions]);

  const { data: transfers = [], isLoading, error } = useQuery({
    queryKey: ['transfers'],
    queryFn: getTransfers,
  });

  const { data: locationsRaw } = useQuery({
    queryKey: ['locations'],
    queryFn: getLocations,
  });
  const locationOptions = [
    { label: 'Select location…', value: '' },
    ...((locationsRaw?.data ?? []).map((l) => ({ label: l.name, value: l.id }))),
  ];
  const locationName = (id) => (locationsRaw?.data ?? []).find((l) => l.id === id)?.name ?? id;

  const createMutation = useMutation({
    mutationFn: createTransfer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
      handleCloseModal();
    },
    onError: (err) => setFormError(err.message),
  });

  const confirmMutation = useMutation({
    mutationFn: (id) => confirmTransfer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTransfer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
    },
  });

  const [reverseError, setReverseError] = useState(null);
  const reverseMutation = useMutation({
    mutationFn: (id) => reverseTransfer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
      setReversePreview(null);
    },
    onError: (err) => {
      setReversePreview(null);
      setReverseError(err.message);
    },
  });

  const handleOpenModal = useCallback(() => {
    setFormError(null);
    setCsvResult(null);
    setFromLocationId('');
    setToLocationId('');
    setLineItems([]);
    setVariantSearch('');
    setVariantOptions([]);
    setModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
    setCsvResult(null);
    setVariantSearch('');
    setVariantOptions([]);
  }, []);

  const handleRemoveLineItem = useCallback((index) => {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleLineItemChange = useCallback((index, field, value) => {
    setLineItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }, []);

  const handleCreateTransfer = useCallback(() => {
    setFormError(null);

    if (!fromLocationId || !toLocationId) {
      setFormError('Please select both a source and destination location.');
      return;
    }
    if (fromLocationId === toLocationId) {
      setFormError('Source and destination locations must be different.');
      return;
    }

    const validItems = lineItems.filter((li) => li.shopifyVariantId && li.quantity);
    if (validItems.length === 0) {
      setFormError('Add at least one variant with a quantity.');
      return;
    }

    createMutation.mutate({
      fromLocationId,
      toLocationId,
      lineItems: validItems.map((li) => ({
        shopifyVariantId: li.shopifyVariantId,
        quantity: Number(li.quantity),
      })),
    });
  }, [fromLocationId, toLocationId, lineItems, createMutation]);

  return (
    <Page
      title="Stock Transfers"
      primaryAction={{
        content: 'New Transfer',
        onAction: handleOpenModal,
      }}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Failed to load transfers">
              <p>{error.message}</p>
            </Banner>
          </Layout.Section>
        )}
        {reverseError && (
          <Layout.Section>
            <Banner tone="critical" title="Failed to reverse transfer" onDismiss={() => setReverseError(null)}>
              <p>{reverseError}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            <ResourceList
              resourceName={{ singular: 'transfer', plural: 'transfers' }}
              loading={isLoading}
              emptyState={
                isLoading ? (
                  <InlineStack align="center">
                    <Spinner />
                  </InlineStack>
                ) : (
                  <EmptyState
                    heading="No stock transfers"
                    action={{ content: 'New Transfer', onAction: handleOpenModal }}
                    image=""
                  >
                    <p>Create a transfer to move inventory between locations.</p>
                  </EmptyState>
                )
              }
              items={transfers}
              renderItem={(transfer) => (
                <ResourceItem
                  id={transfer.id}
                  accessibilityLabel={`Transfer from ${transfer.fromLocationId} to ${transfer.toLocationId}`}
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text variant="bodyMd" fontWeight="semibold">
                        From: {transfer.fromLocationId}
                      </Text>
                      <Text variant="bodyMd">To: {transfer.toLocationId}</Text>
                      <Text variant="bodySm" tone="subdued">
                        {transfer.lineItems?.length || 0} item(s) &middot;{' '}
                        {new Date(transfer.createdAt).toLocaleDateString()}
                      </Text>
                    </BlockStack>
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={statusTone(transfer.status)}>
                        {transfer.status.replace('_', ' ')}
                      </Badge>
                      {transfer.reversalOf && <Badge tone="info">Reversal</Badge>}
                      {transfer.reversal && <Badge tone="attention">Reversed</Badge>}
                      {(transfer.status === 'pending' || transfer.status === 'in_transit') && (
                        <InlineStack gap="200">
                          <Button
                            size="slim"
                            tone="success"
                            onClick={() => confirmMutation.mutate(transfer.id)}
                            loading={
                              confirmMutation.isPending &&
                              confirmMutation.variables === transfer.id
                            }
                          >
                            {transfer.status === 'in_transit' ? 'Retry' : 'Confirm'}
                          </Button>
                          {transfer.status === 'pending' && (
                            <Button
                              size="slim"
                              tone="critical"
                              onClick={() => deleteMutation.mutate(transfer.id)}
                              loading={
                                deleteMutation.isPending &&
                                deleteMutation.variables === transfer.id
                              }
                            >
                              Delete
                            </Button>
                          )}
                        </InlineStack>
                      )}
                      {transfer.status === 'received' && !transfer.reversal && (
                        <Button
                          size="slim"
                          onClick={() => setReversePreview(transfer)}
                        >
                          Reverse
                        </Button>
                      )}
                    </InlineStack>
                  </InlineStack>
                </ResourceItem>
              )}
            />
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={modalOpen}
        onClose={handleCloseModal}
        title="New Stock Transfer"
        primaryAction={{
          content: 'Create Transfer',
          onAction: handleCreateTransfer,
          loading: createMutation.isPending,
        }}
        secondaryActions={[{ content: 'Cancel', onAction: handleCloseModal }]}
      >
        <Modal.Section>
          {formError && (
            <Banner tone="critical" title="Error" onDismiss={() => setFormError(null)}>
              <p>{formError}</p>
            </Banner>
          )}
          {csvResult && (
            <Banner
              tone={csvResult.notFound.length > 0 ? 'warning' : 'success'}
              onDismiss={() => setCsvResult(null)}
            >
              {csvResult.added} variant{csvResult.added !== 1 ? 's' : ''} imported
              {csvResult.skipped > 0 ? `, ${csvResult.skipped} skipped` : ''}
              {csvResult.notFound.length > 0
                ? `, ${csvResult.notFound.length} SKU${csvResult.notFound.length !== 1 ? 's' : ''} not found: ${csvResult.notFound.join(', ')}`
                : ''}
            </Banner>
          )}
          <FormLayout>
            <Select
              label="From Location"
              options={locationOptions}
              value={fromLocationId}
              onChange={setFromLocationId}
            />
            <Select
              label="To Location"
              options={locationOptions}
              value={toLocationId}
              onChange={setToLocationId}
            />
          </FormLayout>
          <div style={{ marginTop: '12px' }}>
            <input
              ref={csvFileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={handleCsvFileSelect}
            />
            <InlineStack gap="200" blockAlign="center">
              <Button
                icon={ImportIcon}
                size="slim"
                loading={csvImporting}
                onClick={() => csvFileRef.current?.click()}
              >
                Import line items from CSV
              </Button>
              <Checkbox
                label="Skip archived products"
                checked={csvSkipArchived}
                onChange={setCsvSkipArchived}
              />
              <Button
                size="slim"
                variant="plain"
                onClick={() => downloadCSVFile('transfer-import-example.csv', TRANSFER_CSV_EXAMPLE)}
              >
                Download example
              </Button>
            </InlineStack>
          </div>
        </Modal.Section>

        {lineItems.filter((li) => li.shopifyVariantId).length > 0 && (
          <Modal.Section>
            <BlockStack gap="300">
              {lineItems.filter((li) => li.shopifyVariantId).map((item, index) => (
                <InlineStack key={item.shopifyVariantId} align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="050">
                    <Text variant="bodyMd" fontWeight="semibold">
                      {item.productTitle}{item.variantTitle ? ` — ${item.variantTitle}` : ''}
                    </Text>
                    <Text variant="bodySm" tone="subdued">{item.sku || item.shopifyVariantId}</Text>
                  </BlockStack>
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{ width: 80 }}>
                      <TextField
                        label="Qty"
                        labelHidden
                        type="number"
                        value={item.quantity}
                        onChange={(v) => handleLineItemChange(
                          lineItems.findIndex((li) => li.shopifyVariantId === item.shopifyVariantId),
                          'quantity', v
                        )}
                        autoComplete="off"
                        min="1"
                      />
                    </div>
                    <Button
                      icon={DeleteIcon}
                      variant="plain"
                      tone="critical"
                      size="slim"
                      onClick={() => handleRemoveLineItem(
                        lineItems.findIndex((li) => li.shopifyVariantId === item.shopifyVariantId)
                      )}
                    />
                  </InlineStack>
                </InlineStack>
              ))}
            </BlockStack>
          </Modal.Section>
        )}

        <Modal.Section>
          <Autocomplete
            options={variantOptions}
            selected={[]}
            onSelect={handleSelectVariant}
            loading={searching}
            textField={
              <Autocomplete.TextField
                label="Add variant"
                labelHidden
                value={variantSearch}
                onChange={setVariantSearch}
                prefix={<Icon source={SearchIcon} />}
                placeholder="Search by product title to add a variant…"
                autoComplete="off"
              />
            }
          />
        </Modal.Section>
      </Modal>

      {/* ── Reverse confirmation ─────────────────────────────────────────── */}
      <Modal
        open={!!reversePreview}
        onClose={() => setReversePreview(null)}
        title="Reverse Transfer"
        primaryAction={{
          content: 'Confirm reversal',
          destructive: true,
          onAction: () => reverseMutation.mutate(reversePreview.id),
          loading: reverseMutation.isPending,
        }}
        secondaryActions={[{
          content: 'Cancel',
          onAction: () => setReversePreview(null),
          disabled: reverseMutation.isPending,
        }]}
      >
        {reversePreview && (
          <Modal.Section>
            <BlockStack gap="400">
              <Text>
                This creates a new transfer moving inventory back from{' '}
                <Text as="span" fontWeight="semibold">{locationName(reversePreview.toLocationId)}</Text> to{' '}
                <Text as="span" fontWeight="semibold">{locationName(reversePreview.fromLocationId)}</Text>,
                and posts it to Shopify immediately.
              </Text>
              <BlockStack gap="200">
                {reversePreview.lineItems.map((li) => (
                  <InlineStack key={li.id} align="space-between" blockAlign="center">
                    <Text variant="bodySm" tone="subdued">{li.shopifyVariantId}</Text>
                    <Text variant="bodyMd" fontWeight="semibold">{li.quantity}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        )}
      </Modal>

      <SkuMatchModal
        open={ambiguous.length > 0}
        items={ambiguous.map((a) => ({
          id: a.id,
          sku: a.sku,
          options: a.matches.map((m) => ({ label: matchLabel(m.product, m.variant), value: m.variant.id })),
        }))}
        selections={ambiguousSelections}
        onSelect={handleAmbiguousSelect}
        onConfirm={handleAmbiguousConfirm}
        onCancel={handleAmbiguousCancel}
      />
    </Page>
  );
}
