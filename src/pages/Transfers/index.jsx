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
} from '@shopify/polaris';
import { ImportIcon, SearchIcon, DeleteIcon } from '@shopify/polaris-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getTransfers,
  createTransfer,
  confirmTransfer,
  deleteTransfer,
} from '../../api/transfers.js';
import { getLocations } from '../../api/inventory.js';
import { getProducts } from '../../api/products.js';
import { parseCSV } from '../../utils/csv.js';

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

  // Form state
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [lineItems, setLineItems] = useState([{ ...EMPTY_LINE_ITEM }]);

  // CSV import
  const csvFileRef = useRef(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState(null); // { added, skipped, notFound }

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
          const data = await getProducts({ search: sku, searchBy: 'sku', first: 1 });
          const product = data.products[0];
          if (!product) return { sku, found: false };
          const variant = product.variants.find((v) => v.sku === sku) ?? product.variants[0];
          return {
            sku, found: true,
            shopifyVariantId: variant.id,
            productTitle: product.title,
            variantTitle: product.variants.length === 1 ? '' : variant.title,
            variantSku: variant.sku ?? '',
            quantity: row[qtyKey]?.trim() ?? '',
          };
        })
      );
      let added = 0, skipped = 0;
      const notFound = [];
      const toAdd = [];
      const existing = new Set(lineItems.map((li) => li.shopifyVariantId).filter(Boolean));
      for (const r of lookups) {
        if (!r) continue;
        if (!r.found) { notFound.push(r.sku); continue; }
        if (existing.has(r.shopifyVariantId)) { skipped++; continue; }
        existing.add(r.shopifyVariantId);
        toAdd.push({ shopifyVariantId: r.shopifyVariantId, productTitle: r.productTitle, variantTitle: r.variantTitle, sku: r.variantSku, quantity: r.quantity });
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
    } catch (err) {
      setFormError('CSV import failed: ' + err.message);
    } finally {
      setCsvImporting(false);
    }
  }, [lineItems]);

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
              {csvResult.skipped > 0 ? `, ${csvResult.skipped} skipped (duplicate)` : ''}
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
            <Button
              icon={ImportIcon}
              size="slim"
              loading={csvImporting}
              onClick={() => csvFileRef.current?.click()}
            >
              Import line items from CSV
            </Button>
            <div style={{ marginTop: '4px' }}>
              <Text variant="bodySm" tone="subdued">CSV format: sku, quantity</Text>
            </div>
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
    </Page>
  );
}
